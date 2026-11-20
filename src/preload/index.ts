import { contextBridge, ipcRenderer } from 'electron';
import type { CouncilApi, CouncilEvent } from '../shared/types.ts';

const api: CouncilApi = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  loadSession: (id) => ipcRenderer.invoke('sessions:load', id),
  accounts: () => ipcRenderer.invoke('accounts:list'),
  signIn: (id) => ipcRenderer.invoke('accounts:signin', id),
  addProfile: (name) => ipcRenderer.invoke('accounts:add', name),
  connections: () => ipcRenderer.invoke('connections:list'),
  run: (prompt, resume) => ipcRenderer.invoke('run:start', prompt, resume),
  stop: () => ipcRenderer.invoke('run:stop'),
  answerPermission: (id, allow, always) => ipcRenderer.invoke('permission:answer', id, allow, always),
  window: (action) => ipcRenderer.send('window', action),
  onEvent: (cb) => {
    const h = (_: unknown, e: CouncilEvent) => cb(e);
    ipcRenderer.on('council:event', h);
    return () => ipcRenderer.removeListener('council:event', h);
  },
};

contextBridge.exposeInMainWorld('council', api);
