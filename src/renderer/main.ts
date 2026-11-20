import './mock.ts';   // must stay first: installs the demo bridge outside Electron
import './styles.css';
import { Office } from './office/scene.ts';
import { mountOverlay } from './office/overlay.ts';
import { apply, state, subscribe } from './store.ts';
import { refreshAccounts, refreshConfig, refreshConnections, refreshSessions } from './ui/data.ts';
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
  apply(e);
  office.handle(e);
  if (e.kind === 'run_done' || e.kind === 'run_error') { refreshSessions(); refreshConnections(); }
  if (e.kind === 'chair_init') refreshConnections();
});

// a fresh conversation clears the office too
subscribe((t) => { if (t === 'entries' && state.entries.length === 0 && !state.running) office.reset(); });

await refreshConfig();
await Promise.all([refreshAccounts(), refreshSessions(), refreshConnections()]);
