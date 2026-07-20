# Fase 2 — Project Manager AI (implementato)

Il Project Manager (PM) è l'agente posizionato **tra i consulenti umani e
l'Orchestratore**: si consulta con gli umani, coordina i consulenti e interroga
l'Orchestratore. È ora **implementato** come client del bus e dell'Engine
(`src/lib/aios/pm.mjs`), sopra l'Orchestratore, rispettando la comunicazione
solo verticale del sistema.

## Posizione nella gerarchia

```
        ┌───────────────────────────────┐
        │   PROJECT MANAGER (Fase 2)    │  ← si consulta con gli umani,
        └───────┬───────────────┬───────┘    assegna compiti ai consulenti,
                │               │            interroga l'Orchestratore
   [ 3 CONSULENTI UMANI ]       │
                │               ▼
              [ ORCHESTRATOR_CORE ]
                        │
        business ── tech ── delivery  (invariati)
```

## Cosa è implementato

| Componente | Dove | Dettaglio |
|---|---|---|
| Definizione agente | `agents/project_manager.md` | `level: pm`, `department: core`, system prompt del ruolo (dialogo, checklist, notifiche, coordinamento). |
| Livello `pm` nel Registry | `src/lib/aios/registry.mjs` | `LEVELS` ammette `pm`; `pm()` espone l'agente; non contato tra orchestrator/director/expert. |
| Modulo PM | `src/lib/aios/pm.mjs` | `class ProjectManager`: overview, chat, notifyConsultant, toggleChecklist, suggestNext, subscriber automatico su `task.status→review/blocked` e `goal.completed`. |
| Wiring | `src/lib/aios/system.mjs` | PM istanziato e `start()`-ato nel singleton (subscribe al bus, emissione `pm.*`). |
| API | `src/app/api/pm/[[...path]]/route.ts` | `GET /api/pm?project=`, `GET /api/pm/suggestions`, `POST /api/pm` con `action: chat\|notify\|checklist`. Protette da `requireUser`. |
| Tipi client | `src/app/lib/types.ts` | `PMOverview`, `ChecklistItem`, `PMNotification`, `PMChatMessage`, `PMSuggestion`, ecc. |
| Metodi API client | `src/app/lib/api.ts` | `pmOverview`, `pmSuggestions`, `pmChat`, `pmNotify`, `pmToggleChecklist`. |
| Console UI | `src/app/components/PMConsole.tsx` | 4 zone: KPI strip, checklist interattiva, dialogo, notifiche-email (audit + composer). Refresh live su eventi `pm.*`/`task.*`/`goal.*` via SSE. |
| Ingresso UI | Topbar | Chip "PM · Fase 2" cliccabile, abilitato per tenant con `pm_enabled: true`. |
| Feature flag per tenant | `projects/<cliente>/project.json` | `pm_enabled: true` sui tenant demo (`pastificio-gallo`, `rovere-arredamenti`). |
| Interfacce consumate | `src/lib/aios/engine.mjs` | Il PM usa `listGoals` dell'Engine + `TaskManager.list` (sola lettura, mai scrittura sullo stato del motore). |
| Ruolo utente riservato | `config/users.json` | `pm_agent` resta `disabled: true`: il PM è un agente server-side guidato dal consulente loggato, non un utente che fa login. |

## Piano di attivazione (completato)

1. **Definizione agente**: `agents/project_manager.md` con `level: pm` ammesso nel
   Registry (`LEVELS` + `pm()`). ✅
2. **Modulo PM**: `src/lib/aios/pm.mjs` — client del bus e dell'Engine:
   - si sottoscrive a `task.status` / `goal.completed` per generare notifiche automatiche;
   - offre `overview()` (KPI + checklist derivata), `chat()` (rule-based mock / LLM claude),
     `notifyConsultant()` (audit trail + extension point SMTP), `toggleChecklist()`,
     `suggestNext()`;
   - emette `pm.suggestion`, `pm.notification`, `pm.question` sul bus (la UI li mostra
     via SSE senza modifiche al canale).
3. **API**: `/api/pm/*` implementate (overview, suggestions, chat, notify, checklist),
   protette da `requireUser` (consultant o project_manager). ✅
4. **UI**: il chip in topbar apre la console PM per tenant con `pm_enabled`. ✅
5. **Account**: `pm_agent` resta disabilitato — il PM è un agente server-side guidato
   dal consulente loggato, non un login separato.

## Sequenza di interazione prevista

```
Consulente          PM (Fase 2)              Orchestratore
    │  "priorità della       │                      │
    │   settimana?"          │                      │
    │───────────────────────▶│  engine.overview()   │
    │                        │─────────────────────▶│
    │                        │◀─────────────────────│
    │◀───────────────────────│  pm.suggestion       │
    │  approva / corregge    │  (bus + SSE → UI)    │
    │───────────────────────▶│                      │
    │                        │  pm.assignment ai 3  │
    │                        │  consulenti + goal   │
    │                        │  engine.submitGoal() │
    │                        │─────────────────────▶│
```

Il PM **non** parla mai con i Direttori né con i sub-agenti: resta sopra
l'Orchestratore, rispettando la comunicazione solo verticale del sistema.

## Notifiche email (approccio audit-trail)

Ogni notifica è persistita in `state/pm_notifications.json` ed emessa come evento
`pm.notification` sul bus (visibile in UI via SSE). L'invio SMTP reale è un
**extension point dichiarato ma inattivo**, coerente con `transport: internal`
(nessuna rete): il campo `transport: 'audit'` marca ogni record. Attivare SMTP
reale significherà aggiungere un transport e una chiamata in `notifyConsultant()`,
senza toccare il contratto del bus né la UI.

## Chat (approccio mock/claude)

La chat è rule-based in `AIOS_RUNNER=mock` (risposte derivate dallo stato del progetto
e dalle keyword del messaggio) e usa lo stesso system prompt dell'agente come extension
point per un LLM reale in `AIOS_RUNNER=claude` — coerente con il pattern degli altri
runner. La cronologia è persistita in `state/pm_chat.json` (max 100 messaggi).
