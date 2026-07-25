/**
 * Direct human ↔ agent chat. A side-channel that lets a consultant talk to ANY
 * single agent (orchestrator, directors, experts) to ask, correct or instruct
 * it — distinct from the vertical goal pipeline (agents still never talk to each
 * other here; only the human talks to one agent).
 *
 * - Real providers (anthropic/openai): a tool-enabled loop scoped to the agent's
 *   own mcp_whitelist via the same gateway (whitelist + audit identical to runs),
 *   with the recent conversation as context.
 * - Mock provider: a deterministic informative reply (no network), mirroring the
 *   PM console's rule-based approach.
 *
 * Each turn carries an operating mode (see modes.mjs). The mode is subtractive:
 * it narrows the tools handed to the model and appends a posture overlay to the
 * system prompt, but never grants anything outside the agent's whitelist. The
 * mode id is stored on both the user turn and the agent reply so the UI can badge
 * a single thread — older entries simply have no `mode` field.
 * History persists per tenant+agent in state/agent_chat_<agentId>.json.
 */
import { getSettings, providerConfig, modelFor } from './settings.mjs';
import { getLLMClient } from './llm/index.mjs';
import { DEFAULT_MODE, getMode, effectiveTools, modeOverlay } from './modes.mjs';

const MAX_HISTORY = 100;
const REPLY_CONTEXT = 24; // recent turns fed back to the model
const short = (t, n = 90) => (t.length > n ? t.slice(0, n).trim() + '…' : t);

export class AgentChat {
  constructor({ registry, store, gateway, bus }) {
    this.registry = registry;
    this.store = store;
    this.gateway = gateway;
    this.bus = bus;
  }

  #key(agentId) {
    return `agent_chat_${agentId}`;
  }

  #agentOrThrow(agentId) {
    const agent = this.registry.get(agentId);
    if (!agent) throw new Error(`Agente sconosciuto: ${agentId}`);
    return agent;
  }

  async history(project, agentId) {
    this.#agentOrThrow(agentId);
    const all = await this.store.readState(project, this.#key(agentId), []);
    return all.slice(-REPLY_CONTEXT);
  }

  async send(project, agentId, message, byUser = 'consultant', modeId = DEFAULT_MODE) {
    const agent = this.#agentOrThrow(agentId);
    const text = String(message || '').trim();
    if (!text) throw new Error('Messaggio vuoto');

    // Unknown ids fall back to the default mode; `allow` is always a subset of
    // the agent's whitelist.
    const mode = getMode(modeId);
    const allow = effectiveTools(agent, mode.id);

    const history = await this.store.readState(project, this.#key(agentId), []);
    const now = new Date().toISOString();
    history.push({ ts: now, by: byUser, role: 'user', text, mode: mode.id });

    let reply;
    const settings = await getSettings();
    try {
      reply =
        settings.provider === 'mock'
          ? this.#mockReply(agent, text, mode, allow)
          : await this.#llmReply(project, agent, history.slice(0, -1), text, byUser, settings, mode, allow);
    } catch (err) {
      reply = `⚠️ Errore dal provider ${settings.provider}: ${String(err.message || err)}`;
    }

    history.push({ ts: new Date().toISOString(), by: agent.id, role: 'agent', text: reply, mode: mode.id });
    const trimmed = history.slice(-MAX_HISTORY);
    await this.store.writeState(project, this.#key(agentId), trimmed);

    // Audit event on the shared bus (persisted to logs/events.jsonl).
    this.bus.emitEvent(
      project,
      'agent.chat',
      { agent: agent.id, by: byUser, mode: mode.id, preview: short(text, 60) },
      agent.id
    );

    return { reply, history: trimmed.slice(-REPLY_CONTEXT) };
  }

  #mockReply(agent, text, mode, allow) {
    const tools = allow.length ? allow.join(', ') : 'nessuno';
    // The base ('orchestrator') mode is the orchestrator's own posture: only the
    // orchestrator announces it. Other agents can only ever be in the default
    // mode here (the UI offers the selector only for the orchestrator).
    const showMode = agent.level === 'orchestrator' || mode.id !== DEFAULT_MODE;
    return [
      `[${agent.name}] Modalità simulata attiva: non posso ragionare davvero senza un provider LLM.`,
      `Apri il pannello ⚙️ Impostazioni e scegli un provider (Anthropic o OpenAI-compatibile) per conversare sul serio.`,
      ``,
      ...(showMode ? [`Modalità attiva: ${mode.icon} ${mode.label} — ${mode.tagline}.`] : []),
      `Ruolo: ${agent.level}${agent.department ? ` · ${agent.department}` : ''} · tool disponibili: ${tools}.`,
      `Ho registrato la tua richiesta: "${short(text)}".`,
    ].join('\n');
  }

  async #llmReply(project, agent, priorHistory, message, byUser, settings, mode, allow) {
    const client = getLLMClient(providerConfig(settings));
    const brief = await this.store.readFile(project, 'brief.md').catch(() => '');
    // The base ('orchestrator') overlay encodes the orchestrator's own role
    // ("scomponi, deleghi, aggreghi", "parli solo con i 3 Direttori"). It must
    // NOT leak into directors'/experts' prompts, which would contradict their
    // system_prompt and the hierarchy of docs/ARCHITECTURE.md §4. Apply an
    // overlay only to the orchestrator, or when a non-default mode was chosen
    // (offered by the UI only for the orchestrator).
    const applyMode = agent.level === 'orchestrator' || mode.id !== DEFAULT_MODE;
    const system = [
      agent.system_prompt,
      ...(applyMode
        ? [
            '',
            // modeOverlay() intentionally omits the tool list: it is injected here,
            // where the effective (already restricted) set is known.
            modeOverlay(mode.id),
            '',
            `Strumenti disponibili in questa modalità: ${allow.join(', ') || 'nessuno'}.`,
          ]
        : []),
      '',
      '---',
      'Stai conversando in CHAT DIRETTA con un consulente umano (' + byUser + ').',
      'Rispondi in italiano, in modo conciso e concreto. Se una richiesta esce dalle tue',
      'competenze o dai tuoi tool autorizzati, dillo con chiarezza. Puoi usare i tuoi tool',
      'quando servono davvero.',
      brief ? '\n--- Brief del cliente ---\n' + brief : '',
    ].join('\n');

    const toolSpecs = allow.map((qualified) => ({
      qualified,
      ...(this.gateway.toolSpec(qualified) || { description: qualified, params: {} }),
    }));
    // The tool loop reads res.ok/res.error: a gateway denial throws, so it must
    // be converted into a soft result or the loop would abort mid-conversation.
    const callTool = async (qualified, input) => {
      try {
        return await this.gateway.call(project, agent.id, qualified, input, {
          allow,
          mode: mode.id,
          reason: `non disponibile in modalità ${mode.label}`,
        });
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }
    };
    const historyMsgs = priorHistory.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));

    const { text } = await client.runToolLoop({
      model: modelFor(agent, settings),
      system,
      history: historyMsgs,
      userText: message,
      toolSpecs,
      params: settings.params,
      tokenBudget: agent.token_budget,
      maxIters: 6,
      callTool,
    });
    return text.trim() || '(nessuna risposta dal modello)';
  }
}
