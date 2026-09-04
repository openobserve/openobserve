// Ambient declarations for third-party modules that ship no type definitions,
// which under moduleResolution "bundler" otherwise raise TS7016 (implicit any
// from an untyped module). These are external boundaries — the app treats their
// surface loosely on purpose. Type-only; no runtime effect.
declare module "reodotdev";
declare module "monaco-editor/esm/vs/editor/editor.all.js";

// sortablejs ships no types; declare the minimal surface the app uses
// (Sortable.create / instance destroy+option / SortableEvent). Type-only.
declare module "sortablejs" {
  class Sortable {
    static create(el: HTMLElement, options?: Sortable.SortableOptions): Sortable;
    destroy(): void;
    option(name: string): unknown;
    option(name: string, value: unknown): void;
  }
  // Merged namespace so `Sortable.SortableEvent` / `Sortable.SortableOptions`
  // resolve as types on the default-imported value (canonical @types pattern).
  namespace Sortable {
    interface SortableEvent {
      oldIndex?: number;
      newIndex?: number;
      item: HTMLElement;
      from: HTMLElement;
      to: HTMLElement;
    }
    interface SortableOptions {
      animation?: number;
      handle?: string;
      onEnd?: (event: SortableEvent) => void;
      [option: string]: unknown;
    }
  }
  export = Sortable;
}

// echarts-gl ships no type declarations.
declare module "echarts-gl";
