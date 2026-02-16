<!--
  Span Color Preview Component
  Used to visualize all 50 span colors in both light and dark themes
-->
<template>
  <div class="span-color-preview">
    <div class="preview-header">
      <h2 class="preview-title">Trace Span Color Palette</h2>
      <p class="preview-subtitle">
        50 colors for service visualization • Auto-switches with theme
      </p>

      <!-- Theme indicator -->
      <div class="theme-badge">
        <q-icon :name="isDarkMode ? 'dark_mode' : 'light_mode'" size="16px" />
        <span>{{ isDarkMode ? 'Dark Mode' : 'Light Mode' }}</span>
      </div>
    </div>

    <!-- Color Grid -->
    <div class="color-grid">
      <div
        v-for="i in 50"
        :key="i"
        class="color-card"
        :style="{ '--color-index': i }"
      >
        <div class="color-swatch" :style="{ backgroundColor: getSpanColor(i) }">
          <span class="color-number">{{ i }}</span>
        </div>
        <div class="color-info">
          <span class="color-name">{{ colorNames[i - 1] }}</span>
          <code class="color-var">--o2-span-{{ i }}</code>
        </div>
      </div>
    </div>

    <!-- Service Color Map Example -->
    <div class="service-example">
      <h3 class="example-title">Service Color Mapping Example</h3>
      <div class="service-list">
        <div
          v-for="(service, index) in exampleServices"
          :key="service"
          class="service-item"
        >
          <div
            class="service-dot"
            :style="{ backgroundColor: getServiceColor(service) }"
          ></div>
          <span class="service-name">{{ service }}</span>
          <code class="service-color">{{ getServiceColor(service) }}</code>
        </div>
      </div>
    </div>

    <!-- Timeline Bar Preview -->
    <div class="timeline-preview">
      <h3 class="example-title">Timeline Bar Preview</h3>
      <div class="timeline-bars">
        <div
          v-for="i in 10"
          :key="i"
          class="timeline-bar-row"
        >
          <span class="bar-label">Service {{ i }}</span>
          <div class="bar-container">
            <div
              class="bar"
              :style="{
                backgroundColor: getSpanColor(i),
                width: `${Math.random() * 60 + 30}%`,
                marginLeft: `${Math.random() * 20}%`,
              }"
            ></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Usage Instructions -->
    <div class="usage-section">
      <h3 class="example-title">Usage in Components</h3>
      <pre class="code-block">{{ usageCode }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { getSpanColor, getServiceColor } from '@/utils/traces/traceColors';

const store = useStore();

const isDarkMode = computed(() => store.state.theme === 'dark');

// Color names for reference (matching the order in _variables.scss)
const colorNames = [
  'Royal Blue', 'Crimson Red', 'Emerald Green', 'Purple', 'Orange',
  'Cyan', 'Pink', 'Lime Green', 'Indigo', 'Amber',
  'Teal', 'Fuchsia', 'Green', 'Violet', 'Yellow-Orange',
  'Sky Blue', 'Rose', 'Lime', 'Slate Blue', 'Red',
  'Seafoam Green', 'Purple Light', 'Orange Red', 'Aqua', 'Hot Pink',
  'Success Green', 'Lavender', 'Gold', 'Azure', 'Cherry Red',
  'Turquoise', 'Magenta', 'Chartreuse', 'Periwinkle', 'Tangerine',
  'Light Blue', 'Bubblegum Pink', 'Bright Cyan', 'Lilac', 'Mint',
  'Coral', 'Soft Indigo', 'Mustard', 'Aquamarine', 'Light Pink',
  'Sky Cyan', 'Pale Violet', 'Pale Green', 'Cream Yellow', 'Peach',
];

// Example services for demonstration
const exampleServices = [
  'frontend-app',
  'api-gateway',
  'order-service',
  'inventory-service',
  'payment-service',
  'database',
  'cache-redis',
  'notification-service',
  'auth-service',
  'search-service',
];

const usageCode = `// Import the utility
import { getSpanColor, getServiceColor } from '@/utils/traces/traceColors';

// Get color by index (1-50)
const color = getSpanColor(5); // var(--o2-span-5)

// Get consistent color for service name
const serviceColor = getServiceColor('api-gateway'); // hashed to consistent color

// Use in style binding
<div :style="{ backgroundColor: getSpanColor(index) }">Span</div>

// Use in CSS
.span-bar {
  background-color: var(--o2-span-1);
}`;
</script>

<style scoped lang="scss">
.span-color-preview {
  padding: 2rem;
  max-width: 1400px;
  margin: 0 auto;
  background: var(--o2-primary-background);
  color: var(--o2-text-primary);
  min-height: 100vh;
}

.preview-header {
  margin-bottom: 2rem;
  text-align: center;
}

.preview-title {
  font-size: 2rem;
  font-weight: 700;
  margin: 0 0 0.5rem 0;
  color: var(--o2-text-primary);
}

.preview-subtitle {
  font-size: 1rem;
  color: var(--o2-text-secondary);
  margin: 0 0 1rem 0;
}

.theme-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: var(--o2-muted-background);
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--o2-text-primary);
}

.color-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 1rem;
  margin-bottom: 3rem;
}

.color-card {
  background: var(--o2-card-background);
  border: 1px solid var(--o2-border);
  border-radius: 8px;
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
}

.color-swatch {
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.color-number {
  font-size: 1.5rem;
  font-weight: 700;
  color: white;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.color-info {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.color-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--o2-text-primary);
}

.color-var {
  font-size: 0.75rem;
  font-family: 'Fira Code', monospace;
  color: var(--o2-text-secondary);
  background: var(--o2-muted-background);
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
}

/* Service Example */
.service-example {
  margin-bottom: 3rem;
  background: var(--o2-card-background);
  border: 1px solid var(--o2-border);
  border-radius: 8px;
  padding: 1.5rem;
}

.example-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 1rem 0;
  color: var(--o2-text-primary);
}

.service-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 0.75rem;
}

.service-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--o2-muted-background);
  border-radius: 6px;
  transition: background 0.2s;

  &:hover {
    background: var(--o2-hover-accent);
  }
}

.service-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.service-name {
  flex: 1;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--o2-text-primary);
}

.service-color {
  font-size: 0.75rem;
  font-family: 'Fira Code', monospace;
  color: var(--o2-text-secondary);
}

/* Timeline Preview */
.timeline-preview {
  margin-bottom: 3rem;
  background: var(--o2-card-background);
  border: 1px solid var(--o2-border);
  border-radius: 8px;
  padding: 1.5rem;
}

.timeline-bars {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.timeline-bar-row {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.bar-label {
  width: 100px;
  font-size: 0.875rem;
  color: var(--o2-text-secondary);
  flex-shrink: 0;
}

.bar-container {
  flex: 1;
  height: 8px;
  background: var(--o2-muted-background);
  border-radius: 4px;
  position: relative;
}

.bar {
  height: 100%;
  border-radius: 4px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

/* Usage Section */
.usage-section {
  background: var(--o2-card-background);
  border: 1px solid var(--o2-border);
  border-radius: 8px;
  padding: 1.5rem;
}

.code-block {
  background: var(--o2-muted-background);
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  padding: 1rem;
  font-size: 0.875rem;
  font-family: 'Fira Code', monospace;
  color: var(--o2-text-primary);
  overflow-x: auto;
  margin: 0;
  line-height: 1.6;
}
</style>
