/**
 * Operating modes for the direct human ↔ agent channel: a quick way to switch
 * the model's posture (and the tools it may reach for) without editing the
 * agent definition in agents/<id>.md.
 *
 * SUBTRACTIVE BY DESIGN — a mode can only NARROW an agent's mcp_whitelist,
 * never widen it. `tools: null` means "everything the agent already has";
 * a non-null list acts as an intersection filter; `allow_writes: false`
 * additionally strips filesystem.fs_write. The frontmatter whitelist stays the
 * only source of authority and the gateway keeps enforcing it independently,
 * so a mode is a second and stricter gate — never a grant. A mode listing a
 * tool the agent does not own simply yields nothing.
 *
 * Declarative and dependency-free: consumed by chat.mjs (system-prompt overlay
 * + tool specs) and served as-is to the dashboard through /api/modes.
 */

export const DEFAULT_MODE = 'orchestrator';

export const MODES = [
  {
    id: 'orchestrator',
    label: 'Orchestratore',
    icon: '🧭',
    color: '#38bdf8',
    tagline: 'Coordina task, direttori e sub-agenti',
    description:
      'Modalità base: scompone la richiesta in macro-obiettivi, li delega ai tre Direttori e aggrega i loro report. Usala quando vuoi far lavorare tutto il team di agenti.',
    orchestrates: true,
    tools: null,
    allow_writes: true,
    placeholder: 'Descrivi l\'obiettivo del cliente (min 5 caratteri)…',
    cta: 'Avvia orchestrazione',
    overlay: [
      'Sei nel tuo ruolo nativo: scomponi, deleghi, aggreghi. Nient\'altro.',
      '- Traduci la richiesta in macro-obiettivi chiari, uno per dipartimento (business, tech, delivery).',
      '- Dialoghi solo con i 3 Direttori: NON parli mai con i sub-agenti esperti.',
      '- Non svolgi il lavoro specialistico al posto loro: lo assegni e ne raccogli il report.',
      '- Chiudi sempre con la sintesi aggregata: risultati, rischi aperti, prossimi passi.',
    ].join('\n'),
  },
  {
    id: 'architect',
    label: 'Architetto',
    icon: '📐',
    color: '#a78bfa',
    tagline: 'Pianifica prima di implementare',
    description:
      'Analizza il contesto e produce un piano prima di qualunque implementazione. Usala quando l\'obiettivo va ancora chiarito o scomposto in passi verificabili.',
    orchestrates: false,
    tools: ['filesystem.fs_read', 'filesystem.fs_list', 'research.web_search', 'diagram.mermaid_generate'],
    allow_writes: false,
    placeholder: 'Cosa vuoi progettare? Obiettivo, vincoli e contesto…',
    cta: 'Progetta il piano',
    overlay: [
      'Prima capire, poi proporre: in questa modalità NON scrivi file e NON implementi nulla.',
      '1. Riformula l\'obiettivo con parole tue e dichiara le assunzioni che stai facendo.',
      '2. Proponi un piano numerato di passi, nell\'ordine in cui vanno eseguiti.',
      '3. Per ogni passo indica l\'output atteso e un criterio di accettazione verificabile.',
      '4. Elenca i rischi principali e come li mitighi.',
      'Se manca un\'informazione decisiva, chiedila invece di indovinare.',
    ].join('\n'),
  },
  {
    id: 'code',
    label: 'Code',
    icon: '⌨️',
    color: '#34d399',
    tagline: 'Scrive e modifica artefatti',
    description:
      'Realizza la modifica richiesta sugli artefatti di progetto, con interventi minimi e tracciati. Usala quando sai già cosa va fatto e vuoi che venga fatto.',
    orchestrates: false,
    tools: [
      'filesystem.fs_read',
      'filesystem.fs_write',
      'filesystem.fs_list',
      'api.openapi_parse',
      'diagram.mermaid_generate',
    ],
    allow_writes: true,
    placeholder: 'Descrivi la modifica da fare e su quali file…',
    cta: 'Esegui',
    overlay: [
      'Esegui la richiesta con modifiche minime e mirate.',
      '- Leggi prima di scrivere: non riscrivere un file che non hai letto.',
      '- Cambia solo ciò che serve, rispettando struttura, stile e convenzioni esistenti.',
      '- Dichiara SEMPRE, in coda alla risposta, l\'elenco dei file che hai toccato.',
      '- Se serve una modifica fuori dal perimetro richiesto, non farla: segnalala.',
    ].join('\n'),
  },
  {
    id: 'ask',
    label: 'Ask',
    icon: '❓',
    color: '#fbbf24',
    tagline: 'Domanda e spiega',
    description:
      'Risponde a domande e spiega il progetto senza modificare nulla. Usala per capire lo stato dell\'arte prima di decidere.',
    orchestrates: false,
    tools: ['filesystem.fs_read', 'filesystem.fs_list', 'research.web_search'],
    allow_writes: false,
    placeholder: 'Fai una domanda sul progetto, sui file o sul metodo…',
    cta: 'Chiedi',
    overlay: [
      'Spiega, non modificare: in questa modalità non produci alcuna scrittura.',
      '- Parli a un consulente: linguaggio divulgativo e concreto, zero gergo inutile.',
      '- Cita sempre i file che hai letto a sostegno di quello che affermi.',
      '- Distingui con chiarezza ciò che risulta dai file da ciò che è una tua ipotesi.',
      '- Se la risposta non è nei file di progetto, dillo apertamente invece di inventarla.',
    ].join('\n'),
  },
  {
    id: 'debug',
    label: 'Debug',
    icon: '🐞',
    color: '#f87171',
    tagline: 'Diagnosi e soluzione dei problemi',
    description:
      'Diagnostica le anomalie partendo dalle evidenze e propone la correzione minima. Usala quando qualcosa non torna: task bloccati, output incoerenti, integrazioni che falliscono.',
    orchestrates: false,
    tools: [
      'filesystem.fs_read',
      'filesystem.fs_list',
      'api.http_probe',
      'api.openapi_parse',
      'tasks.task_update',
    ],
    allow_writes: false,
    placeholder: 'Descrivi il problema: cosa succede, cosa ti aspettavi, dove…',
    cta: 'Diagnostica',
    overlay: [
      'Procedi per diagnosi, non per tentativi.',
      '1. Elenca le ipotesi possibili, ordinate dalla più probabile alla meno probabile.',
      '2. Verifica ogni ipotesi con evidenze concrete: log, file di progetto, task bloccati.',
      '3. Scarta le ipotesi smentite dicendo quale evidenza le ha smentite.',
      '4. Concludi con la correzione minima proposta e come verificarne l\'esito.',
      'Non applichi le modifiche: qui proponi soltanto.',
    ].join('\n'),
  },
];

/** Mode object by id; an unknown or missing id degrades to DEFAULT_MODE (never throws). */
export function getMode(id) {
  return MODES.find((m) => m.id === id) || MODES.find((m) => m.id === DEFAULT_MODE);
}

/**
 * Public catalog for the dashboard: same order, minus the `overlay` field
 * (a system-prompt fragment, of no use to the UI). Fields are picked
 * explicitly so the shape matches the OperatingMode type of the client.
 */
export function listModes() {
  return MODES.map((mode) => ({
    id: mode.id,
    label: mode.label,
    icon: mode.icon,
    color: mode.color,
    tagline: mode.tagline,
    description: mode.description,
    orchestrates: mode.orchestrates,
    tools: mode.tools ? [...mode.tools] : null,
    allow_writes: mode.allow_writes,
    placeholder: mode.placeholder,
    cta: mode.cta,
  }));
}

/**
 * The agent's whitelist narrowed by the mode — the ONLY authorized rule.
 * Always starts from agent.mcp_whitelist, so the result is a subset of it:
 * a mode can never introduce a tool the agent does not own.
 */
export function effectiveTools(agent, modeId) {
  const mode = getMode(modeId);
  let tools = Array.isArray(agent?.mcp_whitelist) ? [...agent.mcp_whitelist] : [];
  if (mode.tools) tools = tools.filter((t) => mode.tools.includes(t));
  if (!mode.allow_writes) tools = tools.filter((t) => t !== 'filesystem.fs_write');
  return tools;
}

/**
 * System-prompt overlay for a mode: header + description + posture rules.
 * The concrete tool list ("Strumenti disponibili in questa modalità: …") is
 * appended by the CALLER (chat.mjs) and deliberately NOT built here: this
 * module knows the mode, not the agent it is being applied to.
 */
export function modeOverlay(modeId) {
  const mode = getMode(modeId);
  return [`--- MODALITÀ ATTIVA: ${mode.label} (${mode.id}) ---`, mode.description, '', mode.overlay].join('\n');
}
