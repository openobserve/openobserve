# Trace Colors Test Guide

## Quick Test - View Color Preview

### Method 1: Add to Traces Page (Easiest)

1. Open `/web/src/plugins/traces/Index.vue`
2. Add this import at the top of the `<script>` section:
   ```typescript
   import SpanColorPreview from '@/components/traces/SpanColorPreview.vue';
   ```

3. Add the component to `components` section:
   ```typescript
   components: {
     SpanColorPreview,
     // ... other components
   }
   ```

4. Add this button in the template (after search bar):
   ```vue
   <q-btn @click="showColorPreview = !showColorPreview" label="Show Colors" />
   <SpanColorPreview v-if="showColorPreview" />
   ```

5. Add state variable in setup:
   ```typescript
   const showColorPreview = ref(false);
   ```

6. Navigate to `/traces` and click "Show Colors" button

### Method 2: Standalone Route (Persistent)

Add this to `/web/src/composables/shared/router.ts` or `/web/src/composables/router.ts`:

```typescript
{
  path: "color-preview",
  name: "colorPreview",
  component: () => import("@/components/traces/SpanColorPreview.vue"),
  meta: {
    keepAlive: true,
    title: "Span Color Preview",
  },
},
```

Then navigate to: `http://localhost:8080/color-preview`

### Method 3: Browser Console Test

Open browser console and run:

```javascript
// Get a color
getComputedStyle(document.documentElement).getPropertyValue('--o2-span-1')

// Test all 50 colors
for(let i = 1; i <= 50; i++) {
  console.log(`Color ${i}:`, getComputedStyle(document.documentElement).getPropertyValue(`--o2-span-${i}`));
}
```

### Method 4: Direct Component Import

Create a test file `/web/src/views/ColorTest.vue`:

```vue
<template>
  <span-color-preview />
</template>

<script setup>
import SpanColorPreview from '@/components/traces/SpanColorPreview.vue';
</script>
```

Then import and render it wherever you want to test.

## Testing Both Themes

1. Open OpenObserve
2. View the color preview using any method above
3. Click the theme toggle (moon/sun icon in header)
4. Observe how colors change automatically

## What to Look For

✅ **Good:**
- Colors are distinct from each other
- Colors look good in both light and dark themes
- No two adjacent colors are too similar
- Dark mode colors are visible against dark backgrounds
- Light mode colors are visible against light backgrounds

❌ **Issues to Report:**
- Colors that look too similar
- Poor contrast in either theme
- Colors that are too bright/dark
- Any visual artifacts

## Color Usage Examples

### In Vue Component:
```vue
<template>
  <div :style="{ backgroundColor: getSpanColor(5) }">
    Span with color 5
  </div>
</template>

<script setup>
import { getSpanColor } from '@/utils/traces/traceColors';
</script>
```

### In CSS:
```scss
.my-span {
  background-color: var(--o2-span-1);
  border-left: 3px solid var(--o2-span-1);
}
```

### Programmatic Color Generation:
```typescript
import { getServiceColor, generateServiceColorMap } from '@/utils/traces/traceColors';

// Get consistent color for a service
const color = getServiceColor('api-gateway'); // Always same color for 'api-gateway'

// Generate color map for multiple services
const services = ['frontend', 'backend', 'database'];
const colorMap = generateServiceColorMap(services);
colorMap.get('frontend'); // var(--o2-span-X)
```

## Clean Up After Testing

Remove the test button/component from Index.vue when done testing.

## Next Steps

After verifying colors look good:
1. Proceed to Phase 2 (Component Creation)
2. Implement TraceDetailsV2 with actual timeline using these colors
3. Test with real trace data
