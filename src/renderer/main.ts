import './mock.ts';   // must stay first: installs the demo bridge outside Electron
import './styles.css';
import { Office } from './office/scene.ts';
import { mountOverlay, refreshUsageCard } from './office/overlay.ts';
import { apply, state, subscribe } from './store.ts';
import { bumpContext, refreshAccounts, refreshConfig, refreshConnections, refreshContext, refreshSessions, refreshUsage } from './ui/data.ts';
import { mountDrawer } from './ui/drawer.ts';
import { mountSidebar, mountTitlebar } from './ui/shell.ts';
import { mountDock, mountLedger, mountPromptbar } from './ui/stage.ts';

const $ = (id: string) => document.getElementById(id)!;

const office = new Office($('office') as HTMLCanvasElement);
mountOverlay($('office-overlay'), office);
mountTitlebar($('titlebar'));
mountSidebar($('sidebar'));
mountLedger($('ledger'));
mountDock($('dock'));
mountPromptbar($('promptbar'));
mountDrawer($('drawer'));

window.council.onEvent((e) => {
  if (e.kind === 'context' || e.kind === 'run_start') bumpContext();
  apply(e);
  office.handle(e);
  if (e.kind === 'run_done' || e.kind === 'run_error') {
    refreshSessions(); refreshConnections(); refreshUsage(true); refreshContext();
  }
  if (e.kind === 'chair_init') refreshConnections();
  if (e.kind === 'worker_done' || e.kind === 'worker_error') { refreshSessions(); refreshUsage(true); }
});

// a fresh conversation clears the office too
subscribe((t) => {
  if (t === 'entries' && state.entries.length === 0 && !state.running) office.reset();
  if (t === 'usage') { office.setUsage(state.usage); refreshUsageCard(); }
});

await refreshConfig();
await Promise.all([refreshAccounts(), refreshSessions(), refreshConnections()]);
refreshUsage();
// plan limits move slowly; a light poll keeps the meters honest between runs
setInterval(() => { if (!document.hidden) refreshUsage(); }, 120_000);
