/**
 * Sub-agent lifecycle: spawn → execution → report → teardown.
 * Enforces the vertical-only hierarchy:
 *   - only "expert" agents can be spawned;
 *   - only the expert's own director can spawn it (never the orchestrator,
 *     never another expert, never a different director).
 * Every spawn/teardown is emitted on the bus and lands in logs/lifecycle.jsonl.
 */
export class Lifecycle {
  constructor(registry, bus) {
    this.registry = registry;
    this.bus = bus;
    this.instances = new Map(); // projectId -> Map(instanceId -> instance)
    this.counter = 0;
  }

  #project(projectId) {
    let map = this.instances.get(projectId);
    if (!map) {
      map = new Map();
      this.instances.set(projectId, map);
    }
    return map;
  }

  active(projectId) {
    return [...this.#project(projectId).values()];
  }

  spawn(projectId, agentId, byAgentId, taskId) {
    const agent = this.registry.get(agentId);
    const by = this.registry.get(byAgentId);
    if (!agent) throw new Error(`Agente ${agentId} inesistente`);
    if (agent.level !== 'expert') {
      throw new Error(`Solo i sub-agenti expert possono essere istanziati (${agentId} è ${agent.level})`);
    }
    if (!by || by.level !== 'director' || agent.director !== byAgentId) {
      throw new Error(
        `Violazione gerarchia: ${byAgentId} non può istanziare ${agentId} (direttore richiesto: ${agent.director})`
      );
    }
    this.counter += 1;
    const instance = {
      instance_id: `${agentId}#${this.counter}`,
      agent: agentId,
      name: agent.name,
      department: agent.department,
      by: byAgentId,
      task: taskId,
      token_budget: agent.token_budget,
      spawned_at: new Date().toISOString(),
    };
    this.#project(projectId).set(instance.instance_id, instance);
    this.bus.emitEvent(
      projectId,
      'agent.spawned',
      {
        event: 'spawn',
        instance_id: instance.instance_id,
        by: byAgentId,
        task: taskId,
        token_budget: agent.token_budget,
      },
      agentId
    );
    return instance;
  }

  teardown(projectId, instanceId, reason = 'completed') {
    const map = this.#project(projectId);
    const instance = map.get(instanceId);
    if (!instance) return;
    map.delete(instanceId);
    this.bus.emitEvent(
      projectId,
      'agent.teardown',
      {
        event: 'teardown',
        instance_id: instanceId,
        by: instance.by,
        task: instance.task,
        reason,
        context_released: true,
        lifetime_ms: Date.now() - Date.parse(instance.spawned_at),
      },
      instance.agent
    );
  }
}
