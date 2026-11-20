import { createElement, type IconNode } from 'lucide';

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: string };

/** Tiny hyperscript: h('div', { class: 'x', onclick }, child, ...) */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k in el && typeof v !== 'string') (el as any)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function icon(node: IconNode, size = 16, cls = ''): SVGElement {
  const el = createElement(node);
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('stroke-width', '1.75');
  el.setAttribute('aria-hidden', 'true');
  if (cls) el.setAttribute('class', `icon ${cls}`); else el.classList.add('icon');
  return el;
}

export function clear(el: Element, ...children: (Child | Child[])[]) {
  el.replaceChildren();
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
}

export function relTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const hr = Math.round(m / 60); if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24); if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function fmtSecs(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export function basename(p: string) { return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p; }

/** Click-outside-to-close popover anchored under an element. */
export function popover(anchor: HTMLElement, content: HTMLElement, align: 'left' | 'right' = 'left') {
  const root = document.getElementById('popover-root')!;
  root.replaceChildren();
  const r = anchor.getBoundingClientRect();
  const pop = h('div', { class: 'popover', role: 'menu' }, content);
  pop.style.top = `${r.bottom + 6}px`;
  if (align === 'left') pop.style.left = `${r.left}px`; else pop.style.right = `${window.innerWidth - r.right}px`;
  root.append(pop);
  const close = (e?: Event) => {
    if (e && (pop.contains(e.target as Node) || anchor.contains(e.target as Node))) return;
    pop.remove();
    document.removeEventListener('mousedown', close);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); anchor.focus(); } };
  setTimeout(() => { document.addEventListener('mousedown', close); document.addEventListener('keydown', onKey); });
  (pop.querySelector('button, [tabindex]') as HTMLElement | null)?.focus();
  return () => close();
}
