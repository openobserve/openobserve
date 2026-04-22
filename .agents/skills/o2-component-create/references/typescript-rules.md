# TypeScript Rules — Vue 3 O2 Components

---

## Forbidden Patterns

| Pattern | Fix |
|---------|-----|
| `any` | Use proper type or `unknown` with narrowing |
| Implicit `any` | Type every parameter, variable, return value |
| `as any` | Use type guards or discriminated unions |
| `Function` type | Use `() => void` or `(value: T) => void` |
| `Object` / `{}` type | Use specific interface |
| Inline props types in `.vue` | Move ALL types to `ComponentName.types.ts` |
| `defineProps({ prop: String })` | Use `defineProps<ComponentNameProps>()` |
| Optional props that are always required | Remove `?` |
| Broad string instead of union | `'sm' \| 'md' \| 'lg'` not `string` |
| Duplicate type definitions | Define once, import everywhere |

---

## Required Patterns

### Props Definition

```ts
// Button.types.ts
export interface ButtonProps {
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit' | 'reset'
}
```

```vue
<!-- Button.vue -->
<script setup lang="ts">
import type { ButtonProps } from './Button.types'
const props = withDefaults(defineProps<ButtonProps>(), {
  size: 'md',
  disabled: false,
  loading: false,
  type: 'button',
})
</script>
```

### Emits Definition

```ts
// Button.types.ts
export interface ButtonEmits {
  (e: 'click', event: MouseEvent): void
  (e: 'focus', event: FocusEvent): void
}
```

```vue
<script setup lang="ts">
import type { ButtonEmits } from './Button.types'
const emit = defineEmits<ButtonEmits>()
</script>
```

### Slots with Types (when needed)

```ts
// ComponentName.types.ts
export interface ComponentNameSlots {
  default?: () => unknown
  prefix?: () => unknown
  suffix?: () => unknown
}
```

```vue
<script setup lang="ts">
defineSlots<ComponentNameSlots>()
</script>
```

### Computed with Explicit Return Type

```ts
// When the return type is non-obvious
const classes = computed<string[]>(() => [...])
const config = computed<InputConfig>(() => ({...}))
```

### Event Handler Typing

```ts
// ✅ Typed event handlers
function handleInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  // ...
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') { /* ... */ }
}
```

### Composable Return Types

```ts
// useDropdown.ts
export interface UseDropdownReturn {
  isOpen: Ref<boolean>
  open: () => void
  close: () => void
  toggle: () => void
}

export function useDropdown(): UseDropdownReturn {
  // ...
}
```

### Template Refs

```ts
// Typed template ref
const inputRef = ref<HTMLInputElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
```

---

## Import Rules

```ts
// ✅ Use `type` imports for type-only imports
import type { ButtonProps, ButtonEmits } from './Button.types'
import type { Ref, ComputedRef } from 'vue'

// ✅ Value imports for composables, utilities
import { computed, ref, watch } from 'vue'
import { cn } from '@/utils/cn'
```

---

## Discriminated Unions (Preferred for Variants)

```ts
// ✅ Discriminated union for component states
export type AlertVariant = 'info' | 'success' | 'warning' | 'error'

export interface AlertProps {
  variant: AlertVariant  // required — no default that hides design intent
  title: string
  description?: string
  dismissible?: boolean
}
```

---

## Generics in Components

```ts
// SelectProps with generic value type
export interface SelectProps<T = string> {
  modelValue: T | null
  options: SelectOption<T>[]
  multiple?: boolean
}

export interface SelectOption<T = string> {
  label: string
  value: T
  disabled?: boolean
}
```

---

## tsconfig — Recommended Additions

The project currently lacks strict mode. O2 components should be authored to full strict standards even before `strict: true` is enforced globally. Add to `tsconfig.app.json` when ready:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```
