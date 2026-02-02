# OpenObserve Frontend UI Guidelines

**Version:** 1.0
**Last Updated:** 2025-10-07
**Tech Stack:** Vue.js 3, Quasar Framework, Tailwind CSS, ECharts, TanStack Table, Monaco Editor

---

## Table of Contents

1. [Design System & Color Palette](#design-system--color-palette)
2. [Typography & Fonts](#typography--fonts)
3. [Component Architecture](#component-architecture)
4. [Styling Guidelines](#styling-guidelines)
5. [Quasar Framework Usage](#quasar-framework-usage)
6. [Tailwind CSS Integration](#tailwind-css-integration)
7. [Spacing & Layout](#spacing--layout)
8. [Dark Mode & Theming](#dark-mode--theming)
9. [Interactive Elements](#interactive-elements)
10. [Performance & Best Practices](#performance--best-practices)
11. [Accessibility](#accessibility)
12. [Third-Party Libraries](#third-party-libraries)
13. [Code Quality & Testing](#code-quality--testing)

---

## Design System & Color Palette

### Color System

OpenObserve uses a comprehensive color system defined in `src/styles/_variables.scss` with support for both light and dark modes.

#### Primary Colors

**Light Mode:**
- **Gray Scale:** `$o2-gray-100` (white) to `$o2-gray-1400` (darkest)
- **Iris (Primary):** `$o2-iris-100` to `$o2-iris-1200`
  - Primary brand color: `$o2-iris-1100` (#575FC5)
- **Blue:** `$o2-blue-100` to `$o2-blue-1100`
- **Green:** `$o2-green-100` to `$o2-green-1100`
- **Yellow:** `$o2-yellow-100` to `$o2-yellow-1000`
- **Red:** `$o2-red-100` to `$o2-red-1100`
- **Orange:** `$o2-orange-100` to `$o2-orange-900`
- **Purple:** `$o2-purple-100` to `$o2-purple-900`
- **Teal:** `$o2-teal-100` to `$o2-teal-900`

**Dark Mode:**
- Each color has a dark mode equivalent (e.g., `$o2-dark-gray-100`, `$o2-dark-iris-100`)
- Colors are carefully selected to maintain contrast and readability

#### Semantic Color Variables

Use CSS custom properties for semantic colors instead of hardcoded values:

```scss
// Light Mode
--o2-primary-background: White background
--o2-secondary-background: Light iris background
--o2-text-primary: Main text color
--o2-text-secondary: Less prominent text
--o2-border: Standard borders
--o2-primary-color: Primary actions/buttons

// Dark Mode (automatically switches with .body--dark class)
```

**Usage Example:**
```vue
<style scoped>
.my-card {
  background: var(--o2-card-background);
  color: var(--o2-card-text);
  border: 1px solid var(--o2-border);
}
</style>
```

### Color Usage Rules

1. **Always use semantic variables** over direct color values
2. **Primary actions** should use `--o2-primary-color`
3. **Destructive actions** (delete, remove) should use red variants
4. **Success states** should use green variants
5. **Warning states** should use yellow/orange variants
6. **Info states** should use blue variants

---

## Typography & Fonts

### Font Family

**Primary Font:** Nunito Sans (loaded from local assets)

```scss
font-family: 'Nunito Sans', sans-serif;
```

### Font Weights

- **Regular:** 400
- **Semi-bold:** 600
- **Bold:** 700

### Typography Scale

Use Quasar's typography utilities or define custom sizes:

```scss
// Headings
h1: 2rem (32px)
h2: 1.5rem (24px)
h3: 1.25rem (20px)
h4: 1.125rem (18px)
h5: 1rem (16px)
h6: 0.875rem (14px)

// Body
body: 0.875rem (14px)
small: 0.75rem (12px)
```

### Typography Best Practices

1. **Line height:** Use 1.5 for body text, 1.2-1.3 for headings
2. **Letter spacing:** Keep default for most text
3. **Text colors:** Use semantic color variables (`--o2-text-primary`, `--o2-text-secondary`)
4. **Truncation:** Use ellipsis for long text in tables/lists

```vue
<style scoped>
.truncate-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
```

---

## Component Architecture

### Vue 3 Composition API

**✅ DO:**
```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

const count = ref(0);
const doubled = computed(() => count.value * 2);

onMounted(() => {
  // Initialization
});
</script>
```

**❌ DON'T:**
```vue
<!-- Avoid Options API for new components -->
<script>
export default {
  data() {
    return { count: 0 }
  }
}
</script>
```

### Component Structure

```vue
<template>
  <!-- Template with semantic HTML -->
  <div class="component-name">
    <!-- Component content -->
  </div>
</template>

<script setup lang="ts">
// 1. Imports (Vue, external libraries, components)
import { ref } from 'vue';

// 2. Props definition
interface Props {
  title: string;
  isActive?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  isActive: false
});

// 3. Emits definition
const emit = defineEmits<{
  update: [value: string];
  close: [];
}>();

// 4. Reactive state
const localState = ref('');

// 5. Computed properties
const computedValue = computed(() => {
  // Logic
});

// 6. Methods
const handleAction = () => {
  emit('update', localState.value);
};

// 7. Lifecycle hooks
onMounted(() => {
  // Initialization
});
</script>

<style lang="scss" scoped>
// Component-specific styles
.component-name {
  // Styles
}
</style>
```

### Component Naming

1. **Multi-word names:** All component names must be multi-word (PascalCase)
   - ✅ `UserProfile.vue`, `DataTable.vue`
   - ❌ `User.vue`, `Table.vue`

2. **File naming:** Use PascalCase for component files
   - ✅ `StreamDataTable.vue`
   - ❌ `stream-data-table.vue`

3. **Template refs:** Use descriptive names with `Ref` suffix
   ```vue
   const searchTableRef = ref(null);
   ```

---

## Styling Guidelines

### NO Inline Styles

**❌ NEVER use inline styles:**
```vue
<!-- BAD -->
<div style="color: red; margin: 10px;">Content</div>
<q-tr style="cursor: pointer">Content</q-tr>
```

**✅ ALWAYS use classes or scoped styles:**
```vue
<!-- GOOD -->
<div class="error-text tw:m-2.5">Content</div>
<q-tr class="tw:cursor-pointer">Content</q-tr>

<style scoped>
.error-text {
  color: var(--o2-text-error);
}
</style>
```

### Style Scoping

1. **Use `scoped` attribute** for component-specific styles
2. **Global styles** go in `src/styles/` directory
3. **Component styles** should be at the bottom of the component file

```vue
<style lang="scss" scoped>
// Component-specific styles
.my-component {
  padding: 1rem;
}
</style>
```

### Style Organization

```scss
// 1. Variables (if needed locally)
$local-spacing: 1rem;

// 2. Component base styles
.component-root {
  display: flex;
}

// 3. Child elements (use BEM-like naming)
.component-root__header {
  font-weight: 600;
}

// 4. Modifiers
.component-root--active {
  background: var(--o2-hover-accent);
}

// 5. State-based styles
.component-root:hover {
  opacity: 0.9;
}

// 6. Responsive styles
@media (max-width: 768px) {
  .component-root {
    flex-direction: column;
  }
}
```

---

## Quasar Framework Usage

### Component Imports

Import Quasar components as needed:

```vue
<script setup lang="ts">
import { QBtn, QInput, QCard } from 'quasar';
</script>
```

### Common Quasar Components

#### Buttons (QBtn)

```vue
<!-- Primary action -->
<q-btn
  color="primary"
  label="Submit"
  @click="handleSubmit"
  data-test="submit-button"
/>

<!-- Secondary action -->
<q-btn
  flat
  color="primary"
  label="Cancel"
  @click="handleCancel"
/>

<!-- Icon button -->
<q-btn
  flat
  round
  icon="close"
  @click="handleClose"
/>
```

#### Inputs (QInput)

```vue
<q-input
  v-model="searchQuery"
  outlined
  dense
  placeholder="Search..."
  data-test="search-input"
>
  <template v-slot:prepend>
    <q-icon name="search" />
  </template>
</q-input>
```

#### Tables (QTable / QVirtualScroll)

For large datasets, use `q-virtual-scroll` for performance:

```vue
<q-virtual-scroll
  :items="rows"
  :virtual-scroll-item-size="25"
  @virtual-scroll="onScroll"
>
  <template v-slot="{ item, index }">
    <q-tr :key="index">
      <!-- Row content -->
    </q-tr>
  </template>
</q-virtual-scroll>
```

### Quasar Utility Classes

Use Quasar's flex utilities:

```vue
<!-- Flexbox -->
<div class="flex row items-center justify-between">
  <!-- Content -->
</div>

<!-- Spacing -->
<div class="q-pa-md q-mb-sm">
  <!-- Content -->
</div>

<!-- Text -->
<div class="text-h6 text-weight-bold">Title</div>
```

### Custom Width Classes

```scss
.q-w-sm { width: 360px; }
.q-w-md { width: 400px; }
.q-w-lg { width: 600px; }
.q-w-xl { width: 800px; }
```

---

## Tailwind CSS Integration

### Tailwind Prefix

**All Tailwind classes use the `tw:` prefix:**

```vue
<div class="tw:flex tw:items-center tw:justify-between tw:p-4">
  <span class="tw:text-lg tw:font-semibold">Title</span>
</div>
```

### Configuration

Tailwind is configured in `tailwind.config.js`:

```js
{
  prefix: "tw:",
  content: ["./index.html", "./src/**/*.{vue,js,ts}"],
  theme: {
    extend: {
      colors: {
        primary: "rgb(var(--q-primary) / <alpha-value>)",
        secondary: "rgb(var(--q-secondary) / <alpha-value>)"
      }
    }
  }
}
```

### When to Use Tailwind vs Quasar

**Use Tailwind for:**
- Custom spacing: `tw:mt-4`, `tw:px-6`
- Custom layouts: `tw:grid`, `tw:flex`
- Typography utilities: `tw:text-sm`, `tw:font-bold`
- Custom colors when needed

**Use Quasar for:**
- Component-specific props: `dense`, `outlined`, `flat`
- Quasar's flex system when simpler
- Component colors: `color="primary"`

### Common Tailwind Utilities

```vue
<!-- Spacing -->
tw:m-{size}    // margin
tw:p-{size}    // padding
tw:gap-{size}  // gap in flex/grid

<!-- Layout -->
tw:flex, tw:grid, tw:block, tw:inline-block
tw:items-center, tw:justify-between
tw:w-full, tw:h-screen

<!-- Typography -->
tw:text-{size}, tw:font-{weight}
tw:leading-{size}, tw:tracking-{size}

<!-- Colors -->
tw:bg-{color}, tw:text-{color}
tw:border-{color}

<!-- Borders & Rounded -->
tw:border, tw:border-{side}-{width}
tw:rounded, tw:rounded-{size}

<!-- Effects -->
tw:shadow, tw:shadow-{size}
tw:opacity-{value}
```

---

## Spacing & Layout

### Spacing Scale

Use consistent spacing values:

```scss
// Tailwind spacing (multiply by 4 for px)
tw:p-1   // 4px
tw:p-2   // 8px
tw:p-3   // 12px
tw:p-4   // 16px
tw:p-6   // 24px
tw:p-8   // 32px
```

### Layout Patterns

#### Flex Layouts

```vue
<!-- Horizontal layout with centered items -->
<div class="tw:flex tw:items-center tw:gap-4">
  <span>Item 1</span>
  <span>Item 2</span>
</div>

<!-- Vertical layout -->
<div class="tw:flex tw:flex-col tw:gap-2">
  <div>Item 1</div>
  <div>Item 2</div>
</div>

<!-- Space between -->
<div class="tw:flex tw:justify-between tw:items-center">
  <span>Left</span>
  <span>Right</span>
</div>
```

#### Grid Layouts

```vue
<div class="tw:grid tw:grid-cols-3 tw:gap-4">
  <div>Column 1</div>
  <div>Column 2</div>
  <div>Column 3</div>
</div>
```

### Container Sizing

```vue
<!-- Full width -->
<div class="tw:w-full">Content</div>

<!-- Max width with centering -->
<div class="tw:max-w-4xl tw:mx-auto">Content</div>

<!-- Fixed width -->
<div class="q-w-lg">Content (600px)</div>
```

---

## Dark Mode & Theming

### Dark Mode Detection

Quasar automatically applies `.body--dark` class to the body element in dark mode.

### Theme-Aware Styles

**✅ Use semantic CSS variables:**
```vue
<style scoped>
.my-component {
  background: var(--o2-card-background);
  color: var(--o2-card-text);
  border: 1px solid var(--o2-border);
}
</style>
```

**❌ Don't hardcode colors:**
```vue
<!-- BAD -->
<style scoped>
.my-component {
  background: #fff;
  color: #000;
}
</style>
```

### Theme-Specific Overrides

If needed, use `.body--dark` selector:

```scss
.my-component {
  background: var(--o2-card-background);

  .body--dark & {
    // Dark mode specific overrides (if semantic variables aren't enough)
    box-shadow: 0 2px 8px rgba(255, 255, 255, 0.1);
  }
}
```

---

## Interactive Elements

### Buttons

#### Button Hierarchy

1. **Primary actions:** Filled buttons with primary color
2. **Secondary actions:** Outlined or flat buttons
3. **Tertiary actions:** Text/flat buttons without borders
4. **Destructive actions:** Red color for delete/remove operations

```vue
<!-- Primary -->
<q-btn color="primary" label="Create" />

<!-- Secondary -->
<q-btn outline color="primary" label="Edit" />

<!-- Tertiary -->
<q-btn flat color="primary" label="Cancel" />

<!-- Destructive -->
<q-btn color="negative" label="Delete" />
```

#### Button States

- **Disabled:** Use `:disable` prop
- **Loading:** Use `:loading` prop
- **Icon + Label:** Use `icon` prop with `label`

```vue
<q-btn
  color="primary"
  label="Save"
  icon="save"
  :loading="isSaving"
  :disable="!isValid"
/>
```

### Forms & Inputs

#### Input Fields

```vue
<q-input
  v-model="formData.name"
  outlined
  dense
  label="Name"
  :rules="[val => !!val || 'Name is required']"
  data-test="name-input"
/>
```

#### Select Dropdowns

```vue
<q-select
  v-model="selectedOption"
  :options="options"
  outlined
  dense
  label="Select Option"
  emit-value
  map-options
/>
```

### Hover & Focus States

Always provide visual feedback:

```scss
.interactive-element {
  transition: all 0.2s ease;
  cursor: pointer;

  &:hover {
    background: var(--o2-hover-accent);
  }

  &:focus {
    outline: 2px solid var(--o2-focus-ring);
    outline-offset: 2px;
  }
}
```

### Cursor Styles

```vue
<!-- Clickable elements -->
<div class="tw:cursor-pointer">Clickable</div>

<!-- Disabled elements -->
<div class="tw:cursor-not-allowed tw:opacity-50">Disabled</div>

<!-- Draggable elements -->
<div class="tw:cursor-grab">Draggable</div>
```

---

## Performance & Best Practices

### Virtual Scrolling

For lists with 100+ items, use virtual scrolling:

```vue
<q-virtual-scroll
  :items="largeDataset"
  :virtual-scroll-item-size="25"
  :virtual-scroll-slice-size="150"
  :virtual-scroll-slice-ratio-before="10"
>
  <template v-slot="{ item, index }">
    <!-- Item template -->
  </template>
</q-virtual-scroll>
```

### Lazy Loading

Use lazy loading for routes and heavy components:

```ts
// router/index.ts
{
  path: '/dashboard',
  component: () => import('@/views/Dashboard.vue')
}
```

### Computed Properties

Use computed for derived state instead of methods in templates:

```vue
<script setup lang="ts">
// ✅ Good
const filteredItems = computed(() =>
  items.value.filter(item => item.active)
);

// ❌ Bad (in template)
// {{ items.filter(item => item.active) }}
</script>
```

### v-if vs v-show

- **v-if:** Use for conditionally rendered content (not rendered in DOM)
- **v-show:** Use for toggling visibility (rendered but hidden with CSS)

```vue
<!-- Expensive to render, infrequently changed -->
<div v-if="showModal">Modal content</div>

<!-- Frequently toggled -->
<div v-show="isVisible">Toggle content</div>
```

### Watchers

Prefer computed properties over watchers when possible:

```vue
<script setup lang="ts">
// ✅ Good - Computed
const fullName = computed(() =>
  `${firstName.value} ${lastName.value}`
);

// ❌ Bad - Unnecessary watcher
watch([firstName, lastName], () => {
  fullName.value = `${firstName.value} ${lastName.value}`;
});
</script>
```

---

## Accessibility

### Semantic HTML

Use proper HTML elements:

```vue
<!-- ✅ Good -->
<button @click="handleClick">Click me</button>
<nav><a href="/page">Link</a></nav>

<!-- ❌ Bad -->
<div @click="handleClick">Click me</div>
<div><span @click="navigate">Link</span></div>
```

### ARIA Attributes

Add ARIA labels for screen readers:

```vue
<q-btn
  icon="close"
  flat
  round
  aria-label="Close dialog"
  @click="closeDialog"
/>

<div role="dialog" aria-labelledby="dialog-title">
  <h2 id="dialog-title">Dialog Title</h2>
</div>
```

### Keyboard Navigation

Ensure all interactive elements are keyboard accessible:

```vue
<div
  tabindex="0"
  role="button"
  @click="handleClick"
  @keyup.enter="handleClick"
  @keyup.space="handleClick"
>
  Custom button
</div>
```

### Focus Management

Manage focus for modals and dynamic content:

```vue
<script setup lang="ts">
const dialogRef = ref(null);

const openDialog = () => {
  showDialog.value = true;
  nextTick(() => {
    dialogRef.value?.$el.focus();
  });
};
</script>
```

### Color Contrast

Ensure sufficient contrast ratios:
- **Normal text:** 4.5:1 minimum
- **Large text:** 3:1 minimum
- Use our semantic color variables which are designed with proper contrast

---

## Third-Party Libraries

### ECharts

For data visualization:

```vue
<script setup lang="ts">
import * as echarts from 'echarts';
import { onMounted, ref } from 'vue';

const chartRef = ref<HTMLElement | null>(null);
let chartInstance: echarts.ECharts | null = null;

onMounted(() => {
  if (chartRef.value) {
    chartInstance = echarts.init(chartRef.value);
    chartInstance.setOption({
      // Chart options
    });
  }
});

onBeforeUnmount(() => {
  chartInstance?.dispose();
});
</script>

<template>
  <div ref="chartRef" class="tw:w-full tw:h-96"></div>
</template>
```

### TanStack Table

For complex data tables:

```vue
<script setup lang="ts">
import {
  useVueTable,
  FlexRender,
  getCoreRowModel,
  getSortedRowModel
} from '@tanstack/vue-table';

const table = useVueTable({
  columns,
  data,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel()
});
</script>
```

### Monaco Editor

For code editing:

```vue
<script setup lang="ts">
import * as monaco from 'monaco-editor';

onMounted(() => {
  const editor = monaco.editor.create(editorRef.value, {
    value: code.value,
    language: 'javascript',
    theme: isDark.value ? 'vs-dark' : 'vs'
  });
});
</script>
```

---

## Code Quality & Testing

### Testing Attributes

Add `data-test` attributes for E2E testing:

```vue
<q-btn
  data-test="submit-button"
  @click="submit"
>
  Submit
</q-btn>

<q-input
  data-test="email-input"
  v-model="email"
/>
```

### Component Testing

```ts
// Component.spec.ts
import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import MyComponent from './MyComponent.vue';

describe('MyComponent', () => {
  it('renders properly', () => {
    const wrapper = mount(MyComponent, {
      props: { title: 'Test' }
    });
    expect(wrapper.text()).toContain('Test');
  });
});
```

### TypeScript

Use TypeScript for type safety:

```vue
<script setup lang="ts">
interface User {
  id: number;
  name: string;
  email: string;
}

interface Props {
  user: User;
  isActive?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isActive: false
});
</script>
```

### Linting

Follow ESLint rules configured in the project:

```bash
npm run lint
```

---

## Quick Reference Checklist

Before submitting your code, ensure:

- [ ] No inline styles used
- [ ] All Tailwind classes use `tw:` prefix
- [ ] Semantic color variables used instead of hardcoded colors
- [ ] Component uses Composition API with `<script setup>`
- [ ] TypeScript types defined for props and emits
- [ ] Dark mode support via semantic variables
- [ ] `data-test` attributes added for testable elements
- [ ] Accessibility attributes (ARIA labels) included
- [ ] Virtual scrolling used for large lists (100+ items)
- [ ] Proper scoped styles with `<style scoped>`
- [ ] Component name is multi-word (PascalCase)
- [ ] Proper responsive design (mobile, tablet, desktop)
- [ ] Loading and error states handled
- [ ] No console.logs or debugging code left behind

---

## Additional Resources

- **Quasar Documentation:** https://quasar.dev
- **Tailwind CSS Documentation:** https://tailwindcss.com
- **Vue 3 Documentation:** https://vuejs.org
- **ECharts Documentation:** https://echarts.apache.org
- **TanStack Table Documentation:** https://tanstack.com/table

---

## Contact & Support

For questions or clarifications on these guidelines, please reach out to the frontend team or create an issue in the repository.

**Remember:** These guidelines exist to maintain consistency, quality, and performance across the OpenObserve frontend. When in doubt, refer to existing components in the codebase that follow these patterns.
