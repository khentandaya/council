import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const APPDATA = process.env.APPDATA ?? join(HOME, 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA ?? join(HOME, 'AppData', 'Local');

/** Where each CLI normally lives on Windows. A GUI app launched from the Start menu
 *  can't rely on a terminal's PATH, so we look in the install locations directly. */
export function defaultBins() {
  const first = (...c: string[]) => c.find((p) => existsSync(p)) ?? c[0];
  const claude = [join(HOME, '.local', 'bin', 'claude.exe'), join(APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')].find((p) => existsSync(p));
  return {
    // empty = use the Claude binary bundled with the Agent SDK
    claude: claude ?? '',
    codex: first(join(APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')),
    agy: first(join(LOCALAPPDATA, 'agy', 'bin', 'agy.exe')),
  };
}

/** Variables a parent Claude Code session leaks into children. If a child CLI sees them
 *  it thinks it's a nested session talking to the parent's host, so we strip them. */
const LEAKY = /^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID$|CLAUDE_PREVIEW_|ANTHROPIC_BASE_URL$|ELECTRON_RUN_AS_NODE$)/;

export function cleanEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !LEAKY.test(k)) out[k] = v;
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

/** Codex's npm wrapper (bin/codex.js) spawns the native codex.exe without windowsHide.
 *  Under Electron the wrapper has no console, so Windows opens a new terminal window
 *  for codex.exe on every task. Launching codex.exe ourselves keeps it hidden. */
function codexNative(bin: string): { exe: string; env: Record<string, string> } | null {
  if (process.platform !== 'win32' || !/[\\/]@openai[\\/]codex[\\/]bin[\\/]codex\.js$/i.test(bin)) return null;
  const root = join(bin, '..', '..');
  const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const pkg = process.arch === 'arm64' ? 'codex-win32-arm64' : 'codex-win32-x64';
  const exe = [join(root, 'node_modules', '@openai', pkg, 'vendor', triple, 'bin', 'codex.exe'),
    join(root, '..', pkg, 'vendor', triple, 'bin', 'codex.exe'),
    join(root, 'vendor', triple, 'bin', 'codex.exe')].find((p) => existsSync(p));
  // the same variables the wrapper sets, so codex still knows npm manages it
  return exe ? { exe, env: { CODEX_MANAGED_BY_NPM: '1', CODEX_MANAGED_PACKAGE_ROOT: root } } : null;
}

/** How to launch a binary: .js entry points run under this process's Node
 *  (Electron with ELECTRON_RUN_AS_NODE, or plain node in the harness). */
export function launchSpec(bin: string, args: string[]): { cmd: string; args: string[]; env: Record<string, string> } {
  const native = codexNative(bin);
  if (native) return { cmd: native.exe, args, env: native.env };
  if (bin.endsWith('.js')) {
    const env: Record<string, string> = process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {};
    return { cmd: process.execPath, args: [bin, ...args], env };
  }
  return { cmd: bin, args, env: {} };
}
