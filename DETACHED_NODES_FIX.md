# Detached Nodes Fix for Dashboard Components

## Issue Description

Your Vue.js dashboard application was experiencing detached DOM nodes, which occur when DOM elements are removed from the document tree but still exist in memory. This causes memory leaks and can lead to performance degradation over time.

## Root Causes Identified

1. **Missing cleanup lifecycle hooks** in Vue components
2. **IntersectionObserver not properly disconnected** in chart renderers
3. **Event listeners not removed** on component unmount
4. **Grid layout components** leaving DOM references behind
5. **Chart instances not properly disposed** when panels are destroyed

## Fixes Applied

### 1. PanelContainer Component (`web/src/components/dashboards/PanelContainer.vue`)

**Added proper cleanup in `onBeforeUnmount`:**
```javascript
onBeforeUnmount(() => {
  // Clear any pending timeouts or intervals
  // Reset refs to help with garbage collection
  metaData.value = null;
  errorData.value = "";
  
  // Clear the PanelSchemaRenderer reference
  if (PanelSchemaRendererRef.value) {
    PanelSchemaRendererRef.value = null;
  }
});
```

### 2. RenderDashboardCharts Component (`web/src/views/Dashboards/RenderDashboardCharts.vue`)

**Added cleanup for grid layout references:**
```javascript
onBeforeUnmount(() => {
  // Clean up grid layout reference
  if (gridLayoutRef.value) {
    gridLayoutRef.value = null;
  }
  
  // Clean up any other references that might cause memory leaks
  if (variablesValueSelectorRef.value) {
    variablesValueSelectorRef.value = null;
  }
});
```

### 3. ChartRenderer Component (`web/src/components/dashboards/panels/ChartRenderer.vue`)

**Consolidated and improved cleanup in `onUnmounted`:**
```javascript
onUnmounted(() => {
  // Clean up event listeners
  window.removeEventListener("resize", windowResizeEventCallback);
  
  // Cancel throttled functions
  throttledSetHoveredSeriesName.cancel();
  throttledSetHoveredSeriesIndex.cancel();
  
  // Clean up chart instance
  chart?.dispose();
  chart = null;

  // Clean up intersection observer
  if (chartRef.value && isChartVisibleObserver) {
    isChartVisibleObserver.unobserve(chartRef.value);
    isChartVisibleObserver.disconnect();
    isChartVisibleObserver = null;
  }
  
  // Clear chart reference
  if (chartRef.value) {
    chartRef.value = null;
  }
});
```

## Memory Leak Detection Utility

Created `web/src/utils/memoryLeakDetector.js` to help monitor and detect future memory leaks:

### Usage:
```javascript
// In development, it auto-starts
// For manual control:
window.memoryLeakDetector.startMonitoring();
window.memoryLeakDetector.logMemoryUsage();
window.memoryLeakDetector.checkDashboardNodes();
window.memoryLeakDetector.forceGC(); // Requires Chrome --js-flags="--expose-gc"
```

## Testing for Detached Nodes

### 1. Chrome DevTools Method:
1. Open Chrome DevTools (F12)
2. Go to **Memory** tab
3. Select **Heap snapshot**
4. Take a snapshot before and after using dashboard features
5. Search for "Detached" in the snapshot to find detached DOM nodes

### 2. Performance Tab:
1. Go to **Performance** tab in DevTools
2. Record performance while using the dashboard
3. Look for memory leaks in the memory graph

### 3. Using the Memory Leak Detector:
```javascript
// Open browser console and run:
memoryLeakDetector.logMemoryUsage('Before Dashboard Action');
// Perform dashboard actions (add/remove panels, switch tabs, etc.)
memoryLeakDetector.logMemoryUsage('After Dashboard Action');
memoryLeakDetector.checkDashboardNodes();
```

## Best Practices Going Forward

### 1. Always Add Cleanup Hooks
```javascript
// In Vue 3 Composition API
import { onBeforeUnmount } from 'vue';

export default {
  setup() {
    onBeforeUnmount(() => {
      // Clean up event listeners
      // Dispose chart instances
      // Clear observers
      // Null out references
    });
  }
}
```

### 2. Proper Event Listener Management
```javascript
onMounted(() => {
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
});
```

### 3. Observer Cleanup
```javascript
let observer;

onMounted(() => {
  observer = new IntersectionObserver(callback);
  observer.observe(element);
});

onBeforeUnmount(() => {
  if (observer) {
    observer.unobserve(element);
    observer.disconnect();
    observer = null;
  }
});
```

### 4. Chart Instance Management
```javascript
let chart;

onMounted(() => {
  chart = echarts.init(element);
});

onBeforeUnmount(() => {
  if (chart) {
    chart.dispose();
    chart = null;
  }
});
```

## Monitoring and Prevention

1. **Regular Memory Audits**: Use the memory leak detector periodically
2. **Code Reviews**: Check for proper cleanup in new components
3. **Testing**: Test panel creation/deletion cycles extensively
4. **Performance Monitoring**: Monitor memory usage in production

## Files Modified

- `web/src/components/dashboards/PanelContainer.vue`
- `web/src/views/Dashboards/RenderDashboardCharts.vue`
- `web/src/components/dashboards/panels/ChartRenderer.vue`
- `web/src/utils/memoryLeakDetector.js` (new file)

## Next Steps

1. Test the dashboard functionality thoroughly
2. Monitor memory usage using the detector utility
3. Apply similar cleanup patterns to other components as needed
4. Consider implementing automated memory leak tests in your CI/CD pipeline

The fixes should significantly reduce or eliminate the detached nodes issue. Monitor the application using the provided tools to ensure the problem is resolved. 