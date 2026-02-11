# OpenObserve Design System

> Principle-based design for consistent, professional interfaces

**Last Updated:** 2026-02-10
**Design Direction:** Precision

---

## Design Principles

### Direction: Precision

**Core Values:**
- Consistency across all components
- Accessibility first
- Performance optimized
- Theme-aware (light/dark)
- Internationalization ready

---

## Design Tokens

### Spacing Scale
```scss
$spacing-xs: 0.25rem;   // 4px
$spacing-sm: 0.5rem;    // 8px
$spacing-md: 0.75rem;   // 12px
$spacing-base: 1rem;    // 16px
$spacing-lg: 1.25rem;   // 20px
$spacing-xl: 1.5rem;    // 24px
$spacing-2xl: 2rem;     // 32px
$spacing-3xl: 3rem;     // 48px
```

### Typography Scale
```scss
$text-xs: 0.625rem;   // 10px
$text-sm: 0.75rem;    // 12px
$text-base: 0.875rem; // 14px
$text-md: 1rem;       // 16px
$text-lg: 1.125rem;   // 18px
$text-xl: 1.25rem;    // 20px
$text-2xl: 1.5rem;    // 24px
$text-3xl: 2rem;      // 32px
```

### Color Variables
```scss
// Theme-aware CSS variables
var(--o2-text-primary)
var(--o2-text-secondary)
var(--o2-card-bg)
var(--o2-border-color)
var(--o2-accent-primary)
var(--o2-accent-secondary)
var(--o2-success)
var(--o2-error)
var(--o2-warning)
var(--o2-info)
```

---

## Component Patterns

### Button
**Primary Action:**
```vue
<q-btn
  data-test="action-button"
  size="sm"
  unelevated
  color="primary"
  :label="t('action.label')"
  padding="0.75rem"
/>
```

### Card
**Default Container:**
```vue
<q-card
  data-test="feature-card"
  flat
  bordered
  class="card-default"
>
  <q-card-section class="q-pa-md">
    <!-- Content -->
  </q-card-section>
</q-card>
```

### Form Input
**Text Input:**
```vue
<q-input
  data-test="input-field"
  v-model="value"
  :label="t('form.label')"
  dense
  outlined
/>
```

### Dialog
**Modal Dialog:**
```vue
<q-dialog
  v-model="showDialog"
  data-test="feature-dialog"
>
  <q-card style="min-width: 400px">
    <q-card-section>
      <div class="text-h6">{{ t('dialog.title') }}</div>
    </q-card-section>
    <q-card-section>
      <!-- Content -->
    </q-card-section>
    <q-card-actions align="right">
      <q-btn flat :label="t('common.cancel')" data-test="cancel-button" />
      <q-btn unelevated color="primary" :label="t('common.save')" data-test="save-button" />
    </q-card-actions>
  </q-card>
</q-dialog>
```

---

## Validation Rules

### MUST Follow
✅ All spacing uses rem/em (not px, except 1px/2px borders)
✅ All colors use CSS variables
✅ No inline styles (use classes)
✅ All interactive elements have data-test attributes
✅ All text uses i18n (t() function)
✅ Typography follows scale
✅ Components emit errors to parents

### MUST NOT Do
❌ Hardcode hex colors (#333, #fff, etc.)
❌ Use px for spacing/typography
❌ Use inline styles for static values
❌ Skip data-test attributes
❌ Hardcode English text
❌ Use .unwrap() or ignore errors

---

## Feature Registry

<!-- Features will be added here as they're implemented -->
