import { EventEmitter } from 'node:events';

/**
 * Event bus — the single communication backbone of the system.
 * Every event has the shape { ts, project, type, agent, data }.
 * Project "*" marks global (non-tenant) events, e.g. registry.updated.
 *
 * Fase 2: the Project Manager agent will be just another subscriber of this bus
 * (topics goal.*, task.*) and will emit its own pm.* topics — no refactor needed.
 */
export class Bus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(200);
  }

  /**
   * Emits an event on both the generic "event" channel (persistence, SSE)
   * and the per-type channel (targeted subscribers).
   */
  emitEvent(project, type, data = {}, agent = null) {
    const evt = { ts: new Date().toISOString(), project, type, agent, data };
    this.emit('event', evt);
    this.emit(type, evt);
    return evt;
  }

  /** Subscribes to all events; returns an unsubscribe function. */
  subscribe(fn) {
    this.on('event', fn);
    return () => this.off('event', fn);
  }
}
