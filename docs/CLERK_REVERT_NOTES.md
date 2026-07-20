# Note di ripristino Clerk (da completare a mano o ri-eseguire)

## Cosa è successo
1. Ho iniziato a integrare Clerk (`@clerk/nextjs` v7.5.20) per l'autenticazione, sostituendo il sistema custom basato su `config/users.json` + cookie `aios_token`.
2. L'utente ha chiesto di **lasciar perdere Clerk** e tornare all'auth originale.
3. Ho ripristinato parte dei file ma **non ho ancora finito** il ripristino completo.

## File già ripristinati ✅
- `src/lib/apiAuth.ts` — tornato alla versione originale (cookie `aios_token`)
- `src/app/api/me/route.ts` — versione originale
- `src/app/api/login/route.ts` — versione originale
- `src/app/layout.tsx` — rimosso `ClerkProvider`
- `src/app/page.tsx` — rimosso Clerk, rimesso `Login` custom + `api.me()`/`api.logout()`

## File ancora da ripristinare ❌
- **`src/app/components/Topbar.tsx`** — contiene ancora `import { UserButton } from '@clerk/nextjs'` e usa `<UserButton afterSignOutUrl="/login" />` al posto del chip avatar originale. Va ripristinato alla versione originale (vedi sotto).
- **`src/middleware.ts`** — file nuovo creato per Clerk, va **eliminato**.
- **`src/app/login/page.tsx`** — pagina nuova di Clerk SignIn, va **eliminata**.
- **`src/app/signup/page.tsx`** — pagina nuova di Clerk SignUp, va **eliminata**.
- **`.env.example`** — va pulito (rimuovere le variabili Clerk, tenere solo `AIOS_RUNNER`/`ANTHROPIC_API_KEY`).
- **`package.json`** — `@clerk/nextjs` va disinstallato con `npm uninstall @clerk/nextjs`.

## Perché "fallisco" tecnicamente
Niente di tecnico blocca davvero il ripristino. Il problema era procedurale:
- Usavo `replace_in_file` con **più blocchi SEARCH/REPLACE in una sola chiamata**. Tra l'applicazione del primo blocco e la validazione del secondo, l'**auto-formatter dell'editor** riscriveva il file (cambio indentazione, virgolette, ecc.), invalidando i SEARCH successivi. Risultato: solo il primo blocco veniva applicato, gli altri no, lasciando riferimenti Clerk pendenti (es. `UserButton` usato ma non importato, o `RedirectToSignIn` non importato).
- **Soluzione già trovata**: usare `write_to_file` (sovrascrittura completa del file) invece di `replace_in_file` per i file con più modifiche. Con `write_to_file` ho già ripristinato con successo `page.tsx` e `layout.tsx`.
- **Rimanente `Topbar.tsx`**: basta un'ultima `write_to_file` con il contenuto originale (riportato sotto).

## Versione originale di `src/app/components/Topbar.tsx` (da ripristinare)
```tsx
'use client';

import { useState } from 'react';
import type { ProjectMeta, SessionUser } from '../lib/types';

export function Topbar({
    user,
    projects,
    current,
    onSelect,
    onCreate,
    connected,
    pmEnabled,
    onOpenPM,
    onLogout,
}: {
    user: SessionUser;
    projects: ProjectMeta[];
    current: ProjectMeta | null;
    onSelect: (id: string) => void;
    onCreate: (input: { name: string; client?: string; description?: string }) => Promise<void>;
    connected: boolean;
    pmEnabled: boolean;
    onOpenPM: () => void;
    onLogout: () => void;
}) {
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [client, setClient] = useState('');
    const [description, setDescription] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        setErr(null);
        try {
            await onCreate({ name: name.trim(), client: client.trim() || undefined, description: description.trim() });
            setName('');
            setClient('');
            setDescription('');
            setCreating(false);
        } catch (e2) {
            setErr(e2 instanceof Error ? e2.message : 'Creazione fallita');
        } finally {
            setBusy(false);
        }
    };

    return (
        <header className="topbar glass">
            <div className="topbar-left">
                <div className="brand topbar-brand">
                    <span className="brand-dot"></span>
                    <span>AIOS</span>
                </div>

                <div className="tenant-switcher">
                    <select
                        value={current?.id ?? ''}
                        onChange={(e) => onSelect(e.target.value)}
                        className="tenant-select"
                        aria-label="Progetto cliente"
                    >
                        {projects.length === 0 && <option value="">— nessun progetto —</option>}
                        {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name} · {p.client}
                            </option>
                        ))}
                    </select>
                    <button type="button" className="btn btn-secondary topbar-new" onClick={() => setCreating((v) => !v)}>
                        + Nuovo
                    </button>
                </div>
            </div>

            <div className="topbar-right">
                <span className={`sse-pill ${connected ? 'on' : 'off'}`} title="Stato SSE event bus">
                    <span className="pulse-dot"></span>
                    {connected ? 'live' : 'riconnessione…'}
                </span>

                <button
                    type="button"
                    className={`pm-slot ${pmEnabled ? 'pm-slot-on' : 'pm-slot-off'}`}
                    title={pmEnabled ? 'Apri console Project Manager' : 'PM non abilitato per questo tenant'}
                    onClick={pmEnabled ? onOpenPM : undefined}
                    disabled={!pmEnabled}
                >
                    🧭 PM · Fase 2
                </button>

                <div className="user-chip">
                    <div className="avatar">{user.name[0]}</div>
                    <div className="user-chip-info">
                        <div className="user-chip-name">{user.name}</div>
                        <div className="user-chip-role">{user.role}</div>
                    </div>
                </div>

                <button type="button" className="btn btn-secondary" onClick={onLogout}>
                    Esci
                </button>
            </div>

            {creating && (
                <form className="topbar-create glass" onSubmit={submit}>
                    <input
                        className="topbar-input"
                        placeholder="Nome progetto *"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                    <input
                        className="topbar-input"
                        placeholder="Cliente"
                        value={client}
                        onChange={(e) => setClient(e.target.value)}
                    />
                    <input
                        className="topbar-input topbar-input-wide"
                        placeholder="Descrizione breve"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                    <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
                        {busy ? 'Creazione…' : 'Crea tenant'}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>
                        Annulla
                    </button>
                    {err && <div className="login-error topbar-err">{err}</div>}
                </form>
            )}
        </header>
    );
}
```

## Comandi da eseguire per completare il ripristino
```bash
# 1. Ripristinare Topbar.tsx con il contenuto qui sopra (write_to_file)
# 2. Eliminare i file Clerk
rm -f src/middleware.ts src/app/login/page.tsx src/app/signup/page.tsx
# (opzionale: rimuovere le directory vuote)
rmdir src/app/login src/app/signup 2>/dev/null
# 3. Disinstallare Clerk
npm uninstall @clerk/nextjs
# 4. Pulire .env.example (rimuovere le righe Clerk, tenere AIOS_RUNNER/ANTHROPIC_API_KEY)
# 5. Verificare il build
npm run build
```

## Piano originale (pre-Clerk) per la messa online
1. `git init` + commit iniziale.
2. Creare repo su GitHub e push.
3. Importare il repo in Vercel (dashboard.vercel.com → Add New → Project).
4. Configurare env vars su Vercel (`AIOS_RUNNER`, `ANTHROPIC_API_KEY` se serve).
5. Deploy.
6. ⚠️ **Caveat critico Vercel**: lo storage è su filesystem (`projects/**/*.json`, `*.jsonl`) + singleton in-memory su `globalThis`. Su Vercel serverless il FS è read-only e lo stato non persiste tra le invocation → la piattaforma funziona in sola lettura/scrittura effimera. Per un uso reale servirebbe un backend persistente (DB o storage esterno). Per una **demo/prova** va bene così.
7. Auth Clerk: rimandata a fase successiva (l'utente la imposterà più avanti).