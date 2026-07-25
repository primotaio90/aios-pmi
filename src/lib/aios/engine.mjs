import { McpDeniedError } from './gateway.mjs';

/**
 * Orchestration engine — the three-level flow (docs/ARCHITECTURE.md §8):
 * consultant goal → Orchestrator_Core decomposition → Directors (parallel)
 * → on-demand experts (spawn/run/report/teardown) → synthesis → aggregation.
 *
 * Communication is strictly vertical: experts talk only to their director
 * (report), directors only to the orchestrator. The orchestrator never
 * touches sub-agents (enforced by Lifecycle.spawn).
 */
export class Engine {
  constructor({ registry, store, bus, tasks, gateway, lifecycle, runner }) {
    this.registry = registry;
    this.store = store;
    this.bus = bus;
    this.tasks = tasks;
    this.gateway = gateway;
    this.lifecycle = lifecycle;
    this.runner = runner;
    this.running = new Map(); // `${project}/${goalId}` -> Promise
    this.chains = new Map(); // per-project goal-state write serialization
  }

  #chain(projectId, fn) {
    const prev = this.chains.get(projectId) || Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(projectId, next);
    return next;
  }

  async #saveGoal(projectId, goal) {
    return this.#chain(projectId, async () => {
      const goals = await this.store.readState(projectId, 'goals', []);
      const idx = goals.findIndex((g) => g.id === goal.id);
      if (idx === -1) goals.push(goal);
      else goals[idx] = goal;
      await this.store.writeState(projectId, 'goals', goals);
    });
  }

  async listGoals(projectId) {
    return this.store.readState(projectId, 'goals', []);
  }

  /**
   * Entry point for the consultants. Returns the goal immediately;
   * the orchestration runs in background (await via waitFor()).
   */
  async submitGoal(projectId, text, byUser) {
    await this.store.readProject(projectId); // 404 early if the tenant does not exist
    const goals = await this.listGoals(projectId);
    const goal = {
      id: `G-${String(goals.length + 1).padStart(4, '0')}`,
      text,
      created_by: byUser,
      status: 'received',
      macro_goals: [],
      report_path: null,
      created_at: new Date().toISOString(),
      completed_at: null,
    };
    await this.#saveGoal(projectId, goal);
    this.bus.emitEvent(projectId, 'goal.created', { goal_id: goal.id, text, by: byUser });

    const run = this.#run(projectId, goal).catch(async (err) => {
      goal.status = 'failed';
      goal.error = String(err.message || err);
      await this.#saveGoal(projectId, goal);
      this.bus.emitEvent(projectId, 'goal.failed', { goal_id: goal.id, error: goal.error });
      this.bus.emitEvent(projectId, 'notify', {
        level: 'error',
        message: `Goal ${goal.id} fallito: ${goal.error}`,
      });
    });
    this.running.set(`${projectId}/${goal.id}`, run);
    return goal;
  }

  async waitFor(projectId, goalId) {
    const run = this.running.get(`${projectId}/${goalId}`);
    if (run) await run;
    const goals = await this.listGoals(projectId);
    return goals.find((g) => g.id === goalId) || null;
  }

  async #run(projectId, goal) {
    const orchestrator = this.registry.orchestrator();
    if (!orchestrator) throw new Error('Nessun Orchestrator_Core nel registry');
    const directors = this.registry.directors();
    if (directors.length === 0) throw new Error('Nessun Direttore nel registry');

    // 1) Strategic level: macro-decomposition (the orchestrator's ONLY job).
    const macroGoals = await this.runner.decompose(projectId, goal.text, directors);
    goal.status = 'decomposed';
    goal.macro_goals = macroGoals.map((m) => ({ ...m, task_ids: [], status: 'pending' }));
    await this.#saveGoal(projectId, goal);
    this.bus.emitEvent(projectId, 'goal.decomposed', { goal_id: goal.id, macro_goals: goal.macro_goals }, orchestrator.id);

    goal.status = 'in_progress';
    await this.#saveGoal(projectId, goal);

    // 2) Tactical level: each director works its macro-goal in parallel.
    const directorReports = await Promise.all(
      directors.map((director) => {
        const macro = goal.macro_goals.find((m) => m.department === director.department);
        if (!macro) return null;
        return this.#runDirector(projectId, goal, director, macro);
      })
    );

    // 3) Back to the strategic level: aggregate and persist the final report.
    const report = await this.runner.aggregate(projectId, goal, directorReports.filter(Boolean));
    const reportPath = `outputs/${goal.id}_report.md`;
    await this.gateway.call(projectId, orchestrator.id, 'filesystem.fs_write', {
      path: reportPath,
      content: report,
    });

    goal.status = 'completed';
    goal.report_path = reportPath;
    goal.completed_at = new Date().toISOString();
    await this.#saveGoal(projectId, goal);
    this.bus.emitEvent(projectId, 'goal.completed', { goal_id: goal.id, report_path: reportPath }, orchestrator.id);
    this.bus.emitEvent(projectId, 'notify', {
      level: 'info',
      message: `Goal ${goal.id} completato — report in ${reportPath}`,
    });
    return goal;
  }

  async #runDirector(projectId, goal, director, macro) {
    macro.status = 'in_progress';
    await this.#saveGoal(projectId, goal);

    const experts = this.registry.expertsOf(director.id);
    const assignments = await this.runner.plan(
      projectId,
      director,
      { ...macro, goal_text: goal.text },
      experts
    );

    const expertReports = [];
    for (const assignment of assignments) {
      const expert = this.registry.get(assignment.expertId);
      if (!expert) continue;
      const task = await this.tasks.create(projectId, {
        title: assignment.title,
        department: director.department,
        assignee: expert.id,
        created_by: director.id,
        goal_id: goal.id,
      });
      macro.task_ids.push(task.id);
      await this.#saveGoal(projectId, goal);
      await this.tasks.transition(projectId, task.id, 'assigned', director.id);

      const report = await this.#runExpert(projectId, goal, director, expert, task);
      if (report) expertReports.push(report);
    }

    // Director approves finished work: review → done.
    for (const report of expertReports) {
      await this.tasks.transition(projectId, report.task_id, 'done', director.id);
    }

    const synthesis = await this.runner.synthesize(projectId, director, macro, expertReports);

    // The director maintains its own knowledge files (append, never overwrite).
    for (const file of director.owns_files) {
      await this.gateway.call(projectId, director.id, 'filesystem.fs_write', {
        path: file,
        mode: 'append',
        content: `\n\n## Aggiornamento ${new Date().toISOString().slice(0, 10)} — ${goal.id}\n\n${synthesis}\n`,
      });
    }

    macro.status = expertReports.length > 0 ? 'done' : 'blocked';
    await this.#saveGoal(projectId, goal);

    // Vertical report: director → orchestrator.
    this.bus.emitEvent(
      projectId,
      'agent.report',
      { to: this.registry.orchestrator()?.id, goal_id: goal.id, department: director.department, summary_preview: synthesis.slice(0, 160) },
      director.id
    );

    return {
      department: director.department,
      director_name: director.name,
      synthesis,
      expert_reports: expertReports,
    };
  }

  /** Full expert lifecycle: spawn → in_progress → run → review + report → teardown. */
  async #runExpert(projectId, goal, director, expert, task) {
    let instance = null;
    try {
      instance = this.lifecycle.spawn(projectId, expert.id, director.id, task.id);
      await this.tasks.transition(projectId, task.id, 'in_progress', expert.id);

      // Tool facade bound to this expert: whitelist enforcement lives in the
      // gateway. `context: 'unattended'` tells the autonomy gate (Fase A) that an
      // `ask` here must wait at most the queue timeout, then the task falls back
      // to the existing `blocked` state (never hangs a background run).
      const tools = {
        call: (tool, payload) => this.gateway.call(projectId, expert.id, tool, payload, { context: 'unattended' }),
      };
      const result = await this.runner.runExpert(projectId, expert, task, goal.text, tools);

      await this.tasks.setReport(projectId, task.id, result.summary, result.outputs);
      await this.tasks.transition(projectId, task.id, 'review', expert.id);

      // Vertical report: expert → its director only.
      this.bus.emitEvent(
        projectId,
        'agent.report',
        { to: director.id, task_id: task.id, summary_preview: result.summary.slice(0, 160) },
        expert.id
      );

      return {
        task_id: task.id,
        expert_id: expert.id,
        expert_name: expert.name,
        summary: result.summary,
        outputs: result.outputs,
      };
    } catch (err) {
      const current = await this.tasks.get(projectId, task.id);
      if (current && ['assigned', 'in_progress'].includes(current.status)) {
        await this.tasks.transition(projectId, task.id, 'blocked', expert.id);
      }
      this.bus.emitEvent(projectId, 'notify', {
        level: 'warn',
        message: `${expert.name} bloccato su ${task.id}: ${String(err.message || err)}`,
      });
      if (err instanceof McpDeniedError) return null;
      return null;
    } finally {
      if (instance) {
        this.lifecycle.teardown(
          projectId,
          instance.instance_id,
          (await this.tasks.get(projectId, task.id))?.status === 'blocked' ? 'error' : 'completed'
        );
      }
    }
  }

  /** Aggregated view for the dashboard home (orchestrator + 3 directors only). */
  async overview(projectId) {
    const project = await this.store.readProject(projectId);
    const goals = await this.listGoals(projectId);
    const activeGoal =
      [...goals].reverse().find((g) => ['received', 'decomposed', 'in_progress'].includes(g.status)) ||
      goals[goals.length - 1] ||
      null;
    const allTasks = await this.tasks.list(projectId, activeGoal ? { goal_id: activeGoal.id } : {});
    const active = this.lifecycle.active(projectId);

    const directors = this.registry.directors().map((director) => {
      const deptTasks = allTasks.filter((t) => t.department === director.department);
      const done = deptTasks.filter((t) => t.status === 'done').length;
      const subagents = active.filter((i) => i.by === director.id);
      const inFlight = deptTasks.find((t) => ['in_progress', 'assigned'].includes(t.status));
      let status = 'idle';
      if (deptTasks.some((t) => t.status === 'blocked')) status = 'blocked';
      else if (subagents.length > 0 || inFlight) status = 'working';
      else if (deptTasks.some((t) => t.status === 'review')) status = 'review';
      const macro = activeGoal?.macro_goals?.find((m) => m.department === director.department);
      return {
        id: director.id,
        name: director.name,
        department: director.department,
        icon: director.icon,
        color: director.color,
        status,
        progress: deptTasks.length ? Math.round((done / deptTasks.length) * 100) : null,
        active_subagents: subagents.length,
        current_focus: inFlight?.title || macro?.description || null,
        task_counts: countByStatus(deptTasks),
      };
    });

    const progresses = directors.map((d) => d.progress).filter((p) => p !== null);
    const orchestratorAgent = this.registry.orchestrator();
    return {
      project,
      orchestrator: orchestratorAgent
        ? {
          id: orchestratorAgent.id,
          name: orchestratorAgent.name,
          icon: orchestratorAgent.icon,
          color: orchestratorAgent.color,
          status: activeGoal && activeGoal.status !== 'completed' && activeGoal.status !== 'failed' ? 'orchestrating' : 'idle',
          progress: progresses.length ? Math.round(progresses.reduce((a, b) => a + b, 0) / progresses.length) : null,
          active_goal: activeGoal
            ? { id: activeGoal.id, text: activeGoal.text, status: activeGoal.status, macro_goals: activeGoal.macro_goals, report_path: activeGoal.report_path }
            : null,
        }
        : null,
      directors,
    };
  }
}

function countByStatus(tasks) {
  const counts = {};
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
  return counts;
}
