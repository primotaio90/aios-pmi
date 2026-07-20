export const TASK_STATES = ['pending', 'assigned', 'in_progress', 'blocked', 'review', 'done'];

/** Allowed transitions of the task state machine (docs/ARCHITECTURE.md §3). */
export const TRANSITIONS = {
  pending: ['assigned'],
  assigned: ['in_progress', 'blocked'],
  in_progress: ['blocked', 'review'],
  blocked: ['assigned', 'in_progress'],
  review: ['in_progress', 'done'],
  done: [],
};

/**
 * Task manager: persists tasks per tenant in state/tasks.json, validates every
 * transition and emits task.created / task.status on the bus.
 */
export class TaskManager {
  constructor(store, bus) {
    this.store = store;
    this.bus = bus;
    // Serializes read-modify-write cycles per project.
    this.chains = new Map();
  }

  #chain(projectId, fn) {
    const prev = this.chains.get(projectId) || Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(projectId, next);
    return next;
  }

  async #readAll(projectId) {
    return this.store.readState(projectId, 'tasks', []);
  }

  async create(projectId, { title, department, assignee, created_by, goal_id }) {
    return this.#chain(projectId, async () => {
      const tasks = await this.#readAll(projectId);
      const now = new Date().toISOString();
      const task = {
        id: `T-${String(tasks.length + 1).padStart(4, '0')}`,
        goal_id,
        title,
        department,
        assignee,
        created_by,
        status: 'pending',
        report: null,
        outputs: [],
        created_at: now,
        updated_at: now,
        history: [],
      };
      tasks.push(task);
      await this.store.writeState(projectId, 'tasks', tasks);
      this.bus.emitEvent(projectId, 'task.created', { task_id: task.id, title, department, assignee }, created_by);
      return task;
    });
  }

  async transition(projectId, taskId, to, by) {
    return this.#chain(projectId, async () => {
      const tasks = await this.#readAll(projectId);
      const task = tasks.find((t) => t.id === taskId);
      if (!task) throw new Error(`Task ${taskId} inesistente`);
      if (!TRANSITIONS[task.status]?.includes(to)) {
        throw new Error(`Transizione non ammessa: ${task.status} → ${to} (${taskId})`);
      }
      const from = task.status;
      task.status = to;
      task.updated_at = new Date().toISOString();
      task.history.push({ ts: task.updated_at, from, to, by });
      await this.store.writeState(projectId, 'tasks', tasks);
      this.bus.emitEvent(projectId, 'task.status', { task_id: taskId, from, to, department: task.department }, by);
      return { ...task };
    });
  }

  async setReport(projectId, taskId, report, outputs = []) {
    return this.#chain(projectId, async () => {
      const tasks = await this.#readAll(projectId);
      const task = tasks.find((t) => t.id === taskId);
      if (!task) throw new Error(`Task ${taskId} inesistente`);
      task.report = report;
      task.outputs = [...new Set([...task.outputs, ...outputs])];
      task.updated_at = new Date().toISOString();
      await this.store.writeState(projectId, 'tasks', tasks);
      return { ...task };
    });
  }

  async list(projectId, { department, status, goal_id } = {}) {
    let tasks = await this.#readAll(projectId);
    if (department) tasks = tasks.filter((t) => t.department === department);
    if (status) tasks = tasks.filter((t) => t.status === status);
    if (goal_id) tasks = tasks.filter((t) => t.goal_id === goal_id);
    return tasks;
  }

  async get(projectId, taskId) {
    const tasks = await this.#readAll(projectId);
    return tasks.find((t) => t.id === taskId) || null;
  }
}
