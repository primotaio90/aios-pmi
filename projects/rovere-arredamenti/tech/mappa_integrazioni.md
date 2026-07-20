# Mappa Integrazioni

Censimento dei sistemi esistenti e dei flussi di integrazione previsti.

| Sistema | Ruolo attuale | Integrazione prevista |
|---|---|---|
| GestArredo 9 (2011, on-premise) | Anagrafiche, ordini, fatture, giacenze parziali | API HTTP interna (spec in `dati/api_gestionale.json`) |
| Excel `GIACENZE_2025.xlsx` | Giacenze "ufficiose" aggiornate a mano | Da dismettere dopo il doppio binario |
| Schede cartacee di prelievo | Registrazione movimenti in reparto | Sostituite da scansione QR |
| Nuova app magazzino | Fonte di verità giacenze e ubicazioni | Sincronizzazione bidirezionale con GestArredo 9 |

Flussi principali:

1. **Anagrafica articoli**: GestArredo 9 → app magazzino (sola lettura, sync notturna).
2. **Movimenti**: app magazzino → `POST /movimenti` verso GestArredo 9 (near real-time).
3. **Ordini clienti**: `GET /ordini` per prenotare materiale a commessa.
4. **Riconciliazione**: confronto periodico `GET /giacenze` vs. base dati app, con
   report degli scostamenti da sottoporre al responsabile di magazzino.


## Aggiornamento 2026-07-19 — G-0001

**Macro-obiettivo**: Progettare l'ecosistema tecnologico per «Digitalizzare il magazzino di Rovere & Figli: eliminare le schede cartacee, inte…»: architettura, integrazioni con gestionale/CRM e strumenti (No-Code, API, custom).

- **Expert API Integrator** (T-0001): Analisi integrazione completata per Digitalizzare il magazzino di Rovere & Figli: eliminare le schede cart…: endpoint del gestionale mappati, verificati e pronti per il piano di integrazione.
- **Expert Python Developer** (T-0005): Sviluppo progettato per Digitalizzare il magazzino di Rovere & Figli: eliminare le schede cart…: script di automazione custom definiti, documentati e pronti per la revisione del Direttore.
- **Expert UI/UX Builder** (T-0008): Design completato per Digitalizzare il magazzino di Rovere & Figli: eliminare le schede cart…: mockup dell'interfaccia prodotto con flussi utente annotati per la validazione.

Sintesi di Director Tech Solutions: le attività del dipartimento sono state completate e i deliverable sono in `outputs/`.


## Aggiornamento 2026-07-19 — G-0002

**Macro-obiettivo**: Progettare l'ecosistema tecnologico per «Estendere la digitalizzazione ai processi di vendita garantendo la conformità GD…»: architettura, integrazioni con gestionale/CRM e strumenti (No-Code, API, custom).

- **Expert API Integrator** (T-0012): Analisi integrazione completata per Estendere la digitalizzazione ai processi di vendita garantendo la con…: endpoint del gestionale mappati, verificati e pronti per il piano di integrazione.
- **Expert Python Developer** (T-0015): Sviluppo progettato per Estendere la digitalizzazione ai processi di vendita garantendo la con…: script di automazione custom definiti, documentati e pronti per la revisione del Direttore.
- **Expert UI/UX Builder** (T-0018): Design completato per Estendere la digitalizzazione ai processi di vendita garantendo la con…: mockup dell'interfaccia prodotto con flussi utente annotati per la validazione.

Sintesi di Director Tech Solutions: le attività del dipartimento sono state completate e i deliverable sono in `outputs/`.


## Aggiornamento 2026-07-19 — G-0001

**Macro-obiettivo**: Progettare l'ecosistema tecnologico per «Digitalizzare il magazzino di Rovere & Figli: eliminare le schede cartacee, inte…»: architettura, integrazioni con gestionale/CRM e strumenti (No-Code, API, custom).

- **Expert API Integrator** (T-0001): Analisi integrazione completata per Digitalizzare il magazzino di Rovere & Figli: eliminare le schede cart…: endpoint del gestionale mappati, verificati e pronti per il piano di integrazione.
- **Expert Python Developer** (T-0006): Sviluppo progettato per Digitalizzare il magazzino di Rovere & Figli: eliminare le schede cart…: script di automazione custom definiti, documentati e pronti per la revisione del Direttore.
- **Expert UI/UX Builder** (T-0008): Design completato per Digitalizzare il magazzino di Rovere & Figli: eliminare le schede cart…: mockup dell'interfaccia prodotto con flussi utente annotati per la validazione.

Sintesi di Director Tech Solutions: le attività del dipartimento sono state completate e i deliverable sono in `outputs/`.


## Aggiornamento 2026-07-19 — G-0002

**Macro-obiettivo**: Progettare l'ecosistema tecnologico per «Analisi di mercato e test degli avvisi di consumo»: architettura, integrazioni con gestionale/CRM e strumenti (No-Code, API, custom).

- **Expert API Integrator** (T-0013): Analisi integrazione completata per Analisi di mercato e test degli avvisi di consumo: endpoint del gestionale mappati, verificati e pronti per il piano di integrazione.
- **Expert Python Developer** (T-0014): Sviluppo progettato per Analisi di mercato e test degli avvisi di consumo: script di automazione custom definiti, documentati e pronti per la revisione del Direttore.
- **Expert UI/UX Builder** (T-0016): Design completato per Analisi di mercato e test degli avvisi di consumo: mockup dell'interfaccia prodotto con flussi utente annotati per la validazione.

Sintesi di Director Tech Solutions: le attività del dipartimento sono state completate e i deliverable sono in `outputs/`.


## Aggiornamento 2026-07-19 — G-0003

**Macro-obiettivo**: Progettare l'ecosistema tecnologico per «Analisi di mercato per validare gli avvisi di budget»: architettura, integrazioni con gestionale/CRM e strumenti (No-Code, API, custom).

- **Expert API Integrator** (T-0023): Analisi integrazione completata per Analisi di mercato per validare gli avvisi di budget: endpoint del gestionale mappati, verificati e pronti per il piano di integrazione.
- **Expert Python Developer** (T-0026): Sviluppo progettato per Analisi di mercato per validare gli avvisi di budget: script di automazione custom definiti, documentati e pronti per la revisione del Direttore.
- **Expert UI/UX Builder** (T-0028): Design completato per Analisi di mercato per validare gli avvisi di budget: mockup dell'interfaccia prodotto con flussi utente annotati per la validazione.

Sintesi di Director Tech Solutions: le attività del dipartimento sono state completate e i deliverable sono in `outputs/`.
