/** An Excalidraw element (loosely typed on purpose: we only touch known props). */
export type El = Record<string, any>;

export interface PayloadFrame {
  label: string;
  file: string;
  /** keys into Payload.pool, in z-order */
  elements: string[];
  background: string;
}

export interface Payload {
  version: number;
  title: string;
  transitionMs: number;
  pool: Record<string, El>;
  frames: PayloadFrame[];
  files: Record<string, any>;
  warnings: string[];
}

export interface Frame {
  label: string;
  file: string;
  elements: El[];
  background: string;
}
