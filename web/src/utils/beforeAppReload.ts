// Copyright 2026 OpenObserve Inc.

export type BeforeAppReloadHook = () => void | Promise<void>;

const hooks = new Set<BeforeAppReloadHook>();

export function onBeforeAppReload(hook: BeforeAppReloadHook): () => void {
  hooks.add(hook);
  return () => {
    hooks.delete(hook);
  };
}

export async function runBeforeAppReloadHooks(): Promise<void> {
  // A failing hook must never hold back the reload the user asked for.
  await Promise.allSettled([...hooks].map(async (hook) => hook()));
}
