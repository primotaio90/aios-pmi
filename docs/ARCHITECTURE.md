# AIOS — Dashboard di Automazione · Architettura e Contratti

Sistema operativo aziendale AI-native, multi-tenant, per lo studio di 3 consulenti.
Gerarchia a tre livelli: **Orchestrator_Core → 3 Direttori → Sub-Agenti Esperti on-demand**.
Tutta la conoscenza è persistita in file `.md` e JSON dichiarativi: **zero stato nascosto**.

Questo documento è il contratto vincolante tra motore, API, UI e definizioni agenti.

---

## 1. Layout del repository

```
AIOS/
├── agents/                        # 1 file .md = 1 agente (unica fonte di verità)
│   ├── orchestrator_core.md
│   ├── director_business_strategy.md
│   ├── director_tech_solutions.md
│   ├── director_delivery_operations.md
│   └── expert_*.md                # 9+ sub-agenti (estensibili senza toccare codice)
├── mcp/
│   └── servers.json               # configurazione MCP dichiarativa (server → tool)
├── config/
│   └── users.json                 # consulenti + ruolo project_manager riservato (Fase 2)
├── projects/                      # multi-tenant: 1 cartella = 1 PMI cliente
│   └── <cliente>/
│       ├── project.json           # { id, name, client, description, created_at, pm_enabled }
│       ├── brief.md               # brief del cliente
│       ├── business/              # file di competenza Director_Business_Strategy
│       │   ├── vision_strategica.md
│       │   └── analisi_competitiva.md
│       ├── tech/                  # file di competenza Director_Tech_Solutions
│       │   ├── architettura_sistema.md
│       │   └── mappa_integrazioni.md
│       ├── delivery/              # file di competenza Director_Delivery_Operations
│       │   ├── gantt_progetto.md
│       │   └── stato_avanzamento.md
│       ├── dati/                  # input del cliente (csv, spec API, ecc.)
│       ├── outputs/               # deliverable generati dagli agenti
│       ├── logs/
│       │   ├── events.jsonl       # ogni evento del bus
│       │   ├── mcp_calls.jsonl    # ogni chiamata MCP (timestamp, agente, tool, payload, esito)
│       │   └── lifecycle.jsonl    # spawn/teardown dei sub-agenti
│       └── state/
│           ├── goals.json         # macro-obiettivi
│           └── tasks.json         # task con macchina a stati
├── scripts/
│   └── demo.mjs                   # scenario demo end-to-end (senza server HTTP)
├── src/lib/aios/                  # motore (ESM .mjs puro: gira in Next e in node diretto)
├── src/app/api/                   # route handlers Next.js (contratto §6)
├── src/app/                       # dashboard (disvelamento progressivo, §7)
└── docs/                          # questo file + FASE2_PM.md
```

Cartelle legacy della v1 (`data/`, `config/agents_config.json`): conservate come archivio,
non più lette dal sistema.

---

## 2. Definizione agente — `agents/<id>.md`

Frontmatter YAML **piatto** (scalari e liste semplici) + corpo = system prompt.

```markdown
---
id: expert_market_analyst
name: Expert Market Analyst
level: expert                      # orchestrator | director | expert
department: business               # core | business | tech | delivery
director: director_business_strategy   # obbligatorio solo per level: expert
model: claude-opus-4-8
token_budget: 24000
icon: "📈"
color: "#f59e0b"
mcp_whitelist:
  - research.web_search
  - filesystem.fs_read
  - filesystem.fs_write
owns_files: []                     # solo i direttori possiedono file .md di progetto
keywords:
  - mercato
  - competitor
mock_summary: "Analisi competitor completata per {goal}: mappati i player principali e il posizionamento."
---
Sei Expert_Market_Analyst... (system prompt completo)
```

Regole di validazione (Registry):
- `id` = nome file senza estensione; univoco.
- `level: expert` ⇒ `director` deve riferire un direttore esistente.
- `mcp_whitelist` ⇒ ogni voce deve esistere in `mcp/servers.json` (`server.tool`).
- Esattamente 1 `orchestrator`; i `director` hanno `owns_files` relativi alla propria cartella.
- Gli errori di validazione non bloccano il sistema: l'agente invalido è escluso e
  l'errore è esposto da `GET /api/agents` (campo `errors`).

**Estensibilità zero-code**: il Registry scandisce `agents/` a runtime (con `fs.watch`).
La mappa direttore→esperti deriva dal campo `director:`. Aggiungere un sub-agente =
creare un nuovo `.md`. Il runner mock ha un playbook generico guidato dal frontmatter
(whitelist, keywords, mock_summary), quindi anche un agente nuovo funziona subito.

---

## 3. Macchina a stati dei task

Stati: `pending → assigned → in_progress → blocked → review → done`

Transizioni ammesse (ogni altra transizione è un errore):

```
pending    → assigned
assigned   → in_progress | blocked
in_progress→ blocked | review
blocked    → assigned | in_progress
review     → in_progress | done      # rework oppure approvazione del Direttore
done       → (terminale)
```

Oggetto task (persistito in `state/tasks.json`):

```json
{
  "id": "T-0003",
  "goal_id": "G-0001",
  "title": "Analisi competitor settore arredo",
  "department": "business",
  "assignee": "expert_market_analyst",
  "created_by": "director_business_strategy",
  "status": "review",
  "report": "…sintesi del sub-agente…",
  "outputs": ["outputs/T-0003_expert_market_analyst.md"],
  "created_at": "…", "updated_at": "…",
  "history": [{ "ts": "…", "from": "pending", "to": "assigned", "by": "director_business_strategy" }]
}
```

Goal (persistito in `state/goals.json`): `{ id: "G-0001", text, created_by, status:
received|decomposed|in_progress|completed|failed, macro_goals: [{department, description,
task_ids[]}], report_path, created_at, completed_at }`.

---

## 4. Ciclo di vita e comunicazione (solo verticale)

- **Orchestrator_Core**: riceve il goal dai consulenti, legge il brief, scompone in
  macro-obiettivi per dipartimento, aggrega i report dei Direttori in
  `outputs/G-xxxx_report.md`. **Non** comunica mai con i sub-agenti.
- **Direttori**: pianificano i task, fanno `spawn` dei propri esperti (il Lifecycle
  rifiuta spawn da chiunque non sia il direttore dell'esperto), sintetizzano verso l'alto
  e aggiornano i propri `owns_files` (sezione datata in append, mai sovrascrittura).
- **Sub-agenti**: `spawn → esecuzione (solo tool in whitelist) → report strutturato al
  Direttore → teardown` con rilascio del contesto. Il teardown avviene sempre (`finally`),
  anche in caso di errore (`reason: completed | error`).

Eventi del bus (`{ts, project, type, agent, data}`), tutti persistiti in `logs/events.jsonl`:

| type | quando | log dedicato |
|---|---|---|
| `goal.created` / `goal.decomposed` / `goal.completed` / `goal.failed` | ciclo goal | — |
| `task.created` / `task.status` | TaskManager | — |
| `agent.spawned` / `agent.teardown` | Lifecycle | `logs/lifecycle.jsonl` |
| `agent.report` | report verticale esperto→direttore, direttore→orchestratore | — |
| `mcp.call` | ogni chiamata al gateway MCP (anche negate) | `logs/mcp_calls.jsonl` |
| `file.updated` | scrittura file di progetto | — |
| `delivery.produced` | pacchetto di consegna generato dal DeliveryDesk (§12) | — |
| `registry.updated` | hot-reload di `agents/` (project `*` = globale) | — |
| `notify` | notifiche UI (level: info/warn/error) | — |

Riga `mcp_calls.jsonl`: `{ts, agent, tool, payload, outcome: ok|denied|error, duration_ms, result_preview}`.
Riga `lifecycle.jsonl`: `{ts, event: spawn|teardown, agent, instance_id, by, task, token_budget, reason?, context_released?}`.

---

## 5. Gateway MCP dichiarativo — `mcp/servers.json`

```json
{
  "servers": {
    "filesystem": {
      "transport": "internal",
      "description": "Accesso ai file del progetto (sandbox per-tenant)",
      "tools": {
        "fs_read":  { "description": "Legge un file relativo al progetto", "params": { "path": "string" } },
        "fs_write": { "description": "Scrive/appende un file", "params": { "path": "string", "content": "string", "mode": "overwrite|append" } },
        "fs_list":  { "description": "Elenca una cartella", "params": { "dir": "string" } }
      }
    },
    "research":  { "tools": { "web_search": … } },
    "data":      { "tools": { "read_spreadsheet": …, "compute_roi": … } },
    "diagram":   { "tools": { "mermaid_generate": … } },
    "api":       { "tools": { "openapi_parse": …, "http_probe": … } },
    "tasks":     { "tools": { "task_update": … } }
  }
}
```

- Whitelist per agente = `mcp_whitelist` nel frontmatter, formato `server.tool`.
- Il gateway **nega** (outcome `denied`, comunque loggato) ogni tool fuori whitelist.
- `transport: internal` = handler deterministici in-process (nessuna rete: `web_search`
  e `http_probe` restituiscono risultati simulati e marcati `simulated: true`).
- Estensione: un server con `transport: stdio` + `command` è dichiarabile; l'esecuzione
  stdio è un punto di estensione documentato, non implementato in questa fase.

---

## 6. API HTTP (Next.js route handlers)

Autenticazione: `POST /api/login {username, password}` → cookie httpOnly `aios_token`.
Tutte le altre rotte richiedono il cookie (401 altrimenti). Ruoli: `consultant` (3 utenti),
`project_manager` (riservato Fase 2, account disabilitato).

| Rotta | Metodo | Risposta |
|---|---|---|
| `/api/login` | POST / DELETE | `{user}` + cookie / logout |
| `/api/me` | GET | `{user}` |
| `/api/agents` | GET | `{agents: [...], errors: [...]}` dal Registry |
| `/api/modes` | GET | `{modes: [...]}` — catalogo statico delle modalità operative (§12), senza `overlay` |
| `/api/projects` | GET / POST | lista tenant / crea tenant (scaffolding completo) |
| `/api/projects/:p/overview` | GET | `{orchestrator, directors[]}` con stato, focus, % avanzamento, n. sub-agenti attivi |
| `/api/projects/:p/goals` | GET / POST | lista goal / `POST {text}` avvia orchestrazione (async, ritorna subito il goal) |
| `/api/projects/:p/tasks` | GET | `?department=&status=` |
| `/api/projects/:p/delivery` | GET / POST | `{snapshot}` deterministico / `POST {title?, include?, notes?}` → 201 `{delivery: {path, content}, snapshot}` (§12) |
| `/api/projects/:p/directors/:d` | GET | drill-down: `{director, files[], subagents[], logs[]}` |
| `/api/projects/:p/files` | GET | `?path=` → `{path, content}` (safe-join dentro il tenant) |
| `/api/projects/:p/logs` | GET | `?type=events|mcp|lifecycle&agent=&limit=` |
| `/api/events` | GET (SSE) | `?project=` → stream JSON degli eventi del bus (tenant-filtrato) |
| `/api/pm?project=` | GET | Overview PM: KPI, checklist, notifiche (Fase 2) |
| `/api/pm/suggestions?project=` | GET | Prossime azioni derivate da task bloccati/review |
| `/api/pm` | POST | `{project, action: chat\|notify\|checklist}` (Fase 2) |

SSE: `text/event-stream`, un evento per riga `data:`; heartbeat `: ping` ogni 25s.

---

## 7. UI — Disvelamento Progressivo (regola ferrea)

- **Home**: SOLO 4 schede — Orchestratore + 3 Direttori — con badge stato, dipartimento
  attivo, % avanzamento, timeline macro-obiettivi sull'Orchestratore. Mai log o chat in home.
- **Drill-down** (click su un Direttore): cartella file `.md` del dipartimento (con
  viewer), sub-agenti del direttore (attivi/disponibili, budget token), log CLI/MCP in
  tempo reale via SSE filtrati sul dipartimento.
- Composer goal per i consulenti, notifiche toast (eventi `notify`, `task.status→blocked`),
  switcher multi-tenant, login con ruoli.
- Slot UI "Project Manager — Fase 2" presente ma disabilitato.

---

## 8. Motore — moduli e interfacce (`src/lib/aios/*.mjs`)

ESM puro (node ≥ 18, nessuna dipendenza obbligatoria) così `scripts/demo.mjs` gira senza Next.

| Modulo | Esporta | Note |
|---|---|---|
| `frontmatter.mjs` | `parseFrontmatter(raw) → {meta, body}`, `serializeFrontmatter` | YAML piatto: scalari + liste `- voce` |
| `bus.mjs` | `class Bus` | `emitEvent(project, type, data, agent)`, `subscribe(fn)→unsub` |
| `store.mjs` | `class Store(projectsRoot)` | tenant scaffolding, `safePath` anti-traversal, mutex per file, JSONL append/read, state JSON |
| `registry.mjs` | `class Registry(agentsDir, bus)` | `load()`, `watch()`, `all()`, `get(id)`, `orchestrator()`, `directors()`, `expertsOf(dirId)`, `errors` |
| `tasks.mjs` | `class TaskManager(store, bus)`, `TASK_STATES`, `TRANSITIONS` | transizioni validate, history, eventi |
| `gateway.mjs` | `class McpGateway(configPath, store, bus, registry, tasks)` | `call(project, agentId, tool, payload, opts)`, whitelist enforcement + restrizione di modalità (`opts.allow`), logging |
| `modes.mjs` | `MODES`, `DEFAULT_MODE`, `getMode`, `listModes`, `effectiveTools`, `modeOverlay` | catalogo dichiarativo delle 5 modalità operative, senza dipendenze; restrizione **sottrattiva** della whitelist (§12) |
| `lifecycle.mjs` | `class Lifecycle(registry, bus)` | `spawn(project, agentId, byAgentId, taskId)`, `teardown(project, instanceId, reason)`, `active(project)`; enforcement gerarchico |
| `runners/mock.mjs` | `createRunner(deps)` | playbook deterministici guidati dal frontmatter |
| `runners/claude.mjs` | `createRunner(deps)` | Claude API reale (`@anthropic-ai/sdk`), tool-loop sul gateway |
| `engine.mjs` | `class Engine(deps)` | `submitGoal(project, text, byUser) → goal`, `waitFor(goalId)`, `overview(project)` |
| `pm.mjs` | `class ProjectManager(deps)` | Fase 2: `overview`, `chat`, `notifyConsultant`, `toggleChecklist`, `suggestNext`; subscriber `task.*`/`goal.*`/`delivery.produced` |
| `delivery.mjs` | `class DeliveryDesk(deps)` | `snapshot(project)` deterministico (nessun LLM) + `produce(project, {title, include, notes, byUser})` → dossier in `outputs/` (§12) |
| `auth.mjs` | `class Auth(usersPath)` | login sha256, sessioni token in-memory, ruoli |
| `system.mjs` | `getSystem() → Promise<sys>` | singleton su `globalThis.__AIOS__` (sopravvive a HMR), wiring bus→log persistenti, PM wiring |

Interfaccia runner (identica per mock e claude — `AIOS_RUNNER=mock|claude`):

```js
createRunner({registry, store, gateway, tasks}) → {
  decompose(project, goal, directors)              → [{department, description}]
  plan(project, director, macroGoal, experts)      → [{expertId, title}]
  runExpert(project, expert, task, goal, tools)    → {summary, outputs: [path]}   // tools.call(tool, payload)
  synthesize(project, director, macroGoal, reports)→ string
  aggregate(project, goal, directorReports)        → string  // markdown report finale
}
```

Flusso `submitGoal`:
1. `goal.created` → orchestratore legge `brief.md` → `decompose` → `goal.decomposed`,
   1 macro-obiettivo per dipartimento.
2. Per ogni Direttore (in parallelo): `plan` → task `pending→assigned` per esperto →
   `spawn` → task `in_progress` → `runExpert` (tool-loop MCP con whitelist del solo
   esperto) → task `review` + `agent.report` → `teardown` → il Direttore approva
   (`review→done`) → `synthesize` → aggiorna i propri `owns_files` → `agent.report` verso l'alto.
3. Orchestratore: `aggregate` → scrive `outputs/G-xxxx_report.md` → `goal.completed`.
   Errori per-esperto: task → `blocked` + `notify` warn; il goal prosegue con gli altri.

## 9. Fase 2 — Project Manager (implementato)

- Agente `level: pm` definito in `agents/project_manager.md`, ammesso nel Registry.
- Modulo `src/lib/aios/pm.mjs` (`class ProjectManager`): client del bus e dell'Engine,
  sopra l'Orchestratore. Metodi: `overview`, `chat`, `notifyConsultant`,
  `toggleChecklist`, `suggestNext`. Subscriber automatico su `task.status→review/blocked`
  e `goal.completed` → `pm.notification`.
- Eventi `pm.*` (`pm.notification`, `pm.suggestion`, `pm.question`) veicolati dal canale
  SSE esistente senza modifiche al bus.
- API `/api/pm/*` implementate (overview, suggestions, chat, notify, checklist), protette
  da `requireUser`.
- UI: console PM (`src/app/components/PMConsole.tsx`) accessibile dal chip topbar per
  tenant con `pm_enabled: true`.
- Notifiche email: audit trail in `state/pm_notifications.json` + extension point SMTP
  inattivo (coerente con `transport: internal`).
- Chat: rule-based in `AIOS_RUNNER=mock`, extension point LLM in `AIOS_RUNNER=claude`.
- `config/users.json` `pm_agent` resta disabilitato: il PM è un agente server-side
  guidato dal consulente loggato.
- Dettagli in `docs/FASE2_PM.md`.

## 10. Criteri di accettazione → dove sono soddisfatti

| Criterio | Dove |
|---|---|
| Home con soli 4 agenti | `src/app/page.tsx` (HomeGrid) |
| Drill-down con file e log | `/api/projects/:p/directors/:d` + pannello UI |
| Spawn/teardown tracciati | `logs/lifecycle.jsonl` + eventi `agent.spawned/teardown` |
| Nuovo sub-agente = solo un file .md | Registry + watch + playbook mock generico |

## 11. Configurazione LLM da UI + interazione diretta con gli agenti

Estensione della dashboard (non altera i contratti §1-§10):

- **Impostazioni LLM a runtime** (`src/lib/aios/settings.mjs`): provider
  (`mock | anthropic | openai`), base URL, chiavi API, modello e parametri di
  generazione (temperature, max_tokens, thinking) + override del modello per
  agente. Persistite in `config/llm_settings.local.json` (gitignored), lette
  **per chiamata** — il cambio ha effetto senza riavvio. Env
  (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`) resta il fallback. API: `GET/POST /api/settings`
  (chiavi mai restituite in chiaro). UI: pannello ⚙️ in topbar.
- **Astrazione provider** (`src/lib/aios/llm/{index,anthropic,openai}.mjs`): stessa
  interfaccia (`completeJSON`/`completeText`/`runToolLoop`) per Anthropic-protocol
  e OpenAI-compatibile. Il runner `runners/claude.mjs` la consuma; `system.mjs`
  costruisce un **dispatcher** che sceglie mock ↔ reale per chiamata secondo
  `settings.provider`.
- **Chat umano→agente** (`src/lib/aios/chat.mjs`): canale laterale che consente a
  un consulente di conversare con QUALSIASI singolo agente. NON viola la regola
  §4 (gli agenti fra loro restano solo-verticali): qui è l'umano a parlare con un
  agente. In modalità reale la chat usa un tool-loop limitato alla `mcp_whitelist`
  dell'agente (gateway + audit identici alle run). Storico in
  `state/agent_chat_<agentId>.json`. API: `GET/POST /api/projects/:p/agents/:a/chat`.
  Evento bus `agent.chat`.
- **Correzioni durevoli** (`src/lib/aios/agentEdit.mjs` → `appendInstruction`):
  una correzione diventa una "nota operativa" permanente in un blocco gestito del
  corpo di `agents/<id>.md`, quindi entra nel system prompt e vale anche nelle run
  future (hot-reload). API: `GET/POST /api/agents/:a/instructions`.
- **Editor capacità** (`agentEdit.mjs` → `setWhitelist`): concede/revoca i tool MCP
  dell'agente scrivendo `mcp_whitelist` nel frontmatter (validato contro
  `mcp/servers.json`, hot-reload). API: `GET/POST /api/agents/:a/capabilities`.

Caveat serverless (Vercel, FS read-only): settings/chat/note/whitelist non
persistono in produzione — usare env per le chiavi (vedi `docs/DEPLOY.md`).

## 12. Modalità operative e Consegna

Due estensioni pensate per il lavoro quotidiano del consulente: scegliere **come**
deve comportarsi l'agente in chat diretta, e vedere **a colpo d'occhio cosa è già
consegnabile al cliente**. Nessuna delle due altera i contratti §1-§10: la gerarchia,
la macchina a stati e la comunicazione solo-verticale restano invariate.

### 12.1 Modalità operative — `src/lib/aios/modes.mjs`

Catalogo dichiarativo di 5 modalità, senza dipendenze da altri moduli. Ogni modalità
descrive una postura del modello e l'insieme di strumenti a cui può attingere in
quella conversazione.

| id | | label | orchestra | strumenti dichiarati | scritture |
|---|---|---|---|---|---|
| `orchestrator` | 🧭 | Orchestratore | sì | `null` = tutta la `mcp_whitelist` dell'agente | sì |
| `architect` | 📐 | Architetto | no | `filesystem.fs_read`, `filesystem.fs_list`, `research.web_search`, `diagram.mermaid_generate` | no |
| `code` | ⌨️ | Code | no | `filesystem.fs_read`, `filesystem.fs_write`, `filesystem.fs_list`, `api.openapi_parse`, `diagram.mermaid_generate` | sì |
| `ask` | ❓ | Ask | no | `filesystem.fs_read`, `filesystem.fs_list`, `research.web_search` | no |
| `debug` | 🐞 | Debug | no | `filesystem.fs_read`, `filesystem.fs_list`, `api.http_probe`, `api.openapi_parse`, `tasks.task_update` | no |

`orchestrator` è la modalità base (`DEFAULT_MODE`) ed è l'unica con
`orchestrates: true`: solo lì l'invio del composer avvia il ciclo di §8 (goal →
direttori → esperti). Le altre quattro sono conversazioni one-shot con
l'Orchestratore, che non creano goal né task.

**Regola ferrea — le modalità sono SOTTRATTIVE.** Una modalità può solo restringere
la `mcp_whitelist` dell'agente, mai ampliarla. L'unica regola autorizzata vive in
`effectiveTools(agent, modeId)`:

```js
let tools = Array.isArray(agent?.mcp_whitelist) ? [...agent.mcp_whitelist] : [];
if (mode.tools) tools = tools.filter((t) => mode.tools.includes(t));   // intersezione
if (!mode.allow_writes) tools = tools.filter((t) => t !== 'filesystem.fs_write');
```

Il risultato è sempre un sottoinsieme della whitelist del frontmatter, che resta
l'unica fonte di autorità. Uno strumento dichiarato da una modalità ma non concesso
all'agente semplicemente non compare (la UI lo marca come non disponibile).

Doppio cancello lato gateway: `McpGateway.call(project, agentId, tool, payload, opts)`
applica prima la whitelist dell'agente (comportamento storico, invariato) e poi —
se il chiamante passa `opts.allow` — nega ciò che esce dalla modalità attiva, con
outcome `denied`, `reason` e `mode` nel log `mcp_calls.jsonl`. La firma è
retro-compatibile: senza `opts` nulla cambia.

Funzioni esportate: `getMode(id)` (id sconosciuto → `DEFAULT_MODE`, non lancia mai),
`listModes()` (catalogo pubblico per la UI, **senza** il campo `overlay`),
`effectiveTools(agent, modeId)`, `modeOverlay(modeId)`.
`modeOverlay` produce l'intestazione `--- MODALITÀ ATTIVA: <label> (<id>) ---` +
descrizione + regole di postura; la riga con la lista degli strumenti effettivi è
**deliberatamente** lasciata al chiamante, perché `modes.mjs` conosce la modalità ma
non l'agente a cui viene applicata.

La `mcp_whitelist` di `agents/orchestrator_core.md` è stata ampliata (sola lettura e
generazione: `fs_read`, `fs_write`, `fs_list`, `web_search`, `mermaid_generate`) così
che le modalità abbiano davvero qualcosa da restringere.

### 12.2 Chat diretta con modalità — `src/lib/aios/chat.mjs`

`send(project, agentId, message, byUser, modeId)`: risolve la modalità, calcola
`allow = effectiveTools(agent, mode.id)` e lo usa per costruire sia gli spec dei tool
sia il system prompt (`system_prompt` dell'agente + overlay di modalità + riga
`Strumenti disponibili in questa modalità: …` + blocco chat diretta + brief).
Il `callTool` passato al tool-loop è avvolto in `try/catch` e converte ogni eccezione
(inclusa la negazione del gateway) in `{ ok: false, error }`, così un tool fuori
modalità non interrompe la conversazione.

Persistenza invariata: **un solo thread per agente** in
`state/agent_chat_<agentId>.json`. Le voci portano `mode: <id>` sia sul turno umano
sia sulla risposta dell'agente; le voci storiche non hanno il campo e la UI degrada
sul default. L'evento bus `agent.chat` include anch'esso `mode`.

### 12.3 Consegna — `src/lib/aios/delivery.mjs`

`class DeliveryDesk({ registry, store, bus, tasks, engine, gateway, reportUsage })`,
esposta come `sys.delivery`. Risponde alla domanda «cosa possiamo già consegnare al
cliente?» separando nettamente lettura e produzione.

**`snapshot(projectId)` — deterministico, senza LLM e senza scritture.** Legge
`project.json`, i goal, i task e i file di `outputs/`, `delivery/`, `business/`,
`tech/`, più gli `owns_files` dei direttori. Regole di classificazione (in ordine di
applicazione, con deduplica per `path`: un file già contato non ricompare):

| origine | esito |
|---|---|
| goal `completed` con `report_path` | item `report` · `ready` · id `report:<goalId>` |
| task `done` con `outputs[]` | un item `output` · `ready` per path · id `output:<path>` |
| task `review` con `outputs[]` | item `output` · `partial` · nota «In attesa di approvazione del Direttore» |
| `owns_files` dei direttori | `knowledge` · `ready` se il file contiene almeno una riga `## Aggiornamento` **o** pesa > 200 byte; altrimenti gap «documento ancora al solo titolo» |
| altri file in `delivery/` | `knowledge` · `ready` · dipartimento `delivery` |
| task `blocked` | gap «task bloccato: richiede intervento» · id `gap:task:<taskId>` |
| task `pending`/`assigned`/`in_progress` | gap «lavorazione in corso» |
| task `review`/`done` **senza** `outputs[]` | gap «in attesa di approvazione, nessun deliverable prodotto» / «task chiuso senza deliverable» — così un task chiuso o in revisione a mani vuote non sparisce dal conteggio gonfiando la prontezza |

`readiness = { score, ready, partial, missing }` con `missing = gaps.length` e
`score = round(ready / (ready + partial + missing) * 100)`, `null` se il denominatore
è 0. Lo snapshot ritorna anche `goals[]` e `previous[]` (le consegne già prodotte,
`outputs/consegna_*.md`, più recenti prima). Ogni lettura degrada a lista vuota:
un progetto nuovo o parzialmente rotto renderizza invece di far crashare il pannello.
L'unico throw voluto è il tenant inesistente, che l'API traduce in 404.

**`produce(projectId, { title, include, notes, byUser })`.** Rigenera lo snapshot,
seleziona gli item indicati da `include` (array di `item.id`; vuoto = tutti i
`ready`, id sconosciuti ignorati) e compone un dossier markdown **client-facing**:
`# Consegna — <titolo>`, sintesi esecutiva, «Pronto alla consegna», «In lavorazione»,
«Non ancora disponibile», «Rischi aperti e prossimi passi», eventuali note del
consulente e gli allegati (contenuto integrale, troncato a 8000 caratteri con
marcatore `…(troncato)`).

Sintesi, tabelle ed evento `delivery.produced` leggono tutti gli stessi numeri
**riferiti al pacchetto** (gli item `selected`), non all'intero progetto: così la
sintesi non può dichiarare «16 documenti pronti» mentre le tabelle e gli allegati ne
elencano 1. Sintesi e rischi sono narrativi: in provider `mock` derivano
deterministicamente dai numeri del pacchetto; con un provider reale una singola
`completeText` sul modello dell'Orchestratore (system prompt dell'agente + istruzione
«cliente PMI non tecnico», prompt = JSON compatto del pacchetto senza allegati) e
`reportUsage(..., { phase: 'delivery' })` per la contabilità token. **Qualunque errore
ricade in silenzio sul testo deterministico**: il pacchetto si produce sempre. Alla UI
torna lo snapshot completo di progetto, con `previous[]` ricostruito **dopo** la
scrittura così il nuovo dossier compare senza refresh manuale.

La scrittura passa dal gateway MCP per conto dell'Orchestratore
(`filesystem.fs_write`), quindi mantiene audit e `file.updated`. Percorso
`outputs/consegna_YYYY-MM-DD_HHmm.md`, con suffisso `_2`, `_3`, … in caso di
collisione; le scritture sono serializzate per progetto perché due pacchetti
concorrenti non scelgano lo stesso nome. Senza Orchestrator_Core nel registry il
metodo lancia `Nessun Orchestrator_Core nel registry`.

Eventi emessi: `delivery.produced`
(`{path, title, ready, partial, missing, score, by, items[]}`) e un `notify` di
livello `success`. Il **Project Manager** (§9) è sottoscritto a `delivery.produced` e
genera una `pm.notification` «Pacchetto di consegna pronto» per i consulenti.

### 12.4 API e UI

- `GET /api/modes` → `{modes}`: catalogo statico, protetto da `requireUser`, senza
  segreti (l'`overlay` non esce mai dal server).
- `GET /api/projects/:p/delivery` → `{snapshot}`; 404 se il tenant non esiste.
- `POST /api/projects/:p/delivery` con `{title?, include?, notes?}` → 201
  `{delivery: {path, content}, snapshot}`. Validazione: `title` ≤ 120 caratteri,
  `include` lista di stringhe, `notes` ≤ 4000 caratteri; l'autore è
  `user.username`.
- `POST /api/projects/:p/agents/:a/chat` accetta il campo opzionale `mode`.
- UI: `ModeSelector.tsx` (chip `radiogroup` navigabili da tastiera, con tagline,
  descrizione e strumenti della modalità attiva) è usato dal `GoalComposer` in home e
  dalla `AgentChat` quando l'agente è l'Orchestratore; `DeliveryPanel.tsx` è il
  pannello «📦 Consegna» raggiungibile dalla topbar e dalla scheda Orchestratore, ed
  è esclusivo rispetto agli altri pannelli (Impostazioni, PM, chat).

Caveat serverless: come per §11, il dossier viene scritto in
`projects/<tenant>/outputs/` e su FS read-only (Vercel) non persiste.
