# q-menu Prop → OMenu Migration Table

Full mapping of every Quasar `q-menu` prop to its OMenu equivalent.

| q-menu prop | Type | OMenu equivalent | Action |
|-------------|------|------------------|--------|
| `v-model` | `boolean` | `v-model` | ✅ Keep as-is |
| `anchor` | `string` | `anchor` | ✅ Keep as-is (same value format) |
| `self` | `string` | `self` | ✅ Keep as-is (same value format) |
| `offset` | `[number, number]` | `offset` | ✅ Keep as-is |
| `content-style` | `string \| object` | `contentStyle` (camelCase) | ✅ Rename to camelCase |
| `no-route-dismiss` | `boolean` | — | ❌ Drop (OMenu has no router awareness) |
| `persistent` | `boolean` | `persistent` | ✅ Keep as-is (disables click-outside close) |
| `transition-show` | `string` | — | ❌ Drop (OMenu uses fixed fade transition) |
| `transition-hide` | `string` | — | ❌ Drop |
| `fit` | `boolean` | — | ❌ Drop — use `contentStyle="min-width: ...px"` if needed |
| `cover` | `boolean` | — | ❌ Drop — adjust `anchor`/`self` values instead |
| `square` | `boolean` | — | ❌ Drop — OMenu has baked-in radius |
| `max-height` | `string` | — | ❌ Drop — use `contentStyle="max-height: ...px; overflow-y: auto"` |
| `max-width` | `string` | — | ❌ Drop — use `contentStyle="max-width: ...px"` |
| `touch-position` | `boolean` | — | ❌ Drop (context menu positioning not supported) |
| `context-menu` | `boolean` | — | ❌ Drop (right-click context menu not supported in OMenu) |
| `scroll-target` | `element` | — | ❌ Drop — OMenu repositions on window scroll |
| `target` | `element \| string` | — | ❌ Refactor to Pattern 3 (wrap trigger in default slot) |
| `dark` | `boolean` | — | ❌ Drop — dark mode via design tokens automatically |
| `auto-close` | `boolean` | — | ❌ Drop — OMenu closes on outside click by default |

---

## @show / @hide events

OMenu now emits `show` and `hide`:

```vue
<!-- Before -->
<q-menu @show="loadData">...</q-menu>

<!-- After -->
<OMenu @show="loadData">...</OMenu>
```

---

## Nested submenu pattern

Use the `submenu` prop on the inner `OMenu`. It opens/closes on hover with an 80 ms debounce grace period so the pointer can move from trigger row into the panel.

```vue
<!-- Outer menu -->
<OMenu anchor="bottom right" self="top right" v-slot="{ toggle }">
  <OButton @click="toggle">User</OButton>
  <template #content>
    <q-list style="min-width: 250px">
      <!-- Submenu row — wires hover via slot props -->
      <OMenu submenu anchor="top end" self="top start" v-slot="{ onMouseenter, onMouseleave }">
        <q-item clickable @mouseenter="onMouseenter" @mouseleave="onMouseleave">
          <q-item-section>Language</q-item-section>
          <q-item-section side><q-icon name="keyboard_arrow_right" /></q-item-section>
        </q-item>
        <template #content>
          <q-list>
            <q-item v-for="lang in langList" :key="lang.code" clickable @click="changeLanguage(lang)">
              <q-item-section>{{ lang.label }}</q-item-section>
            </q-item>
          </q-list>
        </template>
      </OMenu>
    </q-list>
  </template>
</OMenu>
```

---

## contentStyle migration

The most common `content-style` usages and their OMenu equivalents:

| q-menu usage | OMenu |
|---|---|
| `content-style="z-index: 10001"` | Drop if `tw:z-[9999]` is enough; otherwise `:contentStyle="{ zIndex: 10001 }"` |
| `content-style="width: 300px"` | `:contentStyle="{ width: '300px' }"` |
| `content-style="min-width: 200px; max-height: 400px"` | `:contentStyle="{ minWidth: '200px', maxHeight: '400px', overflowY: 'auto' }"` |

---

## CSS selector cleanup

Quasar injects a `.q-menu` class onto the floating panel. When migrating, search the **same file's** `<style>` block for:

```css
.q-menu { ... }
.q-menu .q-item { ... }
.q-dark .q-menu { ... }
```

These must be removed — they no longer apply. If the styles were providing custom layout, move them into the `#content` slot's root element as Tailwind utilities or semantic token classes.
