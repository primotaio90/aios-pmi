# AIOS — Dashboard di Automazione

AIOS è il sistema operativo aziendale AI-native di uno studio di 3 consulenti: una
piattaforma multi-tenant (1 cartella = 1 PMI cliente) in cui una gerarchia di agenti —
un Orchestratore, 3 Direttori di dipartimento e sub-agenti esperti attivati on-demand —
riceve gli obiettivi dei consulenti, li scompone in task, li esegue tramite un gateway
MCP dichiarativo con whitelist per agente e produce deliverable in Markdown. Tutta la
conoscenza è persistita in file `.md` e JSON dichiarativi (**zero stato nascosto**): ogni
evento, chiamata tool e spawn/teardown è tracciato in log JSONL per tenant. La dashboard
Next.js segue la regola del disvelamento progressivo: in home solo 4 schede, tutto il
dettaglio nei drill-down.

Contratto vincolante dell'architettura: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** ·
Fase 2 (Project Manager AI): **[docs/FASE2_PM.md](docs/FASE2_PM.md)**

---

## Architettura a 3 livelli

```
                        Consulenti (mrossi, lbianchi, gverdi)
                                       │  goal
                                       ▼
                     ┌─────────────────────────────────────┐
 LIVELLO 1           │          Orchestrator_Core          │   legge brief.md,
 (orchestrator)      │  decompose → macro-obiettivi → aggregate  scrive G-xxxx_report.md
                     └────────┬──────────┬──────────┬──────┘
                              │          │          │        (comunicazione SOLO verticale)
                              ▼          ▼          ▼
                     ┌──────────┐ ┌──────────┐ ┌──────────┐
 LIVELLO 2           │ Director │ │ Director │ │ Director │   plan → spawn → approvazione
 (director)          │ Business │ │   Tech   │ │ Delivery │   review→done → synthesize,
                     │ Strategy │ │Solutions │ │Operations│   aggiornano i propri owns_files
                     └────┬─────┘ └────┬─────┘ └────┬─────┘
                          │            │            │
                    spawn ▼      spawn ▼      spawn ▼
                     ┌─────────┐  ┌─────────┐  ┌─────────┐
 LIVELLO 3           │ expert_*│  │ expert_*│  │ expert_*│    on-demand: spawn →
 (expert, on-demand) │ (9+)    │  │         │  │         │    tool-loop MCP (whitelist)
                     └────┬────┘  └────┬────┘  └────┬────┘    → report → teardown
                          │            │            │
                          ▼            ▼            ▼
                     ┌─────────────────────────────────────┐
                     │   Gateway MCP (mcp/servers.json)    │  filesystem · research · data
                     │   whitelist per agente, tutto loggato │ diagram · api · tasks
                     └─────────────────────────────────────┘
```

Tutte le comunicazioni passano dall'event bus (`{ts, project, type, agent, data}`) e sono
persistite in `projects/<cliente>/logs/*.jsonl`.

## Quick start

```bash
npm install
npm run dev
# apri http://localhost:3000
```

Credenziali demo (password unica per tutti: `aios2026`):

| Username | Nome | Ruolo |
|---|---|---|
| `mrossi` | Marta Rossi | consultant |
| `lbianchi` | Luca Bianchi | consultant |
| `gverdi` | Giulia Verdi | consultant |

(Esiste anche l'account `pm_agent`, ruolo `project_manager`: **disabilitato**, riservato
alla Fase 2 — vedi [docs/FASE2_PM.md](docs/FASE2_PM.md).)

## Demo CLI (senza server HTTP)

Il motore è ESM puro (`src/lib/aios/*.mjs`, node ≥ 18) e gira anche fuori da Next:

```bash
node scripts/demo.mjs
```

Lo script esegue lo scenario end-to-end: creazione tenant → submit di un goal →
decomposizione → task → spawn/teardown degli esperti → report finale in
`projects/<cliente>/outputs/G-xxxx_report.md`.

## Modalità runner

| Modalità | Come | Note |
|---|---|---|
| `mock` (default) | `AIOS_RUNNER=mock` o variabile assente | Playbook deterministici guidati dal frontmatter (whitelist, keywords, `mock_summary`). Nessuna rete: i tool "esterni" restituiscono risultati simulati marcati `simulated: true`. |
| `claude` | `AIOS_RUNNER=claude` + `ANTHROPIC_API_KEY` | Claude API reale via `@anthropic-ai/sdk`, tool-loop sul gateway MCP. |

L'interfaccia runner (`decompose`, `plan`, `runExpert`, `synthesize`, `aggregate`) è
identica nelle due modalità: si scambia con una variabile d'ambiente, senza toccare codice.

## Aggiungere un sub-agente = un solo file `.md`

Il Registry scandisce `agents/` a runtime (`fs.watch`): creare
`agents/<id>.md` basta perché l'agente sia caricato, validato e subito operativo anche in
mock (playbook generico guidato dal frontmatter). Esempio completo:

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
Sei Expert_Market_Analyst... (il corpo del file è il system prompt completo)
```

Regole di validazione (vedi §2 di [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)): `id` =
nome file; `level: expert` richiede un `director` esistente; ogni voce di `mcp_whitelist`
deve esistere in `mcp/servers.json` come `server.tool`. Un agente invalido non blocca il
sistema: viene escluso e l'errore è esposto da `GET /api/agents` (campo `errors`).

## Struttura cartelle

```
AIOS/
├── agents/                  # 1 file .md = 1 agente (unica fonte di verità)
├── mcp/servers.json         # gateway MCP dichiarativo (server → tool)
├── config/users.json        # consulenti + ruolo project_manager riservato (Fase 2)
├── projects/<cliente>/      # multi-tenant: project.json, brief.md,
│                            #   business/ tech/ delivery/ dati/ outputs/,
│                            #   logs/{events,mcp_calls,lifecycle}.jsonl,
│                            #   state/{goals,tasks}.json
├── scripts/demo.mjs         # scenario demo end-to-end senza server HTTP
├── src/lib/aios/            # motore ESM (bus, store, registry, tasks, gateway,
│                            #   lifecycle, runners/{mock,claude}, engine, auth, system)
├── src/app/api/             # route handlers Next.js (contratto §6 di ARCHITECTURE.md)
├── src/app/                 # dashboard (disvelamento progressivo)
└── docs/                    # ARCHITECTURE.md (contratto) + FASE2_PM.md
```

## Criteri di accettazione → dove verificarli

| Criterio | Dove verificarlo |
|---|---|
| Home con soli 4 agenti (Orchestratore + 3 Direttori) | `src/app/page.tsx` (HomeGrid); a occhio su http://localhost:3000 dopo il login |
| Drill-down direttore con file `.md` e log in tempo reale | `GET /api/projects/:p/directors/:d` + pannello UI; SSE su `GET /api/events?project=` |
| Spawn/teardown dei sub-agenti tracciati | `projects/<cliente>/logs/lifecycle.jsonl` + eventi `agent.spawned` / `agent.teardown` in `logs/events.jsonl` |
| Whitelist MCP rispettata (chiamate fuori lista negate ma loggate) | `projects/<cliente>/logs/mcp_calls.jsonl` (`outcome: ok\|denied\|error`) |
| Nuovo sub-agente = solo un file `.md`, zero codice | crea un file in `agents/` e ricontrolla `GET /api/agents` (Registry + `fs.watch` + playbook mock generico) |
| Macchina a stati dei task validata | `src/lib/aios/tasks.mjs` (`TRANSITIONS`) + `state/tasks.json` (campo `history`) |
| Multi-tenant con sandbox per progetto | `POST /api/projects` (scaffolding) + `safePath` anti-traversal in `src/lib/aios/store.mjs` |
| Predisposizione Fase 2 senza implementazione | `/api/pm/*` → 501; account `pm_agent` disabilitato; flag `pm_enabled` in `project.json`; slot UI disabilitato |

## Cartelle legacy v1

`data/` e `config/agents_config.json` sono l'archivio della v1: **non sono più letti dal
sistema** e restano solo come riferimento storico. Le fonti di verità attuali sono
`agents/*.md`, `mcp/servers.json`, `config/users.json` e `projects/<cliente>/`.

## Deploy (GitHub + Vercel)

La piattaforma è pronta per essere messa online: repository su GitHub per
collaborare con il team + deploy automatico su Vercel per avere un dominio
utilizzabile. L'autenticazione resta demo per ora; Clerk/altre soluzioni si
aggiungono in una fase successiva.

👉 **Guida passo-passo completa**: [docs/DEPLOY.md](docs/DEPLOY.md)

> ⚠️ **Nota importante**: l'architettura attuale persiste su filesystem + stato
> in-memory. Su Vercel serverless il FS è read-only e lo stato non persiste tra
> le invocation, quindi le **scritture non sono persistenti** in produzione.
> Va benissimo come demo; per uso reale serve migrare lo storage a un backend
> esterno (DB/Blob/Redis) — vedi il caveat nel DEPLOY.md.

## Documentazione

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — architettura e contratti (vincolante).
- [docs/FASE2_PM.md](docs/FASE2_PM.md) — predisposizione del Project Manager AI (Fase 2).
- [docs/DEPLOY.md](docs/DEPLOY.md) — guida deploy su GitHub + Vercel + caveat serverless.
