#!/usr/bin/env node
/**
 * Scenario demo end-to-end della PMI fittizia, SENZA server HTTP:
 *   node scripts/demo.mjs [--project rovere-arredamenti] [--goal "..."]
 * Invia un obiettivo all'Orchestratore, attende il completamento della
 * gerarchia (Direttori → sub-agenti) e stampa task, log e deliverable.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { getSystem } = await import(path.join(ROOT, 'src/lib/aios/system.mjs'));

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const project = arg('project', 'rovere-arredamenti');
const goalText = arg(
  'goal',
  'Digitalizzare il magazzino di Rovere & Figli: eliminare le schede cartacee, integrare il gestionale GestArredo 9 e formare il personale'
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const countLines = async (rel) => {
  try {
    const raw = await fs.readFile(path.join(ROOT, 'projects', project, rel), 'utf-8');
    return raw.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
};

const sys = await getSystem();
console.log('════════════════════════════════════════════════════════');
console.log(' AIOS — Demo end-to-end');
console.log('════════════════════════════════════════════════════════');
console.log(`Runner: ${sys.runnerMode} · Agenti nel registry: ${sys.registry.all().length} (errori: ${sys.registry.errors.length})`);
console.log(`Progetto: ${project}`);
console.log(`Obiettivo: ${goalText}`);
console.log('');

const t0 = Date.now();
const goal = await sys.engine.submitGoal(project, goalText, 'demo');
console.log(`→ ${goal.id} inviato all'Orchestratore, attendo la gerarchia...`);
const finalGoal = await sys.engine.waitFor(project, goal.id);
await sleep(600); // i log JSONL si scrivono in modo asincrono

console.log('');
console.log(`■ Stato goal: ${finalGoal.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
for (const macro of finalGoal.macro_goals || []) {
  console.log(`  · [${macro.department}] ${macro.status} — ${macro.description.slice(0, 80)}…`);
}

const tasks = await sys.tasks.list(project, { goal_id: goal.id });
console.log('');
console.log(`■ Task (${tasks.length})`);
for (const t of tasks) {
  console.log(`  ${t.id}  ${t.status.padEnd(11)} ${t.department.padEnd(8)} ${t.assignee}`);
}

console.log('');
console.log('■ Audit trail');
console.log(`  logs/lifecycle.jsonl : ${await countLines('logs/lifecycle.jsonl')} righe (spawn/teardown)`);
console.log(`  logs/mcp_calls.jsonl : ${await countLines('logs/mcp_calls.jsonl')} righe (chiamate MCP)`);
console.log(`  logs/events.jsonl    : ${await countLines('logs/events.jsonl')} righe (bus completo)`);

const outputs = await sys.store.listFiles(project, 'outputs');
console.log('');
console.log(`■ Deliverable in outputs/ (${outputs.length})`);
for (const f of outputs.filter((x) => x.name !== '.gitkeep')) {
  console.log(`  ${f.path} (${f.size} byte)`);
}
if (finalGoal.report_path) {
  console.log('');
  console.log(`■ Report finale: projects/${project}/${finalGoal.report_path}`);
}

console.log('');
console.log(finalGoal.status === 'completed' ? '✔ Demo completata.' : `✘ Demo terminata con stato: ${finalGoal.status} ${finalGoal.error || ''}`);
process.exit(finalGoal.status === 'completed' ? 0 : 1);
