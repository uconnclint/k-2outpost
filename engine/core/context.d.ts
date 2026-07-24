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
  destroy(): void;
}

// TSave parameterizes the save blob's shape (goofy-rocket-lab's
// createGameContext<SavedState> usage); it defaults to `any` so plain
// untyped usage stays exactly as loose as before.
export interface CeSave<TSave = any> {
  get(): TSave;
  patch(partial: Partial<TSave>): void;
  save(): void;
  flush(): void;
  reset(): void;
  destroy(): void;
  persistent?: boolean;
  [extra: string]: any;
}

export interface GameContext<TSave = any> {
  save: CeSave<TSave>;
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
  events: { on: Function; off: Function; emit: Function; clear: Function };
  destroy(): void;
}

export function createGameContext<TSave = any>(options: Record<string, any>): GameContext<TSave>;
