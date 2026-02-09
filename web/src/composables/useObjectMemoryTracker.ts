// Copyright 2023 OpenObserve Inc.
// Object-level memory tracking using FinalizationRegistry

export function useObjectMemoryTracker(label: string) {
  if (!import.meta.env.DEV) {
    return {
      track: () => {},
      checkLeaks: () => {}
    };
  }

  const trackedObjects = new WeakMap<object, string>();
  const registry = new FinalizationRegistry((heldValue: string) => {
    console.log(`♻️ [${label}] Object garbage collected:`, heldValue);
  });

  const track = (obj: object, identifier: string) => {
    if (!obj || typeof obj !== 'object') {
      console.warn(`Cannot track non-object value:`, identifier);
      return;
    }

    trackedObjects.set(obj, identifier);
    registry.register(obj, identifier);
    console.log(`👁️ [${label}] Now tracking:`, identifier);
  };

  const checkLeaks = () => {
    // Force garbage collection if available (Chrome with --js-flags=--expose-gc)
    if ((global as any).gc) {
      console.log('Running garbage collection...');
      (global as any).gc();
      console.log('GC complete. Check console for garbage collection messages.');
    } else {
      console.warn(
        'GC not available. To enable:\n' +
        '  Chrome: Run with --js-flags=--expose-gc\n' +
        '  Node: Run with --expose-gc flag'
      );
    }
  };

  return { track, checkLeaks };
}
