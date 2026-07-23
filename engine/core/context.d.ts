// context.d.ts — minimal TypeScript declarations for TS games (clintsgolf,
// goofy-rocket-lab, …). Deliberately loose: the engine is plain JS with JSDoc;
// these stubs exist so `tsc` accepts the import without a hand-rolled shim
// that the next `sync-engine.mjs` run would wipe (this file lives INSIDE
// engine/ precisely so syncs carry it). Tighten types opportunistically.

export interface CeSettings {
  get(key: string): any;
  set(key: string, value: any): void;
  onChange(fn: (key: string, value: any, all: Record<string, any>) => void): () => void;
  reducedMotion(): boolean;
}

export interface CeSave {
  get(): any;
  patch(partial: Record<string, any>): void;
  save(): void;
  flush(): void;
  reset(): void;
  persistent?: boolean;
  [extra: string]: any;
}

export interface GameContext {
  save: CeSave;
  settings: CeSettings;
  audio: any;
  speech: any;
  feedback: any;
  progress: any | null;
  random: {
    rng: () => number;
    next(): number;
    pick<T>(arr: T[]): T;
    shuffle<T>(arr: T[]): T[];
    randInt(a: number, b: number): number;
  };
  events: { on: Function; off: Function; emit: Function };
}

export function createGameContext(options: Record<string, any>): GameContext;
