// Project Manager (Fase 2) — agent above the Orchestrator.
//
// Position: [consultants] <-> PM <-> [Orchestrator_Core -> Directors -> Experts].
// The PM is a CLIENT of the bus and the Engine: it subscribes to goal.* / task.*
// and to delivery.produced (the DeliveryDesk dossier) to build project state, and
// emits its own pm.* topics (already carried by the SSE channel without changes to
// bus.mjs). It never talks to Directors or experts.
//
// Responsibilities (docs/FASE2_PM.md + user requirements):
//  - overview(): KPIs + interactive checklist (files produced/to-produce, tasks,
//    deliveries) derived from existing project state, without touching the engine
//    state machine.
//  - chat(): rule-based reply in mock mode (LLM in AIOS_RUNNER=claude), so the
//    consultant can keep working while the agent team is busy.
//  - notifyConsultant(): audit-trailed "email" (persisted in state/pm_notifications.json
//    + pm.notification event). Real SMTP is a declared extension point, inactive
//    here (coherent with transport: internal — no network).
//  - toggleChecklist(): per-consultant checklist ticks persisted in state/pm_checklist.json
//    (kept separate from tasks.json to never alter the engine state machine).
//  - suggestNext(): proposes next actions from blocked/review tasks.
//
// Auto-subscriber: on task.status -> review/blocked, on goal.completed and on
// delivery.produced it emits a pm.notification addressed to the consultant who
// should review, proceed or hand the delivery package over to the client.
export class ProjectManager {
    constructor({ registry, store, bus, tasks, engine }) {
        this.registry = registry;
        this.store = store;
        this.bus = bus;
        this.tasks = tasks;
        this.engine = engine;
        this.chains = new Map(); // per-project write serialization
        this.subscribed = false;
    }

    #chain(projectId, fn) {
        const prev = this.chains.get(projectId) || Promise.resolve();
        const next = prev.then(fn, fn);
        this.chains.set(projectId, next);
        return next;
    }

    /** Idempotent bus subscription (called once by system wiring). */
    start() {
        if (this.subscribed) return;
        this.subscribed = true;
        this.bus.subscribe((evt) => this.#onEvent(evt).catch(() => { }));
    }

    async #onEvent(evt) {
        if (!evt.project || evt.project === '*') return;
        if (evt.type !== 'task.status' && evt.type !== 'goal.completed' && evt.type !== 'delivery.produced') return;

        if (evt.type === 'task.status') {
            const data = evt.data || {};
            // review or blocked → the responsible consultant must act.
            if (data.to === 'review' || data.to === 'blocked') {
                const task = await this.tasks.get(evt.project, data.task_id);
                if (!task) return;
                const subject =
                    data.to === 'review'
                        ? `Task ${task.id} da revisionare`
                        : `Task ${task.id} bloccato`;
                const body =
                    data.to === 'review'
                        ? `Il task "${task.title}" (dipartimento ${task.department}) è in attesa di revisione. Assegnatario: ${task.assignee}.`
                        : `Il task "${task.title}" (dipartimento ${task.department}) è bloccato. È richiesto un intervento. Assegnatario: ${task.assignee}.`;
                await this.notifyConsultant(evt.project, {
                    to: 'consultants',
                    subject,
                    body,
                    task_id: task.id,
                    level: data.to === 'blocked' ? 'warn' : 'info',
                });
            }
        }

        if (evt.type === 'goal.completed') {
            const data = evt.data || {};
            await this.notifyConsultant(evt.project, {
                to: 'consultants',
                subject: `Goal ${data.goal_id} completato`,
                body: `Il goal ${data.goal_id} è stato completato. Il report finale è disponibile in ${data.report_path || 'outputs/'}.`,
                goal_id: data.goal_id,
                level: 'success',
            });
        }

        if (evt.type === 'delivery.produced') {
            // The DeliveryDesk wrote a client-facing dossier: tell the consultant
            // it is ready to be shared, with the readiness numbers of the snapshot.
            const data = evt.data || {};
            await this.notifyConsultant(evt.project, {
                to: 'consultants',
                subject: `Pacchetto di consegna pronto`,
                body: `È stato generato il pacchetto di consegna ${data.path} (${data.ready} documenti pronti, ${data.partial} in lavorazione, ${data.missing} non disponibili). Puoi condividerlo con il cliente.`,
                level: 'success',
            });
        }
    }

    /** Aggregated project overview with KPIs and interactive checklist. */
    async overview(projectId) {
        const project = await this.store.readProject(projectId);
        const goals = (await this.engine.listGoals(projectId)) || [];
        const tasks = (await this.tasks.list(projectId)) || [];

        const activeGoal =
            [...goals].reverse().find((g) => ['received', 'decomposed', 'in_progress'].includes(g.status)) ||
            goals[goals.length - 1] ||
            null;

        const taskCounts = countBy(tasks, (t) => t.status);
        const done = taskCounts.done || 0;
        const total = tasks.length;
        const progress = total ? Math.round((done / total) * 100) : null;

        // --- Checklist: files produced / to produce / tasks / deliveries ------------
        const produced = [];
        const toProduce = [];
        for (const t of tasks) {
            if ((t.outputs || []).length > 0) {
                for (const o of t.outputs) produced.push({ item_id: `out:${o}`, label: o, kind: 'file', source: t.id });
            } else if (t.status !== 'done') {
                toProduce.push({ item_id: `task:${t.id}`, label: `${t.id} — ${t.title}`, kind: 'task', source: t.id });
            }
        }
        const deliveryFiles = await this.store.listFiles(projectId, 'delivery');
        const deliveries = deliveryFiles.map((f) => ({
            item_id: `del:${f.path}`,
            label: f.path,
            kind: 'delivery',
        }));

        const checklist = await this.#readChecklist(projectId);
        const checklistItems = [
            ...produced.map((p) => ({ ...p, checked: Boolean(checklist[p.item_id]) })),
            ...toProduce.map((p) => ({ ...p, checked: Boolean(checklist[p.item_id]) })),
            ...deliveries.map((p) => ({ ...p, checked: Boolean(checklist[p.item_id]) })),
        ];

        // --- KPIs -------------------------------------------------------------------
        const blocked = tasks.filter((t) => t.status === 'blocked');
        const inReview = tasks.filter((t) => t.status === 'review');
        const kpis = {
            goals_total: goals.length,
            goals_completed: goals.filter((g) => g.status === 'completed').length,
            tasks_total: total,
            tasks_done: done,
            tasks_blocked: blocked.length,
            tasks_review: inReview.length,
            progress,
        };

        // --- Recent notifications ---------------------------------------------------
        const notifications = (await this.#readNotifications(projectId)).slice(-20).reverse();

        return {
            project,
            active_goal: activeGoal
                ? { id: activeGoal.id, text: activeGoal.text, status: activeGoal.status, report_path: activeGoal.report_path }
                : null,
            kpis,
            checklist: checklistItems,
            blocked_tasks: blocked.map((t) => ({ id: t.id, title: t.title, department: t.department, assignee: t.assignee })),
            review_tasks: inReview.map((t) => ({ id: t.id, title: t.title, department: t.department, assignee: t.assignee })),
            notifications,
            pm: this.registry.pm()
                ? { id: this.registry.pm().id, name: this.registry.pm().name, icon: this.registry.pm().icon, color: this.registry.pm().color }
                : null,
        };
    }

    /** Suggests the next actions derived from blocked/review tasks. */
    async suggestNext(projectId) {
        const tasks = await this.tasks.list(projectId);
        const blocked = tasks.filter((t) => t.status === 'blocked');
        const review = tasks.filter((t) => t.status === 'review');
        const suggestions = [];
        for (const t of review) {
            suggestions.push({
                kind: 'review',
                task_id: t.id,
                text: `Revisiona il task ${t.id} (${t.title}) del dipartimento ${t.department}.`,
            });
        }
        for (const t of blocked) {
            suggestions.push({
                kind: 'blocked',
                task_id: t.id,
                text: `Sblocca il task ${t.id} (${t.title}): richiede intervento del consulente.`,
            });
        }
        if (suggestions.length === 0) {
            suggestions.push({ kind: 'ok', text: 'Nessuna azione bloccante. Il progetto procede regolarmente.' });
        }
        this.bus.emitEvent(
            projectId,
            'pm.suggestion',
            { suggestions: suggestions.slice(0, 6) },
            this.registry.pm()?.id || null
        );
        return suggestions;
    }

    /**
     * Dialog with the consultant. Rule-based in mock mode (no LLM dependency):
     * answers are derived from project state and the message keywords, mirroring
     * the deterministic mock-runner pattern. In AIOS_RUNNER=claude this is the
     * extension point for a real LLM call.
     */
    async chat(projectId, message, byUser) {
        const overview = await this.overview(projectId);
        const text = String(message || '').toLowerCase();
        const reply = this.#reply(text, overview);

        const entry = {
            ts: new Date().toISOString(),
            by: byUser || 'consultant',
            role: 'user',
            text: message,
        };
        const pmEntry = {
            ts: new Date().toISOString(),
            by: this.registry.pm()?.id || 'project_manager',
            role: 'pm',
            text: reply,
        };
        const history = await this.#readChat(projectId);
        history.push(entry, pmEntry);
        if (history.length > 100) history.splice(0, history.length - 100);
        await this.#writeChat(projectId, history);

        this.bus.emitEvent(
            projectId,
            'pm.question',
            { by: byUser || 'consultant', message, reply },
            this.registry.pm()?.id || null
        );
        return { reply, history: history.slice(-20) };
    }

    #reply(text, overview) {
        const k = overview.kpis;
        if (/stato|panoramica|come va|andamento/.test(text)) {
            return `Panoramica: ${k.tasks_done}/${k.tasks_total} task completati (${k.progress ?? 0}%), ${k.tasks_blocked} bloccati, ${k.tasks_review} in revisione. Goal completati: ${k.goals_completed}/${k.goals_total}.`;
        }
        if (/priorit|prossim|cosa faccio|cosa devo/.test(text)) {
            if (overview.blocked_tasks.length > 0) {
                const t = overview.blocked_tasks[0];
                return `Priorità: sbloccare il task ${t.id} (${t.title}, dipartimento ${t.department}).`;
            }
            if (overview.review_tasks.length > 0) {
                const t = overview.review_tasks[0];
                return `Priorità: revisionare il task ${t.id} (${t.title}, dipartimento ${t.department}).`;
            }
            return `Nessuna azione bloccante in questo momento. Il progetto è al ${k.progress ?? 0}%.`;
        }
        if (/review|revision/.test(text)) {
            const n = overview.review_tasks.length;
            return n > 0 ? `Ci sono ${n} task in attesa di revisione.` : 'Nessun task in revisione al momento.';
        }
        if (/blocc|problem/.test(text)) {
            const n = overview.blocked_tasks.length;
            return n > 0 ? `Ci sono ${n} task bloccati che richiedono intervento.` : 'Nessun task bloccato.';
        }
        if (/consegn|delivery|file/.test(text)) {
            const delivered = overview.checklist.filter((c) => c.kind === 'delivery').length;
            const produced = overview.checklist.filter((c) => c.kind === 'file').length;
            return `File prodotti: ${produced}. Documenti in delivery/: ${delivered}.`;
        }
        if (/goal|obiettiv/.test(text)) {
            const g = overview.active_goal;
            return g ? `Goal attivo: ${g.id} (${g.status}).` : 'Nessun goal attivo al momento.';
        }
        return `Ricevuto. Per una panoramica chiedi "stato del progetto"; per le priorità chiedi "prossime azioni". Attualmente: ${k.tasks_done}/${k.tasks_total} task completati.`;
    }

    /** Persists a notification-email (audit trail) + emits pm.notification. */
    async notifyConsultant(projectId, { to, subject, body, task_id, goal_id, level = 'info' }) {
        const notif = {
            id: `N-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            ts: new Date().toISOString(),
            to,
            subject,
            body,
            level,
            task_id: task_id || null,
            goal_id: goal_id || null,
            // Extension point: a real SMTP transport would send here. In this phase
            // every notification is an audit-trail record surfaced in the UI.
            transport: 'audit',
        };
        await this.#appendNotification(projectId, notif);
        this.bus.emitEvent(
            projectId,
            'pm.notification',
            notif,
            this.registry.pm()?.id || null
        );
        return notif;
    }

    /** Toggles a checklist item (persisted separately from the engine state). */
    async toggleChecklist(projectId, itemId, checked) {
        return this.#chain(projectId, async () => {
            const checklist = await this.#readChecklist(projectId);
            if (checked) checklist[itemId] = true;
            else delete checklist[itemId];
            await this.store.writeState(projectId, 'pm_checklist', checklist);
            return { item_id: itemId, checked: Boolean(checklist[itemId]) };
        });
    }

    // --- persistence helpers -----------------------------------------------------
    async #readChecklist(projectId) {
        return (await this.store.readState(projectId, 'pm_checklist', {})) || {};
    }

    async #readNotifications(projectId) {
        return (await this.store.readState(projectId, 'pm_notifications', [])) || [];
    }

    async #appendNotification(projectId, notif) {
        return this.#chain(projectId, async () => {
            const list = await this.#readNotifications(projectId);
            list.push(notif);
            if (list.length > 500) list.splice(0, list.length - 500);
            await this.store.writeState(projectId, 'pm_notifications', list);
        });
    }

    async #readChat(projectId) {
        return (await this.store.readState(projectId, 'pm_chat', [])) || [];
    }

    async #writeChat(projectId, history) {
        await this.store.writeState(projectId, 'pm_chat', history);
    }
}

function countBy(items, keyFn) {
    const counts = {};
    for (const item of items) {
        const k = keyFn(item);
        counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
}