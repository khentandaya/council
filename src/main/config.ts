import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defaultBins } from './env.ts';
import type { CouncilConfig, Profile } from '../shared/types.ts';

export const DATA_DIR = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Council');
const FILE = join(DATA_DIR, 'config.json');

function defaults(): CouncilConfig {
  return {
    profiles: [{ id: 'a', name: 'Account 1', configDir: join(homedir(), '.claude') }],
    activeProfileId: 'a',
    recentFolders: [],
    currentFolder: null,
    chairModel: 'opus',
    chairEffort: 'medium',
    pipeline: true,
    handoffAtPct: 20,
    workerTimeoutMin: 10,
    // read-only by default; add build/test commands here to let Antigravity run them
    agyAllowCommands: ['cat', 'type', 'head', 'tail', 'ls', 'dir', 'Get-Content', 'Get-ChildItem', 'rg', 'grep', 'findstr', 'git status', 'git diff', 'git log', 'git show'],
    bins: defaultBins(),
  };
}

let cache: CouncilConfig | null = null;

export function loadConfig(): CouncilConfig {
  if (cache) return cache;
  const d = defaults();
  try {
    // tolerate a BOM: PowerShell and Notepad add one when people hand-edit this file
    const saved = JSON.parse(readFileSync(FILE, 'utf8').replace(/^﻿/, '')) as Partial<CouncilConfig>;
    // binaries we can find beat stale saved paths
    const bins = { ...d.bins };
    for (const k of Object.keys(bins) as (keyof typeof bins)[]) {
      if (saved.bins?.[k] && existsSync(saved.bins[k])) bins[k] = saved.bins[k];
    }
    cache = { ...d, ...saved, pipeline: saved.pipeline ?? d.pipeline, handoffAtPct: saved.handoffAtPct ?? d.handoffAtPct, bins };
  } catch {
    cache = d;
  }
  return cache;
}

export function saveConfig(patch: Partial<CouncilConfig>): CouncilConfig {
  const next = { ...loadConfig(), ...patch };
  if (patch.currentFolder) {
    next.recentFolders = [patch.currentFolder, ...next.recentFolders.filter((f) => f.toLowerCase() !== patch.currentFolder!.toLowerCase())].slice(0, 12);
  }
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(next, null, 2));
  cache = next;
  return next;
}

export function activeProfile(c = loadConfig()): Profile {
  return c.profiles.find((p) => p.id === c.activeProfileId) ?? c.profiles[0];
}
