import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './config.ts';
import type { CouncilEvent } from '../shared/types.ts';

const RUNS = join(DATA_DIR, 'runs');
type Listener = (e: CouncilEvent) => void;

/** Fans events out to the window and appends them to runs/<runId>.jsonl for replay. */
export class Bus {
  private seq = 0;
  private listeners = new Set<Listener>();
  private chain: Promise<unknown> = mkdir(RUNS, { recursive: true });

  on(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }

  emit(runId: string, e: Omit<CouncilEvent, 'seq' | 'ts' | 'runId'>) {
    const full: CouncilEvent = { ...e, seq: ++this.seq, ts: Date.now(), runId };
    for (const l of this.listeners) l(full);
    // worker_text is a running snapshot; skip it in the log to keep files small
    if (e.kind !== 'worker_text') {
      this.chain = this.chain.then(() => appendFile(join(RUNS, `${runId}.jsonl`), JSON.stringify(full) + '\n')).catch(() => {});
    }
    return full;
  }
}
