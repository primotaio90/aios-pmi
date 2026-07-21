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
 * History persists per tenant+agent in state/agent_chat_<agentId>.json.
 */
import { getSettings, providerConfig, modelFor } from './settings.mjs';
import { getLLMClient } from './llm/index.mjs';

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

  async send(project, agentId, message, byUser = 'consultant') {
    const agent = this.#agentOrThrow(agentId);
    const text = String(message || '').trim();
    if (!text) throw new Error('Messaggio vuoto');

    const history = await this.store.readState(project, this.#key(agentId), []);
    const now = new Date().toISOString();
    history.push({ ts: now, by: byUser, role: 'user', text });

    let reply;
    const settings = await getSettings();
    try {
      reply =
        settings.provider === 'mock'
          ? this.#mockReply(agent, text)
          : await this.#llmReply(project, agent, history.slice(0, -1), text, byUser, settings);
    } catch (err) {
      reply = `⚠️ Errore dal provider ${settings.provider}: ${String(err.message || err)}`;
    }

    history.push({ ts: new Date().toISOString(), by: agent.id, role: 'agent', text: reply });
    const trimmed = history.slice(-MAX_HISTORY);
    await this.store.writeState(project, this.#key(agentId), trimmed);

    // Audit event on the shared bus (persisted to logs/events.jsonl).
    this.bus.emitEvent(project, 'agent.chat', { agent: agent.id, by: byUser, preview: short(text, 60) }, agent.id);

    return { reply, history: trimmed.slice(-REPLY_CONTEXT) };
  }

  #mockReply(agent, text) {
    const tools = agent.mcp_whitelist.length ? agent.mcp_whitelist.join(', ') : 'nessuno';
    return [
      `[${agent.name}] Modalità simulata attiva: non posso ragionare davvero senza un provider LLM.`,
      `Apri il pannello ⚙️ Impostazioni e scegli un provider (Anthropic o OpenAI-compatibile) per conversare sul serio.`,
      ``,
      `Ruolo: ${agent.level}${agent.department ? ` · ${agent.department}` : ''} · tool disponibili: ${tools}.`,
      `Ho registrato la tua richiesta: "${short(text)}".`,
    ].join('\n');
  }

  async #llmReply(project, agent, priorHistory, message, byUser, settings) {
    const client = getLLMClient(providerConfig(settings));
    const brief = await this.store.readFile(project, 'brief.md').catch(() => '');
    const system = [
      agent.system_prompt,
      '',
      '---',
      'Stai conversando in CHAT DIRETTA con un consulente umano (' + byUser + ').',
      'Rispondi in italiano, in modo conciso e concreto. Se una richiesta esce dalle tue',
      'competenze o dai tuoi tool autorizzati, dillo con chiarezza. Puoi usare i tuoi tool',
      'quando servono davvero.',
      brief ? '\n--- Brief del cliente ---\n' + brief : '',
    ].join('\n');

    const toolSpecs = agent.mcp_whitelist.map((qualified) => ({
      qualified,
      ...(this.gateway.toolSpec(qualified) || { description: qualified, params: {} }),
    }));
    const callTool = (qualified, input) => this.gateway.call(project, agent.id, qualified, input);
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
