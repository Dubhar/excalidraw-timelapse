/** Navigation state machine: rest -> morph -> rest. Strictly manual: nothing advances by itself. */
import type { El, Frame } from "./types";
import { buildTransition, easeInOut, lerp, lerpColor, type Transition } from "./interpolate";

export interface Snapshot { index: number; target: number | null }
type Render = (elements: El[], background: string) => void;

export class Controller {
  private snap: Snapshot = { index: 0, target: null };
  private anim: { from: number; to: number; t0: number; tr: Transition } | null = null;
  private cache = new Map<string, Transition>();
  private raf = 0;
  private subs = new Set<() => void>();
  private progressSubs = new Set<(pos: number) => void>();

  constructor(
    readonly frames: Frame[],
    private readonly opts: { transitionMs: number },
    private readonly render: Render,
  ) {
    this.show(0);
  }

  /* react-friendly store */
  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  getSnapshot = () => this.snap;
  onProgress(fn: (pos: number) => void) { this.progressSubs.add(fn); return () => { this.progressSubs.delete(fn); }; }
  private set(patch: Partial<Snapshot>) { this.snap = { ...this.snap, ...patch }; this.subs.forEach((f) => f()); }
  private emitProgress(pos: number) { this.progressSubs.forEach((f) => f(pos)); }

  get last() { return this.frames.length - 1; }

  private transition(from: number, to: number) {
    const key = `${from}>${to}`;
    let tr = this.cache.get(key);
    if (!tr) { tr = buildTransition(this.frames[from].elements, this.frames[to].elements); this.cache.set(key, tr); }
    return tr;
  }

  private show(i: number) {
    this.render(this.frames[i].elements, this.frames[i].background);
    this.emitProgress(i);
  }

  goTo(i: number) {
    i = Math.max(0, Math.min(this.last, i));
    this.finish(); // snap any in-flight morph to its end (keeps keys responsive)
    if (i === this.snap.index) return;
    this.anim = { from: this.snap.index, to: i, t0: performance.now(), tr: this.transition(this.snap.index, i) };
    this.set({ target: i });
    this.raf = requestAnimationFrame(this.step);
  }
  next() { this.goTo((this.anim ? this.anim.to : this.snap.index) + 1); }
  prev() { this.goTo((this.anim ? this.anim.to : this.snap.index) - 1); }
  first() { this.goTo(0); }
  lastFrame() { this.goTo(this.last); }

  private step = (now: number) => {
    const a = this.anim;
    if (!a) return;
    const p = Math.min(1, (now - a.t0) / this.opts.transitionMs);
    const e = easeInOut(p);
    this.render(a.tr.at(e), lerpColor(this.frames[a.from].background, this.frames[a.to].background, e));
    this.emitProgress(lerp(a.from, a.to, e));
    if (p >= 1) this.finish();
    else this.raf = requestAnimationFrame(this.step);
  };

  private finish() {
    const a = this.anim;
    if (!a) return;
    cancelAnimationFrame(this.raf);
    this.anim = null;
    this.show(a.to);
    this.set({ index: a.to, target: null });
  }

  /** Re-render the current resting frame (e.g. after fonts finish loading). */
  refresh() { if (!this.anim) this.show(this.snap.index); }
  dispose() { cancelAnimationFrame(this.raf); }
}
