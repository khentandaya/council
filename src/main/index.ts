import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bus } from './bus.ts';
import { runChair } from './chair.ts';
import { activeProfile, loadConfig, saveConfig } from './config.ts';
import { accountSummaries, configuredConnections, createProfile, folderSessions, knownFolders, openSignIn, sessionTranscript } from './sessions.ts';
import type { Connection, CouncilConfig, CouncilEvent } from '../shared/types.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const res = (f: string) => join(app.isPackaged ? process.resourcesPath : join(here, '../../resources'), f);

app.setAppUserModelId('com.council.app');
if (!app.requestSingleInstanceLock()) app.quit();

const bus = new Bus();
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let current: { runId: string; ac: AbortController } | null = null;
const pendingPermissions = new Map<string, (a: { allow: boolean; always: boolean }) => void>();
let liveConnections: Connection[] = [];
const busyTasks = new Set<string>();

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    frame: false, show: false, backgroundColor: '#0c0d10',
    title: 'Council', icon: res('icon.png'),
    webPreferences: { preload: join(here, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      // the office must keep moving while the window sits behind your editor
      backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(here, '../renderer/index.html'));
  win.on('closed', () => { win = null; });
}

function updateTray() {
  if (!tray) return;
  const busy = !!current;
  tray.setImage(nativeImage.createFromPath(res(busy ? 'tray-busy.png' : 'tray.png')));
  tray.setToolTip(busy ? `Council: working${busyTasks.size ? ` (${busyTasks.size} task${busyTasks.size > 1 ? 's' : ''} out)` : ''}` : 'Council: idle');
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(res('tray.png')));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Council', click: () => { win ? win.show() : createWindow(); } },
    { label: 'Stop current run', click: () => current?.ac.abort() },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]));
  tray.on('click', () => { if (win) { win.show(); win.focus(); } else createWindow(); });
  updateTray();
}

bus.on((e: CouncilEvent) => {
  win?.webContents.send('council:event', e);
  if (e.kind === 'dispatch' && e.taskId) busyTasks.add(e.taskId);
  if ((e.kind === 'worker_done' || e.kind === 'worker_error') && e.taskId) busyTasks.delete(e.taskId);
  if (e.kind === 'chair_init') {
    const mcp = (e.data?.mcp as { name: string; status: string }[] | undefined) ?? [];
    liveConnections = mcp.map((m) => ({ agent: 'chair', name: m.name, status: m.status }));
  }
  if (e.kind === 'dispatch' || e.kind === 'worker_done' || e.kind === 'worker_error') updateTray();
  if ((e.kind === 'run_done' || e.kind === 'permission') && win && !win.isFocused() && Notification.isSupported()) {
    new Notification({ title: e.kind === 'run_done' ? 'Council finished' : 'Council needs your OK', body: (e.text ?? '').slice(0, 140), icon: res('icon.png') }).show();
  }
});

// ---- IPC ---------------------------------------------------------------
ipcMain.handle('config:get', async () => { const c = loadConfig(); return { ...c, recentFolders: await knownFolders(c, activeProfile(c)) }; });
ipcMain.handle('config:set', (_e, patch: Partial<CouncilConfig>) => saveConfig(patch));
ipcMain.handle('folder:pick', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: 'Choose a workspace folder' });
  if (r.canceled || !r.filePaths[0]) return null;
  saveConfig({ currentFolder: r.filePaths[0] });
  return r.filePaths[0];
});
ipcMain.handle('sessions:list', async () => {
  const c = loadConfig();
  return c.currentFolder ? folderSessions(activeProfile(c), c.currentFolder).catch(() => []) : [];
});
ipcMain.handle('sessions:load', async (_e, id: string) => {
  const c = loadConfig();
  return c.currentFolder ? sessionTranscript(activeProfile(c), c.currentFolder, id).catch(() => []) : [];
});
ipcMain.handle('accounts:list', () => accountSummaries(loadConfig()));
ipcMain.handle('accounts:signin', (_e, id: string) => {
  const c = loadConfig();
  const p = c.profiles.find((x) => x.id === id);
  if (p) openSignIn(c.bins.claude, p);
});
ipcMain.handle('accounts:add', (_e, name: string) => {
  const c = loadConfig();
  const p = createProfile(c, name);
  return saveConfig({ profiles: [...c.profiles, p] });
});
ipcMain.handle('connections:list', () => {
  const c = loadConfig();
  const configured = configuredConnections(activeProfile(c), c.currentFolder);
  const live = new Map(liveConnections.map((x) => [x.name, x]));
  const merged = configured.map((x) => live.get(x.name) && x.agent === 'chair' ? { ...x, status: live.get(x.name)!.status } : x);
  for (const l of liveConnections) if (!merged.some((m) => m.agent === 'chair' && m.name === l.name)) merged.push(l);
  return merged;
});
ipcMain.handle('run:start', (_e, prompt: string, resume: string | null) => {
  if (current) throw new Error('A run is already in progress.');
  const config = loadConfig();
  if (!config.currentFolder) throw new Error('Pick a workspace folder first.');
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const ac = new AbortController();
  current = { runId, ac };
  updateTray();
  const emit = (e: Omit<CouncilEvent, 'seq' | 'ts' | 'runId'>) => bus.emit(runId, e);
  emit({ kind: 'run_start', agent: 'chair', text: prompt, data: { resume, folder: config.currentFolder, profile: config.activeProfileId } });
  runChair(prompt, resume, {
    config, profile: activeProfile(config), cwd: config.currentFolder, emit, signal: ac.signal,
    askPermission: (req) => new Promise((resolve) => {
      pendingPermissions.set(req.id, resolve);
      ac.signal.addEventListener('abort', () => resolve({ allow: false, always: false }), { once: true });
    }),
  })
    .catch((err) => emit({ kind: 'run_error', agent: 'chair', text: ac.signal.aborted ? 'Stopped.' : String(err?.message ?? err) }))
    .finally(() => { current = null; busyTasks.clear(); pendingPermissions.clear(); updateTray(); });
  return { runId };
});
ipcMain.handle('run:stop', () => { current?.ac.abort(); });
ipcMain.handle('permission:answer', (_e, id: string, allow: boolean, always: boolean) => {
  pendingPermissions.get(id)?.({ allow, always });
  pendingPermissions.delete(id);
});
ipcMain.on('window', (_e, action: 'min' | 'max' | 'close') => {
  if (!win) return;
  if (action === 'min') win.minimize();
  else if (action === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  else win.close();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => { createWindow(); createTray(); });
// keep running in the tray while a run is in progress
app.on('window-all-closed', () => { if (!current) app.quit(); });
