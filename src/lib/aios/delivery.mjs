/**
 * Delivery desk — answers the consultant's question "what can we already hand
 * to the client?" and packages the answer.
 *
 * Two deliberately separated responsibilities:
 *  - snapshot(): a deterministic, LLM-free read of the tenant state (goals,
 *    tasks, department documents) classified into ready / partial deliverables
 *    plus the open gaps. Every read degrades to an empty list, so a brand new
 *    (or half-broken) project still renders instead of crashing the panel.
 *    The only intentional throw is the missing tenant, which the API layer
 *    turns into a 404.
 *  - produce(): renders the client-facing markdown dossier from that snapshot
 *    and writes it through the MCP gateway on behalf of the orchestrator, so
 *    the write keeps the usual audit trail + `file.updated` event.
 *
 * The narrative parts of the dossier (executive summary, risks/next steps) come
 * from the orchestrator's model when a real provider is configured, with a
 * SILENT fallback to a deterministic text derived from the snapshot numbers:
 * the desk must keep working in mock mode and whenever the provider fails.
 */
import { getSettings, providerConfig, modelFor } from './settings.mjs';
import { getLLMClient } from './llm/index.mjs';

// Directories scanned for knowledge documents and for size/mtime metadata.
const SCAN_DIRS = ['outputs', 'delivery', 'business', 'tech'];
// A director-owned document is considered substantial from this size on: the
// seed files written by store.createProject() are just a title line.
const SUBSTANCE_BYTES = 200;
// Per-attachment character cap inside the produced dossier.
const ATTACHMENT_LIMIT = 8000;
const DOSSIER_PREFIX = 'consegna_';
const IN_FLIGHT_STATES = ['pending', 'assigned', 'in_progress'];
const KIND_LABELS = { report: 'Report', output: 'Deliverable', knowledge: 'Documento' };

export class DeliveryDesk {
  constructor({ registry, store, bus, tasks, engine, gateway, reportUsage }) {
    this.registry = registry;
    this.store = store;
    this.bus = bus;
    this.tasks = tasks;
    this.engine = engine;
    this.gateway = gateway;
    this.reportUsage = typeof reportUsage === 'function' ? reportUsage : () => {};
    this.chains = new Map(); // per-project write serialization
  }

  #chain(projectId, fn) {
    const prev = this.chains.get(projectId) || Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(projectId, next);
    return next;
  }

  // --- 4a. snapshot ------------------------------------------------------------

  /**
   * Deterministic picture of what is deliverable right now. No LLM, no writes.
   *
   * Classification rules (kept in one place on purpose, they are the contract
   * the UI renders):
   *  1. goal `completed` with a `report_path` → `report`, ready.
   *  2. task `done` with outputs[]            → one `output` ready per path.
   *  3. task `review` with outputs[]          → `output` partial (waiting for
   *     the director's approval).
   *  4. director `owns_files`                 → `knowledge` ready when the file
   *     carries at least one dated `## Aggiornamento` section (appended by the
   *     engine at each cycle) or weighs more than SUBSTANCE_BYTES; otherwise it
   *     is a gap, because it still holds only its seed title.
   *  5. remaining files in `delivery/`        → `knowledge` ready.
   *  6. task `blocked`                        → gap (needs a human).
   *  7. task pending/assigned/in_progress     → gap (work in progress).
   *  8. task `review`/`done` WITHOUT outputs  → gap (no deliverable produced),
   *     so a task closed or awaiting approval empty-handed never silently
   *     disappears and inflates the readiness score.
   *
   * Rule 4 runs before rule 5 on purpose: the delivery director owns two files
   * that live in `delivery/`, and they must pass the substance check instead of
   * being declared ready just because of their folder.
   * Every path is deduplicated across rules, so a file already counted as an
   * output never reappears as knowledge.
   */
  async snapshot(projectId) {
    // The only intentional throw: a missing tenant must surface as a 404.
    const project = await this.store.readProject(projectId);

    const goals = await safe(() => this.engine.listGoals(projectId), []);
    const tasks = await safe(() => this.tasks.list(projectId), []);
    const directors = safeSync(() => this.registry.directors(), []);

    // File metadata index (size + mtime) for every directory we care about.
    const byDir = new Map();
    const files = new Map();
    for (const dir of SCAN_DIRS) {
      const list = await safe(() => this.store.listFiles(projectId, dir), []);
      byDir.set(dir, list);
      for (const file of list) files.set(file.path, file);
    }

    const items = [];
    const gaps = [];
    const seen = new Set(); // dedup by path across every rule

    // 1) Final reports of completed goals.
    for (const goal of asArray(goals)) {
      if (!goal || goal.status !== 'completed' || !goal.report_path) continue;
      const rel = normalizePath(goal.report_path);
      if (!rel || seen.has(rel)) continue;
      seen.add(rel);
      const meta = files.get(rel) || null;
      items.push({
        id: `report:${goal.id}`,
        title: `Report finale — ${clip(goal.text || goal.id, 90)}`,
        kind: 'report',
        status: 'ready',
        path: rel,
        department: 'core',
        source: goal.id || null,
        updated_at: meta?.mtime || null,
        size: meta?.size ?? null,
        note: null,
      });
    }

    // 2/3) Task artefacts, then 6/7) tasks that are not producing anything yet.
    for (const task of asArray(tasks)) {
      if (!task) continue;
      const outputs = asArray(task.outputs);
      const approved = task.status === 'done';
      const awaiting = task.status === 'review';
      if (outputs.length > 0 && (approved || awaiting)) {
        for (const raw of outputs) {
          const rel = normalizePath(raw);
          if (!rel || seen.has(rel)) continue;
          seen.add(rel);
          const meta = files.get(rel) || null;
          const label = task.title || `Task ${task.id}`;
          items.push({
            id: `output:${rel}`,
            title: outputs.length > 1 ? `${clip(label, 80)} — ${baseName(rel)}` : clip(label, 110),
            kind: 'output',
            status: awaiting ? 'partial' : 'ready',
            path: rel,
            department: task.department || null,
            source: task.id || null,
            updated_at: meta?.mtime || null,
            size: meta?.size ?? null,
            note: awaiting ? 'In attesa di approvazione del Direttore' : null,
          });
        }
        continue;
      }
      if (task.status === 'blocked') {
        gaps.push(taskGap(task, 'task bloccato: richiede intervento'));
      } else if (IN_FLIGHT_STATES.includes(task.status)) {
        gaps.push(taskGap(task, 'lavorazione in corso'));
      } else if (awaiting) {
        // review/done WITHOUT outputs would otherwise vanish from the count and
        // inflate readiness — classify them as gaps so the score stays honest.
        gaps.push(taskGap(task, 'in attesa di approvazione, nessun deliverable prodotto'));
      } else if (approved) {
        gaps.push(taskGap(task, 'task chiuso senza deliverable'));
      }
    }

    // 4) Knowledge documents maintained by the directors.
    for (const director of asArray(directors)) {
      for (const raw of asArray(director?.owns_files)) {
        const rel = normalizePath(raw);
        if (!rel || seen.has(rel)) continue;
        seen.add(rel);
        const meta = files.get(rel) || null;
        const content = await this.#readSafe(projectId, rel);
        const bytes = meta?.size ?? (content === null ? 0 : content.length);
        const substantial = content !== null && (/^##\s+Aggiornamento/m.test(content) || bytes > SUBSTANCE_BYTES);
        if (!substantial) {
          gaps.push({
            id: `gap:file:${rel}`,
            label: docTitle(content, rel),
            reason: 'documento ancora al solo titolo',
            task_id: null,
            department: director?.department || null,
          });
          continue;
        }
        items.push({
          id: `knowledge:${rel}`,
          title: docTitle(content, rel),
          kind: 'knowledge',
          status: 'ready',
          path: rel,
          department: director?.department || null,
          source: director?.id || null,
          updated_at: meta?.mtime || null,
          size: meta?.size ?? null,
          note: null,
        });
      }
    }

    // 5) Anything else already parked in delivery/ is client-facing by design.
    for (const file of asArray(byDir.get('delivery'))) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      const content = await this.#readSafe(projectId, file.path);
      items.push({
        id: `knowledge:${file.path}`,
        title: docTitle(content, file.path),
        kind: 'knowledge',
        status: 'ready',
        path: file.path,
        department: 'delivery',
        source: null,
        updated_at: file.mtime || null,
        size: file.size ?? null,
        note: null,
      });
    }

    // Dossiers already produced, most recent first.
    const previous = asArray(byDir.get('outputs'))
      .filter((f) => f.name.startsWith(DOSSIER_PREFIX) && f.name.endsWith('.md'))
      .map((f) => ({ path: f.path, name: f.name, size: f.size, mtime: f.mtime }))
      .sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));

    return {
      project,
      generated_at: new Date().toISOString(),
      readiness: readinessOf(items, gaps.length),
      items,
      gaps,
      goals: asArray(goals)
        .filter(Boolean)
        .map((g) => ({
          id: g.id,
          text: g.text || '',
          status: g.status || 'unknown',
          report_path: g.report_path || null,
          ready: g.status === 'completed' && Boolean(g.report_path),
        })),
      previous,
    };
  }

  // --- 4b. produce -------------------------------------------------------------

  /**
   * Builds and persists the delivery dossier. `include` holds item ids; empty
   * means "everything that is ready". Unknown ids are ignored on purpose: the
   * panel may be holding a snapshot that has meanwhile moved on.
   */
  async produce(projectId, { title = '', include = [], notes = '', byUser = 'consultant' } = {}) {
    const snapshot = await this.snapshot(projectId);
    const orchestrator = this.registry.orchestrator();
    if (!orchestrator) throw new Error('Nessun Orchestrator_Core nel registry');

    const wanted = asArray(include).filter((id) => typeof id === 'string');
    const selected = wanted.length
      ? snapshot.items.filter((i) => wanted.includes(i.id))
      : snapshot.items.filter((i) => i.status === 'ready');

    // The dossier describes the PACKAGE (the selected items), not the whole
    // project. Narrative, tables and the emitted event must all read the same
    // package-scoped numbers, otherwise the summary ("16 documenti pronti") can
    // contradict the tables and attachments (which list only the selection).
    const packageReadiness = readinessOf(selected, snapshot.gaps.length);
    const packageSnapshot = { ...snapshot, items: selected, readiness: packageReadiness };

    const narrative = await this.#narrative(projectId, orchestrator, packageSnapshot);
    const dossierTitle = String(title || '').trim() || snapshot.project?.name || projectId;
    const content = await this.#render(projectId, {
      snapshot: packageSnapshot,
      selected,
      narrative,
      notes: String(notes || '').trim(),
      byUser,
      dossierTitle,
    });

    const path = await this.#write(projectId, orchestrator, content);
    const { ready, partial, missing, score } = packageReadiness;

    this.bus.emitEvent(
      projectId,
      'delivery.produced',
      { path, title: dossierTitle, ready, partial, missing, score, by: byUser, items: selected.map((i) => i.id) },
      orchestrator.id
    );
    this.bus.emitEvent(projectId, 'notify', { level: 'success', message: `Consegna generata: ${path}` });

    // The full project snapshot goes back to the panel, but `previous` is rebuilt
    // AFTER the write so the just-produced dossier shows up without a manual refresh.
    const previous = asArray(await safe(() => this.store.listFiles(projectId, 'outputs'), []))
      .filter((f) => f.name.startsWith(DOSSIER_PREFIX) && f.name.endsWith('.md'))
      .map((f) => ({ path: f.path, name: f.name, size: f.size, mtime: f.mtime }))
      .sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));

    return { path, content, snapshot: { ...snapshot, previous } };
  }

  /** Reserves a free filename and writes it through the gateway (audit + event). */
  #write(projectId, orchestrator, content) {
    // Serialized per project so two concurrent packages never pick the same name.
    return this.#chain(projectId, async () => {
      const now = new Date().toISOString();
      const stamp = `${now.slice(0, 10)}_${now.slice(11, 13)}${now.slice(14, 16)}`;
      const taken = new Set(asArray(await safe(() => this.store.listFiles(projectId, 'outputs'), [])).map((f) => f.path));
      let path = `outputs/${DOSSIER_PREFIX}${stamp}.md`;
      for (let n = 2; taken.has(path); n += 1) {
        path = `outputs/${DOSSIER_PREFIX}${stamp}_${n}.md`;
      }
      const res = await this.gateway.call(projectId, orchestrator.id, 'filesystem.fs_write', { path, content });
      if (!res || res.ok === false) {
        throw new Error(`Scrittura della consegna non riuscita: ${res?.error || 'errore sconosciuto'}`);
      }
      return path;
    });
  }

  /** Renders the client-facing markdown dossier. */
  async #render(projectId, { snapshot, selected, narrative, notes, byUser, dossierTitle }) {
    const ready = selected.filter((i) => i.status === 'ready');
    const partial = selected.filter((i) => i.status === 'partial');
    const lines = [];

    lines.push(`# Consegna — ${dossierTitle}`);
    lines.push(`${snapshot.project?.client || snapshot.project?.name || '—'} · ${snapshot.generated_at.slice(0, 10)} · preparata da ${byUser}`);
    lines.push('');

    lines.push('## Sintesi esecutiva');
    lines.push(narrative.summary);
    lines.push('');

    lines.push('## Pronto alla consegna');
    if (ready.length > 0) {
      lines.push('| Documento | Tipo | Dipartimento | Percorso |');
      lines.push('| --- | --- | --- | --- |');
      for (const item of ready) {
        lines.push(`| ${cell(item.title)} | ${cell(KIND_LABELS[item.kind] || item.kind)} | ${cell(item.department)} | ${cell(item.path)} |`);
      }
    } else {
      lines.push('Nessun documento selezionato come pronto alla consegna.');
    }
    lines.push('');

    lines.push('## In lavorazione');
    if (partial.length > 0) {
      lines.push('| Documento | Stato | Nota |');
      lines.push('| --- | --- | --- |');
      for (const item of partial) {
        lines.push(`| ${cell(item.title)} | In lavorazione | ${cell(item.note || 'Completamento previsto nel ciclo in corso')} |`);
      }
    } else {
      lines.push('Nessun documento in lavorazione fra quelli inclusi in questo pacchetto.');
    }
    lines.push('');

    lines.push('## Non ancora disponibile');
    if (snapshot.gaps.length > 0) {
      for (const gap of snapshot.gaps) lines.push(`- ${gap.label} — ${gap.reason}`);
    } else {
      lines.push('- Nessun elemento mancante rilevato.');
    }
    lines.push('');

    lines.push('## Rischi aperti e prossimi passi');
    for (const risk of narrative.risks) lines.push(`- ${risk}`);
    lines.push('');

    if (notes) {
      lines.push('## Note del consulente');
      lines.push(notes);
      lines.push('');
    }

    lines.push('---');
    lines.push('## Allegati');
    const attachments = selected.filter((i) => i.path);
    if (attachments.length === 0) lines.push('Nessun allegato incluso in questo pacchetto.');
    for (const item of attachments) {
      const body = await this.#readSafe(projectId, item.path);
      lines.push('');
      lines.push(`### ${item.path}`);
      lines.push(body === null ? '_(contenuto non disponibile)_' : truncate(body.trim(), ATTACHMENT_LIMIT));
    }
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Executive summary + risks. Deterministic in mock mode; a single completeText
   * on the orchestrator's model otherwise, with a silent fallback on ANY error
   * (missing key, network, unparsable answer): the dossier must always be built.
   */
  async #narrative(projectId, orchestrator, snapshot) {
    const fallback = deterministicNarrative(snapshot);
    let settings = null;
    try {
      settings = await getSettings();
    } catch {
      return fallback;
    }
    if (!settings || settings.provider === 'mock') return fallback;

    try {
      const client = getLLMClient(providerConfig(settings));
      const { text, usage } = await client.completeText({
        model: modelFor(orchestrator, settings),
        system: [
          orchestrator.system_prompt || '',
          '',
          '---',
          'Stai preparando la nota di consegna per il cliente finale dello studio.',
          'Scrivi in italiano, per un cliente PMI non tecnico: 1 paragrafo di sintesi',
          'e 3-5 bullet di rischi aperti e prossimi passi. Niente gergo interno,',
          'niente nomi di agenti o di file di sistema.',
          'Rispondi ESATTAMENTE in questo formato, senza altro testo:',
          'SINTESI: <un solo paragrafo>',
          'RISCHI:',
          '- <primo punto>',
          '- <secondo punto>',
        ].join('\n'),
        prompt: JSON.stringify(compactSnapshot(snapshot)),
        params: settings.params,
      });
      try {
        this.reportUsage(projectId, orchestrator.id, usage || {}, { phase: 'delivery' });
      } catch {
        // Usage accounting must never break the delivery.
      }
      return parseNarrative(text) || fallback;
    } catch {
      return fallback;
    }
  }

  async #readSafe(projectId, rel) {
    try {
      return await this.store.readFile(projectId, rel);
    } catch {
      return null;
    }
  }
}

// --- helpers -------------------------------------------------------------------

async function safe(fn, fallback) {
  try {
    const value = await fn();
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function safeSync(fn, fallback) {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** Readiness KPIs for a set of items against a given number of open gaps. */
function readinessOf(items, missing) {
  const ready = items.filter((i) => i.status === 'ready').length;
  const partial = items.filter((i) => i.status === 'partial').length;
  const total = ready + partial + missing;
  return { score: total ? Math.round((ready / total) * 100) : null, ready, partial, missing };
}

function taskGap(task, reason) {
  return {
    id: `gap:task:${task.id}`,
    label: `${task.id} — ${clip(task.title || 'task senza titolo', 90)}`,
    reason,
    task_id: task.id || null,
    department: task.department || null,
  };
}

function normalizePath(rel) {
  const value = String(rel || '').trim().replace(/^\.\//, '').replace(/^\/+/, '');
  return value || null;
}

function baseName(rel) {
  const parts = String(rel).split('/');
  return parts[parts.length - 1] || rel;
}

/** Human title of a document: its markdown H1 if present, else the filename. */
function docTitle(content, rel) {
  const heading = String(content || '')
    .split('\n')
    .find((line) => /^#\s+\S/.test(line));
  if (heading) return clip(heading.replace(/^#\s+/, '').trim(), 110);
  const bare = baseName(rel).replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
  return bare ? bare.charAt(0).toUpperCase() + bare.slice(1) : baseName(rel);
}

function clip(text, max) {
  const value = String(text || '').trim();
  return value.length > max ? `${value.slice(0, max).trim()}…` : value;
}

function truncate(text, limit) {
  return text.length > limit ? `${text.slice(0, limit)}\n\n…(troncato)` : text;
}

/** Markdown table cell: no pipes, no newlines, em dash for empty values. */
function cell(value) {
  const text = String(value ?? '').trim();
  if (!text) return '—';
  return text.replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' ');
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

/** Snapshot reduced to what the model needs: no paths, no attachments. */
function compactSnapshot(snapshot) {
  return {
    progetto: {
      nome: snapshot.project?.name || null,
      cliente: snapshot.project?.client || null,
      descrizione: snapshot.project?.description || null,
    },
    completezza: snapshot.readiness,
    pronti: snapshot.items
      .filter((i) => i.status === 'ready')
      .map((i) => ({ titolo: i.title, tipo: i.kind, dipartimento: i.department })),
    in_lavorazione: snapshot.items
      .filter((i) => i.status === 'partial')
      .map((i) => ({ titolo: i.title, nota: i.note })),
    non_disponibili: snapshot.gaps.map((g) => ({ voce: g.label, motivo: g.reason })),
    obiettivi: snapshot.goals.map((g) => ({ testo: clip(g.text, 160), stato: g.status, pronto: g.ready })),
  };
}

/**
 * Parses the model answer into { summary, risks[] }. Tolerant: any prose before
 * the first bullet becomes the summary, section labels are stripped. Returns
 * null when either half is missing, so the caller can fall back.
 */
const NARRATIVE_LABEL = /^(sintesi(\s+esecutiva)?|executive\s+summary|rischi[\w\s'àèéìòù]*|prossimi\s+passi)\s*[:.]?\s*/i;

function parseNarrative(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const summaryParts = [];
  const risks = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const bullet = trimmed.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (bullet) {
      const value = bullet[1].trim();
      if (value) risks.push(value);
      continue;
    }
    if (risks.length > 0) continue; // trailing prose after the bullets is dropped
    const cleaned = trimmed
      .replace(/^#{1,6}\s*/, '')
      // Drop a bold section label ("**Sintesi:**"), keep any other bold text.
      .replace(/^\*\*([^*]{1,40})\*\*\s*[:.]?\s*/, (match, inner) => (NARRATIVE_LABEL.test(inner) ? '' : match))
      .replace(NARRATIVE_LABEL, '')
      .trim();
    if (cleaned) summaryParts.push(cleaned);
  }
  const summary = summaryParts.join(' ').trim();
  if (!summary || risks.length === 0) return null;
  return { summary, risks: risks.slice(0, 6) };
}

/** Deterministic narrative built from the snapshot numbers (mock + fallback). */
function deterministicNarrative(snapshot) {
  const { ready, partial, missing, score } = snapshot.readiness;
  const name = snapshot.project?.name || 'il progetto';
  const client = snapshot.project?.client ? ` per ${snapshot.project.client}` : '';
  const goalsReady = snapshot.goals.filter((g) => g.ready).length;

  const summary = [
    `Al ${snapshot.generated_at.slice(0, 10)} il lavoro su «${name}»${client} conta ${ready} ${plural(ready, 'documento pronto', 'documenti pronti')} alla consegna, ${partial} in lavorazione e ${missing} ${plural(missing, 'elemento non ancora disponibile', 'elementi non ancora disponibili')}.`,
    score === null
      ? 'Non ci sono ancora elementi sufficienti per calcolare un livello di completezza.'
      : `Il livello di completezza complessivo è del ${score}%.`,
    goalsReady > 0
      ? `${goalsReady} ${plural(goalsReady, 'obiettivo è stato chiuso', 'obiettivi sono stati chiusi')} con report finale.`
      : 'Nessun obiettivo è ancora stato chiuso con un report finale.',
  ].join(' ');

  const risks = [];
  for (const gap of snapshot.gaps.slice(0, 3)) risks.push(`Da completare: ${gap.label} (${gap.reason}).`);
  if (partial > 0) {
    risks.push(
      `${partial} ${plural(partial, 'documento è', 'documenti sono')} in attesa di approvazione interna: ${plural(partial, 'va condiviso', 'vanno condivisi')} solo dopo il via libera del Direttore.`
    );
  }
  if (snapshot.gaps.length === 0 && partial === 0) {
    risks.push('Nessun elemento bloccante: il materiale pronto può essere condiviso subito con il cliente.');
  }
  risks.push('Concordare con il cliente la revisione dei documenti consegnati e le priorità del ciclo successivo.');

  return { summary, risks };
}
