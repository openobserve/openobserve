<!-- Copyright 2023 OpenObserve Inc. -->
<!-- Test component for validating performance tracking composables -->

<template>
  <div class="performance-test-container" style="padding: 20px; max-width: 800px;">
    <h2>🧪 Performance Composables Test</h2>

    <div class="test-section">
      <h3>1. Performance Tracker Test</h3>
      <button @click="testPerformanceTracker" class="test-btn">
        Run Performance Test
      </button>
      <p>Click button, then check console and run: <code>__perfTrackerTest()</code></p>
    </div>

    <div class="test-section">
      <h3>2. Render Tracker Test</h3>
      <button @click="triggerReRender" class="test-btn">
        Trigger Re-render ({{ renderTrigger }})
      </button>
      <p>Click button multiple times, then run: <code>__render_PerformanceTest.logStats()</code></p>
    </div>

    <div class="test-section">
      <h3>3. Memory Profiler Test</h3>
      <button @click="startMemoryTest" class="test-btn" :disabled="memoryTracking">
        {{ memoryTracking ? 'Tracking...' : 'Start Memory Test' }}
      </button>
      <button @click="allocateMemory" class="test-btn">
        Allocate Memory
      </button>
      <button @click="stopMemoryTest" class="test-btn" :disabled="!memoryTracking">
        Stop & Check Results
      </button>
      <p>Start tracking, allocate memory, then check: <code>__memory_PerformanceTest.logStats()</code></p>
    </div>

    <div class="test-section">
      <h3>4. Console Commands</h3>
      <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px;">
// Performance metrics
__perfTrackerTest()

// Render stats
__render_PerformanceTest.logStats()
__render_PerformanceTest.clear()

// Memory stats
__memory_PerformanceTest.logStats()
__memory_PerformanceTest.detectLeak()
      </pre>
    </div>

    <div v-if="testData.length > 0" class="test-section">
      <h4>Test Data ({{ testData.length }} items)</h4>
      <p>Memory allocated to test memory profiler</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { usePerformanceTracker } from '@/composables/usePerformanceTracker';
import { useRenderTracker } from '@/composables/useRenderTracker';
import { useMemoryProfiler } from '@/composables/useMemoryProfiler';

// Test data
const renderTrigger = ref(0);
const testData = ref<any[]>([]);
const memoryTracking = ref(false);

// Initialize composables
const { track, trackAsync, logStats: perfLogStats } = usePerformanceTracker();
const { renderCount } = useRenderTracker('PerformanceTest');
const { startTracking, stopTracking, logMemoryStats, detectLeak } = useMemoryProfiler('PerformanceTest');

// Test 1: Performance Tracker
const testPerformanceTracker = async () => {
  console.log('🧪 Testing Performance Tracker...');

  // Test sync function
  track('sync-operation', () => {
    let sum = 0;
    for (let i = 0; i < 1000000; i++) {
      sum += i;
    }
    return sum;
  });

  // Test async function
  await trackAsync('async-operation', async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return 'done';
  });

  // Run multiple times to get stats
  for (let i = 0; i < 5; i++) {
    track('repeated-operation', () => {
      const arr = Array.from({ length: 10000 }, (_, i) => i);
      return arr.reduce((a, b) => a + b, 0);
    });
  }

  console.log('✅ Performance tracking complete! Run __perfTrackerTest() to see results');
};

// Test 2: Render Tracker (automatic via useRenderTracker)
const triggerReRender = () => {
  renderTrigger.value++;
  console.log(`🎨 Triggered re-render #${renderCount.value + 1}`);
};

// Test 3: Memory Profiler
const startMemoryTest = () => {
  memoryTracking.value = true;
  startTracking(2000); // Track every 2 seconds
  console.log('🧠 Memory tracking started');
};

const allocateMemory = () => {
  // Allocate some memory
  const newData = Array.from({ length: 10000 }, (_, i) => ({
    id: i,
    data: `Item ${i}`,
    timestamp: Date.now(),
    nested: { value: Math.random() }
  }));
  testData.value.push(...newData);
  console.log(`📦 Allocated memory: ${testData.value.length} items total`);
};

const stopMemoryTest = () => {
  memoryTracking.value = false;
  stopTracking();
  console.log('🧠 Memory tracking stopped');

  setTimeout(() => {
    const stats = logMemoryStats();
    if (stats) {
      console.log('💡 Tip: Run __memory_PerformanceTest.detectLeak() to check for leaks');
    }
  }, 500);
};

// Expose to console
if (import.meta.env.DEV) {
  (window as any).__perfTrackerTest = perfLogStats;
}

onBeforeUnmount(() => {
  if (memoryTracking.value) {
    stopTracking();
  }
});
</script>

<style scoped>
.performance-test-container {
  font-family: system-ui, -apple-system, sans-serif;
}

.test-section {
  margin: 20px 0;
  padding: 15px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fafafa;
}

.test-btn {
  padding: 8px 16px;
  margin: 5px 5px 5px 0;
  background: #1976d2;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.test-btn:hover:not(:disabled) {
  background: #1565c0;
}

.test-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

code {
  background: #e8e8e8;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
}

h3 {
  margin-top: 0;
  color: #333;
}

pre {
  overflow-x: auto;
  font-size: 12px;
}
</style>
