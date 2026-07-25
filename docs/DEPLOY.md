# Deploy su GitHub + Vercel

Questa guida spiega come mettere online la piattaforma AIOS: repository su GitHub
(per collaborare con il team) + deploy automatico su Vercel (per avere un dominio
utilizzabile). L'autenticazione resta quella nativa (demo) per ora; Clerk/altre
soluzioni si aggiungono in una fase successiva.

---

## 1. Prerequisiti

- Account **GitHub** (gratuito).
- Account **Vercel** (gratuito, consigliato creare con "Sign in with GitHub").
- Node.js ≥ 18 installato localmente (già presente per lo sviluppo).
- Repository Git già inizializzato in locale (vedi §2).

---

## 2. Pubblicare la repository su GitHub

### 2a. Creare la repository su GitHub
1. Vai su https://github.com/new.
2. **Repository name**: `aios-pmi` (o un nome a scelta).
3. **Visibility**: `Private` (consigliato — contiene log e dati di progetto).
4. **NON** inizializzare con README/.gitignore/license (li abbiamo già in locale).
5. Clicca **Create repository**.

### 2b. Collegare il repo locale e fare il primo push
Dalla cartella del progetto (`/Users/lina/Desktop/AIOS`):

```bash
git remote add origin https://github.com/primotaio90/aios-pmi.git
git branch -M main
git push -u origin main
```

Se preferisci SSH:
```bash
git remote add origin git@github.com:primotaio90/aios-pmi.git
git push -u origin main
```

### 2c. Lavorare in più persone
I collaboratori vanno aggiunti su GitHub: **Settings → Collaborators → Add people**.
Ognuno clona con:
```bash
git clone https://github.com/primotaio90/aios-pmi.git
cd aios
npm install
npm run dev
```

> ⚠️ **Credenziali demo**: gli account in `config/users.json` (password `aios2026`)
> sono condivisi. NON committare mai file `.env.local` con chiavi reali: il
> `.gitignore` è già configurato per escluderli.

---

## 3. Deploy su Vercel

### 3a. Importare il progetto
1. Vai su https://vercel.com/new.
2. Seleziona la repository `aios-pmi` appena creata (se non la vedi, clicca
   "Adjust GitHub App Permissions" e autorizza Vercel).
3. **Framework Preset**: viene rilevato automaticamente come **Next.js**.
4. **Root Directory**: lascia `./` (il default).
5. **Build Command** e **Output Directory**: lasciare i default (`next build`).

### 3b. Variabili d'ambiente
In **Settings → Environment Variables** aggiungi (vedi `.env.example`):

| Nome | Valore | Note |
|---|---|---|
| `AIOS_RUNNER` | `mock` | Agenti simulati, nessuna chiave necessaria. Ottimo per provare la piattaforma. |
| `ANTHROPIC_API_KEY` | *(solo se `AIOS_RUNNER=claude`)* | Chiave API di Anthropic per il runner reale. Lasciare vuoto in `mock`. |

Per ora **non servono** variabili Clerk o di autenticazione esterna.

### 3c. Deploy
Clicca **Deploy**. Il primo build impiega ~1-2 minuti. Al termine Vercel fornisce
un dominio tipo `https://aios-xxx.vercel.app` (modificabile in **Settings → Domains**).

Ogni `git push` su `main` aggiorna automaticamente il deploy di produzione.
I pull request generano invece dei **preview deploy** isolati.

---

## 4. ⚠️ Caveat critico: storage su filesystem (serverless)

**Questo è il punto più importante da capire prima di andare in produzione.**

### Come funziona oggi (in locale)
AIOS persiste tutto su filesystem:
- `projects/<cliente>/project.json`, `state/goals.json`, `state/tasks.json`
- `projects/<cliente>/logs/*.jsonl` (eventi, chiamate MCP, lifecycle, token LLM)
- `projects/<cliente>/outputs/*.md` (deliverable)
- Sessioni in-memory nel singleton `globalThis.__AIOS__` (`src/lib/aios/system.mjs`).

### Cosa succede su Vercel (serverless)
Vercel esegue le API route come **funzioni serverless**:
- Il **filesystem è read-only** in produzione (eccetto `/tmp` temporaneo).
- **Non c'è stato persistente** tra una invocation e l'altra: il singleton
  in-memory viene ricreato ogni volta, quindi **le sessioni di login si perdono**
  tra le richieste e l'event bus in-memory non funziona cross-invocation.
- La **SSE** (`/api/events`) non è affidabile sulle funzioni serverless (timeout
  e connessioni chiuse).

### Cosa funziona / cosa non funziona
| Funzionalità | Locale (dev) | Vercel (serverless) |
|---|---|---|
| Login + sessione | ✅ | ⚠️ sessione effimera (scompaiono i login dopo poco) |
| Lettura progetti esistenti (committati) | ✅ | ✅ (i file nel repo sono leggibili) |
| Creazione nuovo progetto | ✅ | ❌ scrittura negata (FS read-only) |
| Submit di un goal | ✅ | ❌ non persiste |
| SSE event bus | ✅ | ⚠️ inaffidabile |
| Log JSONL | ✅ | ❌ non scrivibili |
| Regole di autonomia (`state/autonomy.json`, frontmatter) | ✅ | ❌ non persistono |
| Pacchetti di consegna (`outputs/consegna_*.md`) | ✅ | ❌ non persistono |
| Coda approvazioni (`state/approvals.json`) | ✅ | ⚠️ vedi nota sotto |

> **Nota autonomia (Fase A) e consegna (Fase C) su serverless.** Come per
> settings/note/whitelist (§4), su FS read-only le regole di autonomia e i dossier di
> consegna non persistono in produzione. In più, l'`await` **bloccante** di
> un'approvazione non sopravvive fra due invocation lambda distinte: in produzione il
> flusso «chiedi conferma» funziona nella chat interattiva (stessa invocation che
> attende la risposta SSE), mentre nelle run lunghe non presidiate la richiesta va in
> timeout e degrada sul fallback esistente `blocked` + notifica PM — esattamente il
> comportamento previsto in assenza di un umano che risponde.

### Conclusione
Per una **demo / prova della piattaforma** su Vercel, l'app si avvia, la dashboard
si vede e i progetti committati nel repo sono leggibili. Ma **le scritture
(creare progetti, inviare goal, generare report) non persistono**.

Per un uso reale serve migrare lo storage a un backend persistente:
- **Database** (Postgres su Vercel Postgres / Neon / Supabase) per `state/`, `goals`, `tasks`.
- **Object storage** (S3/Vercel Blob) per `outputs/*.md` e `logs/*.jsonl`.
- **Cache/queue** (Upstash Redis) per l'event bus.
- **Autenticazione esterna** (Clerk/Auth.js) per sessioni stateless robuste.

Queste sono tutte estensioni successive: l'architettura attuale è pensata per la
fase di sviluppo/condivisione del codice, non per la produzione multi-utente.

---

## 5. Alternativa: self-host su una VM (per testare tutto)

Se vuoi provare la piattaforma **per intero** (scritture incluse) senza cambiare
architetto, la via più semplice è un piccolo server con Node.js:

- **VPS** (Hetzner/DigitalOcean/GCP) con Node 20 + git clone + `npm run build && npm start`.
- Oppure un container Docker su un VM provider.
- In questo scenario il filesystem è read-write e tutto funziona come in locale.

È la soluzione consigliata **per ora** se l'obiettivo è testarla end-to-end con
gli amici, in attesa di migrare lo storage per il serverless.

---

## 6. Autenticazione: stato attuale e roadmap

- **Oggi**: auth custom con `config/users.json` + cookie `aios_token` (demo).
  Va benissimo per provare in pochi utenti.
- **Roadmap**: integrare Clerk (o Auth.js) per login social/email + ruoli
  avanzati. È rimandato a una fase successiva (vedi `docs/CLERK_REVERT_NOTES.md`
  per il contexto degli esperimenti già fatti).

---

## 7. Troubleshooting comune

- **Build fallito su Vercel per TS error**: esegui `npm run build` in locale e
  correggi gli errori prima del push (Vercel usa lo stesso `next build`).
- **401 su tutte le API dopo poco tempo su Vercel**: è il caveat serverless del §4
  (sessione in-memory persa). Per ora riloggati; risolto definitivamente solo con
  auth stateless (Clerk).
- **`AIOS_RUNNER=claude` non funziona**: verifica che `ANTHROPIC_API_KEY` sia
  impostata nelle env vars di Vercel e che la chiave sia valida.
- **Il dev server va in loop di reload**: `src/lib/aios/system.mjs` usa
  `globalThis.__AIOS__` per sopravvivere all'HMR; se persistono problemi, riavvia
  `npm run dev`.