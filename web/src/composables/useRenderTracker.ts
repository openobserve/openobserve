// Copyright 2023 OpenObserve Inc.
// Component re-render tracking - detects which props/data triggered re-renders

import { onUpdated, getCurrentInstance, ref } from 'vue';

interface RenderEvent {
  timestamp: number;
  renderNumber: number;
  timeSinceLastRender: number;
  changedProps: string[];
  changedData: string[];
}

export function useRenderTracker(componentName: string) {
  const instance = getCurrentInstance();
  const renderCount = ref(0);
  const renderEvents = ref<RenderEvent[]>([]);
  let lastRenderTime = performance.now();

  // Track previous prop values
  const previousProps = ref<Record<string, any>>({});

  onUpdated(() => {
    const now = performance.now();
    const timeSinceLastRender = now - lastRenderTime;
    renderCount.value++;

    // Detect which props changed
    const changedProps: string[] = [];
    const currentProps = instance?.props || {};

    Object.keys(currentProps).forEach(key => {
      // Skip internal Vue props
      if (key.startsWith('_') || key.startsWith('$')) return;

      if (!Object.is(previousProps.value[key], currentProps[key])) {
        changedProps.push(key);

        if (import.meta.env.DEV) {
          console.log(
            `[${componentName}] 🔄 Prop changed: "${key}"`,
            '\n  Previous:', previousProps.value[key],
            '\n  Current:', currentProps[key]
          );
        }
      }
    });

    // Store current props for next comparison
    previousProps.value = { ...currentProps };

    // Record render event
    const event: RenderEvent = {
      timestamp: now,
      renderNumber: renderCount.value,
      timeSinceLastRender,
      changedProps,
      changedData: [] // Can be extended to track reactive data
    };

    renderEvents.value.push(event);
    lastRenderTime = now;

    if (import.meta.env.DEV) {
      console.log(
        `[${componentName}] 🎨 Re-render #${renderCount.value} (${timeSinceLastRender.toFixed(2)}ms since last)`
      );

      // Log if re-render seems excessive
      if (timeSinceLastRender < 16) {
        console.warn(
          `[${componentName}] ⚠️ Rapid re-render detected! Less than 16ms since last render.`
        );
      }
    }
  });

  const logRenderStats = () => {
    console.group(`📊 Render Stats: ${componentName}`);
    console.log('Total Re-renders:', renderCount.value);

    if (renderEvents.value.length > 0) {
      const avgTime = renderEvents.value
        .slice(1) // Skip first render
        .reduce((sum, e) => sum + e.timeSinceLastRender, 0) / (renderEvents.value.length - 1 || 1);

      console.log('Avg Time Between Renders:', avgTime.toFixed(2) + 'ms');

      // Group by changed props
      const propChanges: Record<string, number> = {};
      renderEvents.value.forEach(event => {
        event.changedProps.forEach(prop => {
          propChanges[prop] = (propChanges[prop] || 0) + 1;
        });
      });

      if (Object.keys(propChanges).length > 0) {
        console.log('Props That Triggered Re-renders:');
        console.table(propChanges);
      } else {
        console.log('No prop changes detected (likely internal state changes)');
      }
    }

    console.groupEnd();
    return {
      renderCount: renderCount.value,
      events: renderEvents.value
    };
  };

  const clearStats = () => {
    renderCount.value = 0;
    renderEvents.value = [];
    lastRenderTime = performance.now();
    console.log(`[${componentName}] Render stats cleared.`);
  };

  // Expose to window for console access
  if (import.meta.env.DEV) {
    (window as any)[`__render_${componentName}`] = {
      logStats: logRenderStats,
      clear: clearStats,
      events: renderEvents
    };
  }

  return {
    renderCount,
    renderEvents,
    logRenderStats,
    clearStats
  };
}
