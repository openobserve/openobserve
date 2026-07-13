/// <reference types="vite/client" />

// Build-time constants injected by Vite
declare const __COMMIT_HASH__: string;
declare const __BUILD_TIME__: number;

// Virtual modules provided by unplugin-icons — resolved at build time, never at runtime.
declare module "~icons/*" {
  import type { FunctionalComponent, SVGAttributes } from "vue";
  const component: FunctionalComponent<SVGAttributes>;
  export default component;
}

// --- Vendor modules that ship no type definitions (silence TS7016) -----------
// These packages have no bundled types and no installed @types. The shims below
// type only the surface we actually use; signatures are intentionally permissive
// so they don't manufacture new errors.

// reodotdev — analytics SDK, no published types.
declare module "reodotdev" {
  interface ReoInstance {
    init(options: { clientID: string }): void;
    identify(...args: unknown[]): void;
    pushData(data: unknown): void;
    track(...args: unknown[]): void;
  }
  export function loadReoScript(options: {
    clientID: string;
    source?: string;
  }): Promise<ReoInstance>;
}

// sortablejs — no bundled types and @types/sortablejs is not installed.
declare module "sortablejs" {
  class Sortable {
    constructor(el: HTMLElement, options?: Sortable.Options);
    static create(el: HTMLElement, options?: Sortable.Options): Sortable;
    destroy(): void;
    option(name: string, value?: unknown): unknown;
  }
  namespace Sortable {
    interface SortableEvent {
      oldIndex?: number;
      newIndex?: number;
      item: HTMLElement;
      from: HTMLElement;
      to: HTMLElement;
    }
    interface Options {
      handle?: string;
      animation?: number;
      onEnd?: (evt: SortableEvent) => void;
      [key: string]: unknown;
    }
  }
  export = Sortable;
}

// monaco deep side-effect import — registers all editor features; no exports used.
declare module "monaco-editor/esm/vs/editor/editor.all.js";
