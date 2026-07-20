# Architettura Sistema

Impostazione tecnica di partenza per la digitalizzazione del magazzino, nel rispetto
dei vincoli: GestArredo 9 resta il sistema di riferimento per anagrafiche, ordini e
fatturazione; il nuovo livello digitale si appoggia alla sua API interna.

Componenti previsti:

- **App di magazzino** (web app responsive o WMS entry-level): rilevazione movimenti
  tramite scansione QR/barcode da smartphone o palmare Android economico.
- **Livello di sincronizzazione**: servizio leggero che legge anagrafiche e ordini da
  GestArredo 9 (`GET /articoli`, `GET /ordini`) e riallinea le giacenze
  (`GET /giacenze`, `POST /movimenti`) con logica di riconciliazione.
- **Base dati giacenze**: unica fonte di verità per ubicazioni, lotti e scorte minime;
  GestArredo 9 riceve i saldi, non i dettagli di ubicazione (che non sa gestire).
- **Rete**: server GestArredo on-premise già raggiungibile in LAN; serve copertura
  Wi-Fi nel capannone magazzino (oggi assente in due campate su tre).

Punti aperti da verificare: autenticazione dell'API GestArredo (sembra solo API key
statica), limiti di rate, comportamento del `POST /movimenti` su codici inesistenti.


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
