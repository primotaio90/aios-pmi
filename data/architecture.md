---
category: Architettura
lastUpdated: 2026-07-18T00:00:00Z
---
# Decisioni Architetturali

### Stack Tecnologico
- **Frontend:** Next.js 16 con React 19 (App Router)
- **Styling:** CSS Glassmorphism custom, font Outfit + Plus Jakarta Sans
- **Backend:** API Routes Next.js, file system come database (Markdown)

### Pattern Architetturali
- **Orchestratore-Direttori:** Gerarchia a 2 livelli. L'Orchestratore riceve l'input e delega ai Direttori.
- **Single Source of Truth:** File Markdown locali con frontmatter YAML.
- **Mutex Lock:** Accesso concorrente ai file gestito tramite lock a livello file.

### Decisioni Pending
- [ ] Valutare migrazione da file Markdown a database SQLite per scalabilità
- [ ] Definire strategia di versioning dei prompt dei direttori