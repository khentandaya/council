// Run the chair without the UI:  node scripts/harness.ts "<prompt>" [folder]
// Permissions are auto-denied so nothing outside Council's workers changes files.
import { runChair } from '../src/main/chair.ts';
import { activeProfile, loadConfig } from '../src/main/config.ts';

const prompt = process.argv[2];
const cwd = process.argv[3] ?? process.cwd();
if (!prompt) { console.error('usage: node scripts/harness.ts "<prompt>" [folder]'); process.exit(1); }

const config = loadConfig();
const t0 = Date.now();
const ac = new AbortController();
process.on('SIGINT', () => ac.abort());

await runChair(prompt, null, {
  config, profile: activeProfile(config), cwd, signal: ac.signal,
  askPermission: async (r) => { console.log(`  [perm] denied: ${r.summary}`); return { allow: false, always: false }; },
  emit: (e) => {
    const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
    const tag = `${e.kind}${e.taskId ? ' ' + e.taskId : ''}${e.tier !== undefined ? ' T' + e.tier : ''}`;
    const text = (e.text ?? (e.model ? `model=${e.model}` : '')).replace(/\s+/g, ' ').slice(0, 160);
    if (e.kind === 'worker_text') return; // too chatty for a terminal
    console.log(`${s}s ${e.agent.padEnd(11)} ${tag.padEnd(20)} ${text}${e.model && e.text ? `  [${e.model}]` : ''}`);
  },
});
