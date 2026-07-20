# Brief — Rovere & Figli Arredamenti

## Il cliente

Rovere & Figli s.n.c. è un mobilificio artigianale di Lissone (Monza e Brianza), fondato nel
1962 da Ernesto Rovere e oggi guidato dai figli Franco (produzione) e Silvia (amministrazione
e commerciale). Conta **18 dipendenti**: 11 tra falegnameria e verniciatura, 3 in magazzino e
logistica, 2 in amministrazione, 2 commerciali. Fatturato 2025 di circa **2,3 M€**, in gran
parte da arredi su misura per privati, più una quota crescente di forniture contract
(studi professionali, negozi, B&B).

## La situazione attuale

- Il gestionale è **GestArredo 9**, installato nel 2011 su un server locale: gestisce
  anagrafica articoli, ordini clienti e fatturazione. Espone un'API HTTP interna poco
  documentata (la spec ricostruita è in `dati/api_gestionale.json`).
- Il **magazzino** (legname, semilavorati, ferramenta, prodotti finiti) è gestito con
  **schede cartacee** compilate a mano ad ogni prelievo/versamento, ricopiate una volta a
  settimana in un file Excel (`GIACENZE_2025.xlsx`) dal responsabile di magazzino.
- Le giacenze in GestArredo 9 vengono aggiornate manualmente e solo per i prodotti finiti:
  materie prime e semilavorati vivono esclusivamente su carta.

## Il problema

1. **Errori di giacenza ricorrenti**: nel 2025 l'inventario di fine anno ha rilevato uno
   scostamento medio del 9% tra giacenza contabile e fisica; la svalutazione per rimanenze
   obsolete o "perse" è stata di circa 41.000 € (vedi `dati/bilancio_2025.csv`).
2. **Fermi di produzione**: 6-8 episodi l'anno in cui una commessa si ferma perché la
   ferramenta o il pannello risultavano disponibili ma non lo erano.
3. **Doppie registrazioni**: lo stesso movimento viene scritto sulla scheda cartacea,
   nell'Excel e (a volte) in GestArredo 9, con tre versioni della verità.
4. **Dipendenza da una persona**: solo il responsabile di magazzino (in azienda dal 1998)
   sa davvero "dove sono le cose".

## Obiettivi del progetto

- Eliminare le schede cartacee e l'Excel settimanale: **un'unica fonte di verità digitale**
  per le giacenze, alimentata in tempo reale dai movimenti di magazzino.
- **Integrare il gestionale GestArredo 9** (senza sostituirlo) tramite la sua API:
  anagrafiche e ordini restano lì, le giacenze si sincronizzano.
- Introdurre etichette con codice a barre/QR sulle ubicazioni e sugli articoli, con
  rilevazione da smartphone o palmare economico.
- **Formare il personale** di magazzino e produzione all'uso del nuovo flusso, con
  procedure semplici e in italiano.
- Ridurre gli scostamenti inventariali sotto il 2% entro 12 mesi dal go-live.

## Vincoli

- **Budget**: circa **15.000 €** complessivi (licenze, hardware di rilevazione, consulenza,
  formazione). Nessun costo ricorrente aggiuntivo oltre i 150 €/mese.
- **GestArredo 9 non si tocca**: il contratto di assistenza vincola l'azienda fino al 2027;
  è ammessa solo integrazione via API in lettura/scrittura.
- **Personale poco digitalizzato**: età media 51 anni in magazzino; le soluzioni devono
  funzionare con 2-3 gesti, niente interfacce complesse.
- **Zero fermi**: la transizione deve avvenire senza interrompere produzione e consegne;
  previsto un periodo di doppio binario (carta + digitale) di massimo 4 settimane.

## Dati forniti dal cliente

- `dati/bilancio_2025.csv` — estratto del bilancio 2025 riclassificato.
- `dati/api_gestionale.json` — spec OpenAPI ricostruita dell'API di GestArredo 9.
