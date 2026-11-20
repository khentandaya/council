import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { WorkerSession } from '../shared/types.ts';
import { DATA_DIR } from './config.ts';

export const HANDOFFS_DIR = resolve(DATA_DIR, 'handoffs');
const FILE = join(DATA_DIR, 'worker-sessions.json');
let writes = Promise.resolve();

async function readWorkerSessions(): Promise<Record<string, Omit<WorkerSession, 'sessionId'>>> {
  try {
    const sessions = JSON.parse(await readFile(FILE, 'utf8'));
    return sessions && typeof sessions === 'object' && !Array.isArray(sessions) ? sessions : {};
  } catch (err) {
    if (err instanceof SyntaxError || (err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

export function workerSessions(): ReturnType<typeof readWorkerSessions> {
  return readWorkerSessions().catch(() => ({}));
}

export function recordWorkerSession({ sessionId, ...entry }: WorkerSession) {
  const write = writes.then(async () => {
    // A read failure must not turn an append into a replacement of the registry.
    const sessions = await readWorkerSessions();
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(`${FILE}.tmp`, JSON.stringify({ ...sessions, [sessionId]: entry }, null, 2), 'utf8');
    await rename(`${FILE}.tmp`, FILE);
  });
  writes = write.catch(() => {});
  return write;
}

function sameFolder(a: string, b: string) {
  return relative(a, b) === '';
}

export async function folderWorkerSessions(folder: string): Promise<WorkerSession[]> {
  return Object.entries(await workerSessions())
    .filter(([, entry]) => sameFolder(entry.folder, folder))
    .map(([sessionId, entry]) => ({ ...entry, sessionId }))
    .sort((a, b) => b.ts - a.ts);
}

function inside(root: string, file: string) {
  const path = relative(root, file);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export async function readWorkerHandoff(folder: string, sessionId: string): Promise<string | null> {
  const sessions = await workerSessions();
  if (!Object.hasOwn(sessions, sessionId)) return null;
  const { folder: savedFolder, handoffPath } = sessions[sessionId];
  if (!sameFolder(savedFolder, folder) || !inside(HANDOFFS_DIR, handoffPath) || extname(handoffPath) !== '.md') return null;
  const [root, file] = await Promise.all([realpath(HANDOFFS_DIR), realpath(handoffPath)]);
  if (!inside(root, file) || extname(file) !== '.md' || !(await stat(file)).isFile()) return null;
  return readFile(file, 'utf8');
}
