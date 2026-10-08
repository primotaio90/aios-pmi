# Deploy di AIOS su host persistente (Fly.io)

AIOS non è un'applicazione stateless: tiene **stato vivo in memoria di processo** e
**scrive su filesystem**. Per questo il target di deploy è un host con **processo
persistente e disco scrivibile**, non una piattaforma serverless. Questa guida copre
il deploy su **Fly.io** dall'account vuoto all'app raggiungibile, più backup/restore
del volume e gestione utenti.

> **Esecuzione locale** — distinta dal deploy — resta `npm run dev` (vedi §9).

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

> ⚠️ **`fly volumes create` ti consiglierà di sbagliare.** Stampa questo avviso:
> *«Every volume is pinned to a specific physical host. You should create two or
> more volumes per application to avoid downtime.»* È un buon consiglio per
> un'app stateless replicabile, ed è **il consiglio sbagliato per AIOS**: un
> secondo volume è esattamente ciò che consente a una seconda macchina di
> esistere, e due macchine rompono coda approvazioni, SSE e run del motore —
> senza un errore da mostrare, il che è la parte peggiore. **Un volume solo, ed è
> quello il presidio.** Il rischio di guasto dell'host è accettato consapevolmente
> e coperto dagli snapshot automatici (§7), non da una seconda copia viva.
> Verifica di avere una macchina sola con `fly status`: la colonna deve
> contenere una riga, non due.

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
il **backup del volume** (§7). `llm_settings.local.json` contiene le API key: non è
seedato, lo crea il pannello Impostazioni sul volume al primo salvataggio.

> **Attenzione alle tre righe "copiato al 1° boot".** Dopo quel primo boot la copia
> sul volume è la sorgente di verità: cambiarle nel repo e ridiployare **non** le
> aggiorna. Procedura di aggiornamento in **§6**.

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
Accedi con un utente demo (§8). Il pill "live" in topbar indica che lo stream SSE
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

Il rovescio della medaglia è che catalogo MCP e agenti già presenti si "congelano"
alla versione del primo boot: come aggiornarli è in **§6**.

Alternativa scartata: montare solo `projects/` sul volume e tenere `agents/` e
`config/` nell'immagine. Sarebbe più semplice ma **sbagliato**, perché
[`agentEdit.mjs`](../src/lib/aios/agentEdit.mjs) **scrive** nel frontmatter degli
agenti (note operative, `mcp_whitelist`, liste di autonomia) e l'auth **legge**
`config/users.json`: entrambi devono vivere sul volume persistente. Il registry
sorveglia `agents/` con `fs.watch` per il reload a caldo (verificato funzionare sul
volume montato, §10).

---

## 6. Aggiornare catalogo MCP e definizioni agente dopo il primo deploy

> **Leggi questa sezione prima di chiederti «perché non vedo il tool nuovo?».**

Conseguenza diretta del seeding non distruttivo (§5): **dopo il primo boot il volume
è la sorgente di verità, non il repo.** Il gateway legge `ROOT/mcp/servers.json` e il
registry legge `ROOT/agents/*.md`, cioè le copie **sul volume**. Modificare quei file
nel repo e rifare `fly deploy` **non li porta in produzione**: il file esiste già sul
volume, quindi il seeding lo salta.

Comportamento verificato su container reale (immagine ricostruita, stesso volume):

| Modifica nel repo | Arriva con un redeploy? |
|---|---|
| **Nuovo** file agente `agents/<nuovo>.md` | ✅ sì — è assente dal volume, il seeding lo copia |
| Modifica al system prompt di un agente **esistente** | ❌ no — il file esiste già |
| Nuovo tool / server in `mcp/servers.json` | ❌ no — il file esiste già |
| Nuovo utente in `config/users.json` | ❌ no — il file esiste già (vedi §8) |

Non è un bug: è ciò che impedisce a un redeploy di cancellare le note operative dei
consulenti, le `mcp_whitelist` e le liste di autonomia. Ma va fatto a mano.

### 6.1 Aggiornare il catalogo MCP (`mcp/servers.json`)

Il catalogo è **di sola lettura** per l'applicazione: nessun consulente ci scrive
sopra, quindi si può sovrascrivere in blocco senza perdere nulla. L'immagine appena
deployata contiene già la versione nuova sotto `/app/seed/`:

```bash
fly ssh console
# dentro la macchina — copia mirata dal seed dell'immagine al volume:
cp /app/seed/mcp/servers.json /data/mcp/servers.json
chown aios:aios /data/mcp/servers.json
exit
```
**Nessun riavvio necessario**: il gateway rilegge il catalogo, il tool nuovo compare
subito nelle capability degli agenti che lo hanno in whitelist (verificato).

### 6.2 Aggiornare la definizione di un agente esistente

Qui **non** si sovrascrive in blocco. Il file sul volume contiene il lavoro del
consulente, che il seed dell'immagine non ha:

- il blocco `<!-- AIOS-NOTES:START --> … <!-- AIOS-NOTES:END -->` in fondo al corpo
  (note operative aggiunte dalla dashboard);
- `mcp_whitelist`, `auto_approve` / `ask_approve` / `never_approve` nel frontmatter,
  riscritti da [`agentEdit.mjs`](../src/lib/aios/agentEdit.mjs).

Un `cp` dal seed **cancella tutto questo**. La procedura corretta è modificare il
corpo *sul posto*, lasciando intatti frontmatter e blocco note:

```bash
fly ssh console
# 1. Guarda cosa perderesti con una sovrascrittura in blocco:
diff /app/seed/agents/expert_market_analyst.md /data/agents/expert_market_analyst.md
# 2. Modifica SOLO il testo del system prompt, sopra <!-- AIOS-NOTES:START -->:
vi /data/agents/expert_market_analyst.md
exit
```
Anche qui **niente riavvio**: il registry sorveglia `agents/` con `fs.watch` e
ricarica a caldo (verificato sul volume montato).

Se la riscrittura è talmente ampia da rendere più semplice ripartire dal seed, fai
prima un backup del file (§7) e **reincolla a mano** il blocco note e le whitelist.

### 6.3 Cosa NON toccare mai sul volume

| Percorso | Perché |
|---|---|
| `/data/projects/**` | Dati dei clienti. Solo l'app ci scrive; i log `events.jsonl` sono append-only a scrittore singolo. |
| `/data/config/llm_settings.local.json` | Contiene le API key, scritto dal pannello Impostazioni. Non esiste nel seed: sovrascriverlo significa perdere le chiavi. |
| `/data/config/users.json` | Sovrascrivere dal seed **cancella gli utenti aggiunti** (§8). Per aggiungerne uno, modifica il file, non copiarlo. |
| Proprietario dei file | Tutto sotto `/data` deve restare `aios:aios`. Se copi da root ricordati `chown aios:aios`, altrimenti l'app non può più scrivere. |

---

## 7. Backup e restore del volume — LA SEZIONE PIÙ IMPORTANTE

Se un consulente ci mette il lavoro di un cliente reale, **questo è l'unico modo di
non perderlo**. I dati non sono altrove.

### 7.1 Snapshot gestito (consigliato)
```bash
fly volumes list
fly volumes snapshots list aios_data          # snapshot automatici giornalieri
# Fly crea snapshot automatici; per forzarne uno prima di un'operazione rischiosa:
fly volumes create aios_data --region fra --size 1 --snapshot-id <id>   # restore in un NUOVO volume
```
Il restore crea un **nuovo volume** da uno snapshot; per usarlo si stacca il vecchio
e si attacca il nuovo (richiede `fly machines update`, operazione da fare a macchina
ferma).

### 7.2 Dump manuale via SFTP (per portare via i dati)
```bash
# Apre una console SFTP sulla macchina e scarica tutto il volume in locale.
fly ssh sftp get -r /data ./backup-aios-$(date +%Y%m%d)
```
Ottieni una copia locale completa di `projects/`, `agents/`, `config/`, `mcp/`.

### 7.3 Restore da dump manuale
```bash
# Con la macchina ferma, ricarica il contenuto sul volume.
fly ssh sftp put -r ./backup-aios-20260725/. /data
```

> **Regola d'oro:** prima di qualsiasi cambio a `fly.toml`, alla regione o al
> volume, fai uno snapshot o un dump. Un volume cancellato **non è recuperabile**.

---

## 8. Aggiungere un utente

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

## 9. Esecuzione locale (distinta dal deploy)

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

## 10. Verifica locale della build di produzione

Prima di `fly deploy`, prova l'immagine **davvero**: i difetti dello strato container
non si vedono lanciando il server standalone in locale.

```bash
docker build -t aios .

# Volume di prova reso root:root, come arriva un volume Fly appena creato.
# Senza questo passo il test NON riproduce la condizione di produzione.
docker volume create aios_data
docker run --rm -v aios_data:/data alpine chown -R root:root /data

docker run -d --name aios -p 3000:3000 -v aios_data:/data -e AIOS_RUNNER=mock aios
docker logs aios          # righe [entrypoint]: seeding, chown, "avvio server come aios"
```

Controlli che devono passare tutti:
```bash
# 1. Il container resta UP (non esce): il seeding ha potuto scrivere sul volume.
docker ps --filter name=aios

# 2. Il processo Node NON è root (deve dare Uid: 100).
docker exec aios cat /proc/1/status | grep -E '^(Uid|Gid):'
docker exec -u aios aios id

# 3. Health check di fly.toml → 200 (e non 404).
curl -o /dev/null -w '%{http_code}\n' http://localhost:3000/

# 4. Login + creazione progetto, poi verifica che i file siano SUL VOLUME.
docker run --rm -v aios_data:/data alpine find /data/projects -maxdepth 2

# 5. Riavvio: i dati restano e il seeding non riscrive nulla
#    (nei log non deve comparire nessuna riga "seedato").
docker restart aios && docker logs --tail 5 aios
```

Per simulare un redeploy: ricostruisci l'immagine e rilancia il container sullo
**stesso** volume. Note agente, utenti aggiunti e progetti devono restare intatti —
e le modifiche a file già presenti sul volume **non** arrivano (§6).

> **Trappola nota, non reintrodurla.** Il seeding copia file per file
> ([`scripts/docker-entrypoint.sh`](../scripts/docker-entrypoint.sh)) e non con
> `cp -Rn "$src/." "$dst/"`: quella forma funziona con GNU/BSD `cp` ma con il `cp`
> di BusyBox (Alpine) **non copia nulla e restituisce comunque exit 0**. Il volume
> resterebbe vuoto, ogni richiesta risponderebbe 500 per `mcp/servers.json`
> mancante, e nei log non comparirebbe alcun errore. È esattamente il tipo di
> difetto che solo l'avvio dell'immagine reale mette in luce.

---

## 11. Alternativa: Render (sintetico)

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

## 12. Autenticazione: stato attuale

- **Oggi**: auth custom con `config/users.json` + cookie `aios_token`, sessioni in
  memoria (il singleton sopravvive a HMR in dev, e a ogni richiesta su host
  persistente). Va bene per pochi utenti fidati.
- **Roadmap**: un provider esterno (Auth.js/Clerk) resta una fase successiva e
  separata. **Nota:** `docs/CLERK_REVERT_NOTES.md` è **obsoleto** — il revert a
  Clerk è completo (nessun middleware, nessun `UserButton`, nessuna dipendenza
  Clerk); quel file descrive uno stato intermedio ormai superato ed è mantenuto
  solo come memoria storica.

---

## 13. Troubleshooting

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
  ripristina dal backup (§7).
- **«Ho aggiunto un tool MCP nel repo, ho ridiployato, ma non lo vedo»**: è il
  comportamento previsto, non un guasto. `mcp/servers.json` esiste già sul volume,
  quindi il seeding lo salta e il gateway continua a leggere la versione del primo
  boot. Applica la procedura di §6.1 (`cp /app/seed/mcp/servers.json
  /data/mcp/servers.json` + `chown`); non serve riavviare. Stessa cosa per le
  modifiche a un agente **esistente** (§6.2) — un agente **nuovo**, invece, arriva
  da solo. Per capire in fretta chi è indietro:
  `fly ssh console -C "diff /app/seed/mcp/servers.json /data/mcp/servers.json"`.
- **Il container esce subito dopo `[entrypoint]`, oppure l'app non riesce a
  scrivere**: problema di permessi sul volume. L'entrypoint parte da root, fa il
  `chown` del mount e poi scende a `aios` con `su-exec`; se qualcuno reintroduce
  `USER aios` nel Dockerfile, il primo `mkdir` sul volume `root:root` fallisce con
  `EACCES` e `set -eu` chiude il container prima del server. Verifica con
  `fly ssh console -C "stat -c '%U:%G' /data"` → deve essere `aios:aios`.
- **Ogni route risponde 500 con `ENOENT … mcp/servers.json`**: il seeding non ha
  copiato nulla sul volume. Controlla nei log le righe `[entrypoint] seedato …` al
  primo boot; se mancano del tutto, qualcuno ha rimesso la forma
  `cp -Rn "$src/." "$dst/"` nell'entrypoint, che su Alpine/BusyBox è un no-op
  silenzioso (§10). Dal secondo boot in poi l'assenza di righe `seedato` è invece
  normale e corretta.
- **La macchina risulta `unhealthy` e Fly la riavvia in loop**: controlla `path`
  in `[[http_service.checks]]`. Deve essere `/`. L'app è una SPA: non esiste
  nessuna route `/login` (solo `POST`/`DELETE` su `/api/login`), quindi un check su
  `/login` prende 404 e la macchina non passa mai il controllo.
