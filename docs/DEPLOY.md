# Deploy di AIOS su host persistente (Fly.io)

AIOS non è un'applicazione stateless: tiene **stato vivo in memoria di processo** e
**scrive su filesystem**. Per questo il target di deploy è un host con **processo
persistente e disco scrivibile**, non una piattaforma serverless. Questa guida copre
il deploy su **Fly.io** dall'account vuoto all'app raggiungibile, più backup/restore
del volume e gestione utenti.

> **Esecuzione locale** — distinta dal deploy — resta `npm run dev` (vedi §8).

---

## 1. Perché NON Vercel (né altre piattaforme serverless)

Non è una preferenza: è un'incompatibilità tecnica. Tre componenti vivono **in
memoria di un singolo processo Node** e muoiono se il processo viene fermato,
riavviato o replicato:

1. **Coda approvazioni** — [`src/lib/aios/autonomy.mjs`](../src/lib/aios/autonomy.mjs)
   (`ApprovalQueue`). I resolver delle approvazioni `ask` sono `Promise` in memoria.
   Una chiamata `ask` dalla chat interattiva attende con `timeoutMs = null`, cioè
   **tiene una richiesta HTTP aperta a tempo indefinito** aspettando una decisione
   umana. Su serverless la funzione ha un timeout di esecuzione (10–60s): la
   richiesta muore prima che un umano possa rispondere.
2. **Stream SSE** — [`src/app/api/events/route.ts`](../src/app/api/events/route.ts).
   Un `ReadableStream` in-process agganciato al `Bus` in memoria. Su serverless ogni
   invocation è isolata: l'event bus non esiste "cross-invocation", quindi lo stream
   non riceve nulla. Su più repliche, ogni replica vedrebbe solo i propri eventi.
3. **Run del motore** — [`src/lib/aios/engine.mjs`](../src/lib/aios/engine.mjs).
   Orchestrazioni multi-step (Orchestratore → Direttori → Expert) più lunghe di una
   singola richiesta, con stato in memoria.

In più, tutto lo stato mutabile è su **filesystem** (`projects/<tenant>/...`,
`config/llm_settings.local.json`, frontmatter di `agents/*.md`), e il FS serverless
è **read-only** (tranne `/tmp` effimero).

**Conseguenza concreta se qualcuno riproponesse Vercel fra tre mesi:** l'app si
avvia e la dashboard si vede, ma il login si perde a ogni richiesta, non si può
creare un progetto, i log non si scrivono, lo stream SSE è morto e le approvazioni
vanno in timeout. Non è una scorciatoia: è metà prodotto rotto. Serve un processo
sempre acceso con un disco — da qui Fly.io.

---

## 2. Il vincolo architetturale: UNA sola istanza, sempre accesa

Proprio perché lo stato è in memoria di processo, la configurazione Fly è vincolata
(già scritta come commenti in [`fly.toml`](../fly.toml)):

- esattamente **1 macchina**, mai autoscaling;
- **nessuno stop automatico** per inattività (`auto_stop_machines = false`,
  `min_machines_running = 1`) — uno stop uccide le approvazioni in attesa e gli
  stream SSE aperti;
- **nessun deploy rolling** che tenga due istanze vive insieme sullo stesso volume
  (corromperebbe i log JSONL a scrittore singolo).

Chi modificherà `fly.toml` deve capire che **scalare non è un'opzione** senza prima
migrare lo stato a un backend esterno (decisione futura, fuori scope qui).

---

## 3. Dove vivono i dati (confine git / immagine / volume)

Tre destini distinti, da non confondere:

| Contenuto | Git | Immagine Docker | Volume `/data` |
|---|---|---|---|
| Codice (`src/`, `package.json`, …) | ✅ | ✅ | — |
| Catalogo MCP `mcp/servers.json` (sola lettura) | ✅ | ✅ (seed) | ✅ (copiato al 1° boot) |
| Definizioni agenti `agents/*.md` (lette **e scritte**) | ✅ | ✅ (seed) | ✅ (copiate al 1° boot) |
| Utenti `config/users.json` | ✅ | ✅ (seed) | ✅ (copiato al 1° boot) |
| **`projects/<tenant>/` — dati mutabili dei clienti** | ❌ | ❌ | ✅ **solo qui** |
| **`config/llm_settings.local.json` — API key** | ❌ | ❌ | ✅ **solo qui** |

**I dati dei tenant vivono SOLO sul volume**, non nel repo e non nell'immagine:
`projects/` è in `.gitignore` e in `.dockerignore`. L'unico modo di portarli via è
il **backup del volume** (§6). `llm_settings.local.json` contiene le API key: non è
seedato, lo crea il pannello Impostazioni sul volume al primo salvataggio.

---

## 4. Procedura Fly.io: da account vuoto ad app raggiungibile

Prerequisiti: account Fly.io (la creazione e il `fly deploy` li fai tu — questa
guida prepara solo configurazione e comandi) e [`flyctl`](https://fly.io/docs/flyctl/install/)
installato.

### 4.1 Login e app
```bash
fly auth login
# Crea l'app SENZA deployare (il nome deve corrispondere a `app` in fly.toml).
fly apps create aios        # o il nome che preferisci: aggiorna fly.toml di conseguenza
```

### 4.2 Volume persistente
```bash
# 1 GB nella stessa regione di fly.toml (primary_region). Il nome DEVE essere
# "aios_data" per matchare [[mounts]].source.
fly volumes create aios_data --region fra --size 1
```

### 4.3 Secret (MAI nel repo)
Le chiavi arrivano via `flyctl`, mai committate:
```bash
fly secrets set AIOS_RUNNER=claude
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
# oppure, per il provider OpenAI-compatibile:
fly secrets set OPENAI_API_KEY=sk-...
```
> In alternativa alle chiavi via secret, puoi partire con `AIOS_RUNNER=mock` e
> impostare provider + chiavi dal **pannello Impostazioni (⚙️)** della dashboard:
> vengono scritte su `config/llm_settings.local.json` **sul volume** e hanno
> precedenza sulle env.

### 4.4 Primo deploy
```bash
fly deploy
```
Al primo avvio l'entrypoint [`scripts/docker-entrypoint.sh`](../scripts/docker-entrypoint.sh)
popola il volume con il seed vergine (`agents/`, `mcp/`, `config/users.json`)
**copiando solo i file assenti**. I riavvii successivi non sovrascrivono nulla.

### 4.5 Verifica
```bash
fly status                 # 1 macchina "started"
fly logs                   # [entrypoint] seeding … + avvio server
fly open                   # apre https://<app>.fly.dev → schermata di login
```
Accedi con un utente demo (§7). Il pill "live" in topbar indica che lo stream SSE
è attivo. Crea un progetto di prova: deve comparire e sopravvivere a un
`fly deploy` successivo.

---

## 5. Schema di seeding (perché è fatto così)

Il seeding è **idempotente e non distruttivo**: l'immagine contiene una copia
"vergine" dello stato mutabile sotto `/app/seed/`, e l'entrypoint la copia sul
volume **solo per i file mancanti** (`cp -n`, no-clobber). In questo modo:

- un **redeploy** non perde i dati (il volume è già popolato → niente da copiare);
- un **riavvio** non sovrascrive le note/whitelist/autonomia che i consulenti hanno
  scritto nel frontmatter degli agenti, né gli utenti aggiunti in `users.json`;
- **nessun segreto** entra nell'immagine (`llm_settings.local.json` non è seedato).

Alternativa scartata: montare solo `projects/` sul volume e tenere `agents/` e
`config/` nell'immagine. Sarebbe più semplice ma **sbagliato**, perché
[`agentEdit.mjs`](../src/lib/aios/agentEdit.mjs) **scrive** nel frontmatter degli
agenti (note operative, `mcp_whitelist`, liste di autonomia) e l'auth **legge**
`config/users.json`: entrambi devono vivere sul volume persistente. Il registry
sorveglia `agents/` con `fs.watch` per il reload a caldo (verificato funzionare sul
volume montato, §9).

---

## 6. Backup e restore del volume — LA SEZIONE PIÙ IMPORTANTE

Se un consulente ci mette il lavoro di un cliente reale, **questo è l'unico modo di
non perderlo**. I dati non sono altrove.

### 6.1 Snapshot gestito (consigliato)
```bash
fly volumes list
fly volumes snapshots list aios_data          # snapshot automatici giornalieri
# Fly crea snapshot automatici; per forzarne uno prima di un'operazione rischiosa:
fly volumes create aios_data --region fra --size 1 --snapshot-id <id>   # restore in un NUOVO volume
```
Il restore crea un **nuovo volume** da uno snapshot; per usarlo si stacca il vecchio
e si attacca il nuovo (richiede `fly machines update`, operazione da fare a macchina
ferma).

### 6.2 Dump manuale via SFTP (per portare via i dati)
```bash
# Apre una console SFTP sulla macchina e scarica tutto il volume in locale.
fly ssh sftp get -r /data ./backup-aios-$(date +%Y%m%d)
```
Ottieni una copia locale completa di `projects/`, `agents/`, `config/`, `mcp/`.

### 6.3 Restore da dump manuale
```bash
# Con la macchina ferma, ricarica il contenuto sul volume.
fly ssh sftp put -r ./backup-aios-20260725/. /data
```

> **Regola d'oro:** prima di qualsiasi cambio a `fly.toml`, alla regione o al
> volume, fai uno snapshot o un dump. Un volume cancellato **non è recuperabile**.

---

## 7. Aggiungere un utente

Gli utenti vivono in `config/users.json` **sul volume** (seedato al primo boot, poi
modificabile senza ricostruire l'immagine). La password è uno SHA-256 hex.

```bash
# 1. Genera l'hash della password (in locale):
node -e "console.log(require('crypto').createHash('sha256').update('LA_PASSWORD').digest('hex'))"

# 2. Apri una console sulla macchina e modifica il file sul volume:
fly ssh console
# dentro la macchina:
#   vi /data/config/users.json   → aggiungi un oggetto:
#   { "username": "prossi", "name": "Paolo Rossi", "role": "consultant",
#     "password_sha256": "<hash del punto 1>" }
```
Al prossimo login il nuovo utente è attivo (l'auth rilegge il file a ogni login,
nessun riavvio necessario). Gli account demo iniziali sono in `config/users.json`
del repo (password `aios2026`): **cambiali prima di metterci un cliente reale.**

---

## 8. Esecuzione locale (distinta dal deploy)

Il deploy sopra è per la produzione. In sviluppo resta tutto com'è:
```bash
npm install
npm run dev        # http://localhost:3000, AIOS_ROOT = radice del repo
node scripts/demo.mjs   # demo end-to-end senza server HTTP (scaffolda il tenant se assente)
```
In locale `AIOS_ROOT` **non** va definita: il fallback in
[`src/lib/aios/paths.mjs`](../src/lib/aios/paths.mjs) risolve la radice del repo.
`projects/` locale è ignorata da git, quindi una clone fresca parte senza tenant:
la demo li crea da sola.

---

## 9. Verifica locale della build di produzione

Prima di `fly deploy` puoi provare l'immagine e il seeding in locale (richiede Docker):
```bash
docker build -t aios .
docker volume create aios_data
docker run --rm -p 3000:3000 -v aios_data:/data \
  -e AIOS_RUNNER=mock aios
# → http://localhost:3000, login, crea un progetto, pill "live" attivo.
# Riavvia il container: i dati del volume sopravvivono e il seeding non sovrascrive.
```
Verifiche coperte in fase di sviluppo (su questa macchina, senza Docker): seeding
idempotente riprodotto in shell, `resolveRoot()` con/senza `AIOS_ROOT`, build di
produzione (`npm run build && npm start`) con `ROOT` risolta alla radice del repo,
`fs.watch` su `agents/` che rileva modifiche a caldo.

---

## 10. Alternativa: Render (sintetico)

Se emergesse un ostacolo concreto con Fly.io, **Render** è l'unica alternativa
accettabile, a queste condizioni:

- **Web Service a pagamento** (il piano free spegne per inattività → uccide
  approvazioni e SSE, esattamente il problema di §2);
- **Persistent Disk** montato su `/data`, con `AIOS_ROOT=/data`;
- **1 sola istanza** (nessun autoscaling), deploy non-rolling;
- stesso `Dockerfile` e stesso entrypoint di seeding.

Non è stata scelta come prima opzione solo perché il persistent disk è legato al
piano a pagamento e il controllo su volume/snapshot è meno diretto che su Fly.

---

## 11. Autenticazione: stato attuale

- **Oggi**: auth custom con `config/users.json` + cookie `aios_token`, sessioni in
  memoria (il singleton sopravvive a HMR in dev, e a ogni richiesta su host
  persistente). Va bene per pochi utenti fidati.
- **Roadmap**: un provider esterno (Auth.js/Clerk) resta una fase successiva e
  separata. **Nota:** `docs/CLERK_REVERT_NOTES.md` è **obsoleto** — il revert a
  Clerk è completo (nessun middleware, nessun `UserButton`, nessuna dipendenza
  Clerk); quel file descrive uno stato intermedio ormai superato ed è mantenuto
  solo come memoria storica.

---

## 12. Troubleshooting

- **L'app si avvia ma "nessun progetto" / login che non persiste dopo un deploy**:
  il volume non è montato o `AIOS_ROOT` non punta a `/data`. Controlla
  `fly.toml` (`[[mounts]]` + `[env]`) e `fly logs` per la riga `[entrypoint]`.
- **`fly deploy` si lamenta del volume**: il nome in `fly volumes create` deve
  essere esattamente `aios_data` e nella stessa `primary_region`.
- **Le approvazioni vanno sempre in timeout**: quasi certamente più di una macchina
  attiva o auto-stop riacceso. Verifica `fly scale show` → deve essere 1, e
  `auto_stop_machines = false`.
- **`AIOS_RUNNER=claude` non risponde**: la chiave non è impostata o non valida —
  `fly secrets list` (mostra i nomi, non i valori) e re-imposta con `fly secrets set`.
- **Dopo un redeploy gli agenti hanno perso le note**: il seeding ha sovrascritto.
  Non deve succedere (copia solo file assenti); se accade, segnala il bug e
  ripristina dal backup (§6).
