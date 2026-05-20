# Billing Page — Quasar Removal Audit

## Summary

Audit of the Billing/Subscription pages after the Quasar Framework removal in branch `feat/ux-revamp-main` vs `main`. Roughly 600 lines added / 632 removed across 21 files in `web/src/enterprise/components/billings/`, `web/src/views/*MarketplaceSetup.vue`, `web/src/views/MemberSubscription.vue`, and `web/src/components/PendingSubscriptionWarning.vue`.

Migration is mostly successful — Quasar imports (`useQuasar`, `q-page`, `q-card`, `q-icon`, `q-chip`, `q-linear-progress`, `q-separator`, `q-spinner-dots`, `q-table`, `q-splitter`, `q-select`, `q-btn`) have been replaced with O* equivalents (OCard, OBadge, OProgressBar, OIcon, OSpinner, OSeparator, OTable, OSplitter, OSelect, OButton) and Quasar utility classes flipped to Tailwind `tw:` prefix. Toast notifications were migrated from `$q.notify({type: 'negative'})` to `toast({variant: 'error'})`.

However, a number of regressions and stale leftovers remain. Most critical:

1. `enterprisePlan.vue` Contact Sales button has its `block` prop mistyped as `tw:block` attribute, so the button no longer spans full-width.
2. `proPlan.vue` AWS/Azure marketplace badges use `icon="check_circle"` (underscore) instead of the registered name `check-circle` — icon does not render.
3. Marketplace setup pages use `tw-px-3 tw-pt-2` (dash prefix) instead of `tw:px-3 tw:pt-2` — Tailwind classes silently dropped.
4. `plans.vue` has a stray `>` character bleeding through after the warning icon (rendered as visible text).
5. `Billing.vue` puts a `<template v-slot:prepend>` schedule icon into OSelect, but OSelect has no `prepend` slot — icon never appears in the usage date dropdown.
6. `OIcon name=""` (empty string) is passed in `proPlan.vue` and `enterprisePlan.vue` — invalid IconName, will throw a registry lookup warning and render nothing.
7. Multiple test specs still reference `q-table`, `q-card`, `q-btn`, `q-splitter`, `q-select` stubs and old data-driven APIs that no longer exist on the migrated components, e.g. `wrapper.vm.resultTotal`, `wrapper.vm.perPageOptions`, `wrapper.vm.changePagination`.

## Files Audited

Source files (Vue/TS):
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/enterprise/components/billings/Billing.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/enterprise/components/billings/plans.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/enterprise/components/billings/proPlan.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/enterprise/components/billings/enterprisePlan.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/enterprise/components/billings/invoiceTable.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/enterprise/components/billings/invoiceHistory.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/enterprise/components/billings/usage.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/enterprise/components/billings/TrialPeriod.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/enterprise/components/billings/LicensePeriod.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/enterprise/components/billings/UsageReportBanner.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/MemberSubscription.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/AwsMarketplaceSetup.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/AzureMarketplaceSetup.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/PendingSubscriptionWarning.vue`

Test specs:
- `Billing.spec.ts`, `plans.spec.ts`, `proPlan.spec.ts`, `enterprisePlan.spec.ts`, `invoiceTable.spec.ts`, `invoiceHistory.spec.ts`, `usage.spec.ts`, `LicensePeriod.spec.ts`, `TrialPeriod.spec.ts`, `AwsMarketplaceSetup.spec.ts`, `AzureMarketplaceSetup.spec.ts`, `MemberSubscription.spec.ts`, `PendingSubscriptionWarning.spec.ts`.

Cross-checks: `web/src/lib/core/Badge/OBadge.types.ts`, `OProgressBar.types.ts`, `OIcon.types.ts`/`OIcon.icons.ts`, `OSpinner.types.ts`, `OTable.types.ts`, `OSelect.vue`, `OButton.types.ts`, `useToast.ts`.

## Critical Issues

### 1. `enterprisePlan.vue` line 80 — `block` prop mistyped as `tw:block` attribute
```vue
<OButton variant="primary" size="sm-action" tw:block @click="contactSales">
```
The original (`main`) had `block` as a boolean prop on its own line. In the refactor it was glued onto one line and rewritten as `tw:block`. Vue parses `tw:block` as a literal HTML attribute (XML-style namespaced name), so the OButton receives no `block` prop. The "Contact Sales" button on the enterprise plan card is no longer full-width.
Path: `web/src/enterprise/components/billings/enterprisePlan.vue:80`

**Solution:**
```diff
- <OButton variant="primary" size="sm-action" tw:block @click="contactSales">
+ <OButton variant="primary" size="sm-action" block @click="contactSales">
```

### 2. `proPlan.vue` lines 94 and 109 — invalid OBadge icon name
```vue
<OBadge variant="success-soft" icon="check_circle" class="tw:px-3 tw:py-2">
```
The OIcon registry uses kebab-case keys (`check-circle`), so `icon="check_circle"` (underscore) does not resolve. The check-circle icon next to the "Managed via AWS/Azure Marketplace" badge will not render.
Path: `web/src/enterprise/components/billings/proPlan.vue:94`, `:109`

**Solution:**
```diff
- <OBadge variant="success-soft" icon="check_circle" class="tw:px-3 tw:py-2">
+ <OBadge variant="success-soft" class="tw:px-3 tw:py-2">
+   <OIcon name="check-circle" size="xs" class="tw:mr-1" />
+   <slot />
+ </OBadge>
```
(OBadge.icon renders a Material font glyph; for an OIcon SVG, place it in the badge's default slot.)

### 3. AWS / Azure Marketplace setup — broken `tw-` (dash) prefix
```vue
<div class="tw:flex relative-position tw-px-3 tw-pt-2">
```
The project's Tailwind setup uses the `tw:` (colon) prefix. `tw-px-3` / `tw-pt-2` will not be picked up by the JIT — these classes have no effect, and `relative-position` is a leftover Quasar utility class.
Paths: `web/src/views/AwsMarketplaceSetup.vue:19`, `web/src/views/AzureMarketplaceSetup.vue:19`

**Solution:**
```diff
- <div class="tw:flex relative-position tw-px-3 tw-pt-2">
+ <div class="tw:flex tw:relative tw:px-3 tw:pt-2">
```

### 4. `plans.vue` line 71 — stray `>` rendered as visible text
```vue
<OIcon name="warning" size="sm" class="tw:pt-2" />
>{{ store.state.selectedOrganization.note }}
```
This is a leftover from converting `</q-icon>` (the original was an opening-tag form `<q-icon ... />`); the literal `>` is now a text node visible in the DOM directly before the organization note. Whenever an org has a `note` (e.g. paused subscription), the page shows `>Your note here` with a stray angle bracket.
Path: `web/src/enterprise/components/billings/plans.vue:71`

**Solution:**
```diff
  <OIcon name="warning" size="sm" class="tw:pt-2" />
- >{{ store.state.selectedOrganization.note }}
+ {{ store.state.selectedOrganization.note }}
```

### 5. `Billing.vue` — `prepend` slot on OSelect does not exist
```vue
<OSelect v-model="usageDate" :options="options" ...>
  <template v-slot:prepend>
    <OIcon name="schedule" size="xs" class="tw:mr-2 tw:mt-1" @click.stop.prevent />
  </template>
</OSelect>
```
OSelect (`web/src/lib/forms/Select/OSelect.vue`) only exposes `default`, `icon-left`, `tooltip`, and `trigger` slots — no `prepend`. The schedule clock icon in the Usage date selector silently disappears. Should be migrated to the `icon-left` slot.
Path: `web/src/enterprise/components/billings/Billing.vue:34-36`

**Solution:**
```diff
  <OSelect v-model="usageDate" :options="options" ...>
-   <template v-slot:prepend>
-     <OIcon name="schedule" size="xs" class="tw:mr-2 tw:mt-1" @click.stop.prevent />
-   </template>
+   <template #icon-left>
+     <OIcon name="schedule" size="xs" />
+   </template>
  </OSelect>
```

### 6. `proPlan.vue` line 65 and `enterprisePlan.vue` line 66 — `<OIcon name="" />`
```vue
<OIcon v-else name="" color="green" size="sm" class="tw:mr-2" />
```
`OIcon.name` is typed `IconName` (literal union of registry keys). Passing `""` fails type-check and at runtime emits a registry-miss warning; nothing renders. The `color="green"` prop is also obsolete — `OIcon.types.ts` has no `color` prop. (Pre-existing bug from main, but worth fixing as part of this migration.)
Paths: `web/src/enterprise/components/billings/proPlan.vue:65`, `web/src/enterprise/components/billings/enterprisePlan.vue:66`

**Solution:**
```diff
- <OIcon v-else name="" color="green" size="sm" class="tw:mr-2" />
+ <span v-else class="tw:mr-2 tw:text-[var(--o2-positive)]">
+   <OIcon name="check-circle" size="sm" />
+ </span>
```

### 7. Quasar dark-mode selectors no longer activate
```scss
.body--dark { .gradient-banner { ... } }
```
The application no longer applies `body--dark` (it was a Quasar global class). All three banner components rely on this for dark-mode styling, so dark mode trial-/license-/usage-report banners revert to light-mode gradients.
Paths: `web/src/enterprise/components/billings/TrialPeriod.vue:156`, `web/src/enterprise/components/billings/LicensePeriod.vue:91`, `web/src/enterprise/components/billings/UsageReportBanner.vue:110`

**Solution:**
```diff
- .body--dark {
-   .gradient-banner { background: linear-gradient(...); }
- }
+ :global(html.dark) {
+   .gradient-banner { background: linear-gradient(...); }
+ }
```

## Logical Issues

### 8. `invoiceTable.vue` line 144 — typo `invoice.statue`
```ts
status: invoice.statue,
```
Pre-existing typo in `main` carried over verbatim. Backend response field is `status`, not `statue`; invoice status column is always undefined. Worth fixing while we're here.
Path: `web/src/enterprise/components/billings/invoiceTable.vue:144`

**Solution:**
```diff
- status: invoice.statue,
+ status: invoice.status,
```

### 9. `Billing.vue` line 168 — unguarded `customer_id.length`
```ts
isPaidUser.value = res.data?.customer_id.length > 0;
```
Optional chaining stops after `data`. If `customer_id` is `undefined`/`null` (e.g. before Stripe customer creation) `.length` throws TypeError, the `catch` zeroes out `billingProvider`, and the invoice tab/cycle option silently disappear. Pre-existing in `main`, but exposed because `fetchBillingInfo` now runs in `onMounted` before tab visibility logic. Should be `res.data?.customer_id?.length > 0`.
Path: `web/src/enterprise/components/billings/Billing.vue:168`

**Solution:**
```diff
- isPaidUser.value = res.data?.customer_id.length > 0;
+ isPaidUser.value = (res.data?.customer_id?.length ?? 0) > 0;
```

### 10. `MemberSubscription.vue` line 91 — unused `dismiss` from toast
```ts
const dismiss = toast({ variant: "success", message: res.data.message });
```
The `dismiss` return value is assigned but never invoked, and the toast has no `timeout` set (success defaults to a non-zero timeout, so it auto-dismisses — not a bug). Cosmetic / lint-level.
Path: `web/src/views/MemberSubscription.vue:91`

### 11. `MemberSubscription.vue` lines 100-102 — duplicate redirect branches
```ts
if (res.data.hasOwnProperty("data")) {
  ...
  window.location.href = redirectURI + "?org_identifier=" + invited_org_id;
} else {
  window.location.href = redirectURI + "?org_identifier=" + invited_org_id;
}
```
Both branches do the same redirect — pre-existing in `main`, but a candidate for cleanup while touching the file.
Path: `web/src/views/MemberSubscription.vue:96-103`

**Solution:**
```diff
- if (res.data.hasOwnProperty("data")) {
-   window.location.href = redirectURI + "?org_identifier=" + invited_org_id;
- } else {
-   window.location.href = redirectURI + "?org_identifier=" + invited_org_id;
- }
+ window.location.href = `${redirectURI}?org_identifier=${invited_org_id}`;
```

### 12. `AzureMarketplaceSetup.vue` does not start polling for activation
Unlike `AwsMarketplaceSetup.vue` (which polls `getActivationStatus` for up to 5 minutes), `AzureMarketplaceSetup.vue` immediately transitions to `success` after `linkSubscription` resolves (line 291). There is no `startPolling` function. Either:
- this is intentional (Azure activates synchronously), in which case the unused `activatedOrgId` ref and the `pending_activation` / `payment_failed` states should be removed; or
- the polling implementation is missing and Azure sign-ups are marked succeeded before they finish.
Path: `web/src/views/AzureMarketplaceSetup.vue:282-309`

### 13. `Billing.vue` line 218 — TDZ risk on `usageDate.value`
```ts
onMounted(async () => {
  await fetchBillingInfo();
  if (... && isPaidUser.value) {
    usageDate.value = "1cycle";
    selectUsageDate();
  }
  ...
});
const usageDate = ref(router.currentRoute.value.query.usage_date || "30days");
```
The `usageDate` ref is declared *after* `onMounted`. Async callback execution makes this work in practice (setup() finishes before the `onMounted` callback runs), but it's confusing and brittle — if anyone refactors `onMounted` to a synchronous variant they will hit a TDZ ReferenceError. Reorder declarations.
Path: `web/src/enterprise/components/billings/Billing.vue:208-238`

**Solution:**
```diff
- onMounted(async () => { /* uses usageDate.value */ });
- const usageDate = ref(router.currentRoute.value.query.usage_date || "30days");
+ const usageDate = ref(router.currentRoute.value.query.usage_date || "30days");
+ onMounted(async () => { /* uses usageDate.value */ });
```

## CSS / Layout Issues

### 14. Leftover Quasar utility classes in active templates
Class names that no longer correspond to any CSS rule in the new theme:
- `Billing.vue:21` and `usage.vue:20` and `invoiceHistory.vue:19`: `q-table__title`
- `plans.vue:30,31`: `column` (Quasar flexbox utility) in active markup
- `plans.vue:57`: `text-info`
- `usage.vue:29,239` and elsewhere: `text-weight-medium`
- `usage.vue` rows 40,42,59,61,...: `column` repeated ~12 times in tile content
- `TrialPeriod.vue:29,38`: `float-right` (functions but is a legacy utility)
- `AwsMarketplaceSetup.vue:19` and `AzureMarketplaceSetup.vue:19`: `relative-position`

These should be replaced with `tw:flex-col`, `tw:text-blue-…`, `tw:font-medium`, etc. The visible regression is loss of intended flex direction for plan/usage tiles (no fallback to `tw:flex-col`).

**Solution:**
```diff
- <div class="q-table__title">
- <div class="column">
- <span class="text-info">
- <span class="text-weight-medium">
- <button class="float-right">
- <div class="relative-position">
+ <div class="tw:text-lg tw:font-semibold tw:leading-6">
+ <div class="tw:flex tw:flex-col">
+ <span class="tw:text-blue-500">
+ <span class="tw:font-medium">
+ <button class="tw:float-right">
+ <div class="tw:relative">
```

### 15. Quasar CSS variable in scoped styles
```scss
.aws-marketplace-setup { background: var(--q-background); }
.azure-marketplace-setup { background: var(--q-background); }
```
`--q-background` was Quasar-provided. The new theme defines no equivalent — both marketplace setup pages render with `background: initial` (transparent), inheriting body color.
Paths: `web/src/views/AwsMarketplaceSetup.vue:423`, `web/src/views/AzureMarketplaceSetup.vue:349`

**Solution:**
```diff
- .aws-marketplace-setup { background: var(--q-background); }
- .azure-marketplace-setup { background: var(--q-background); }
+ .aws-marketplace-setup { background: var(--o2-bg-primary); }
+ .azure-marketplace-setup { background: var(--o2-bg-primary); }
```

### 16. `Billing.vue` scoped `:deep()` still targeting Quasar internals
```scss
:deep(.q-field--auto-height.q-field--dense .q-field__control) { ... }
:deep(.q-field--auto-height.q-field--dense .q-field__native) { ... }
```
The old `::v-deep` was converted to `:deep()` but the selectors still target `q-field--*` classes that OSelect does not emit. These rules are effectively dead CSS — and the intent (custom 40 px height for the usage-cycle selector) is no longer applied. The schedule-icon slot loss (Issue #5) means the dropdown also lacks the prepend icon padding it was sized for.
Path: `web/src/enterprise/components/billings/Billing.vue:304-317`

**Solution:**
```diff
- :deep(.q-field--auto-height.q-field--dense .q-field__control) { height: 40px; }
- :deep(.q-field--auto-height.q-field--dense .q-field__native) { padding-left: 12px; }
+ :deep(.o-select__trigger) { height: 40px; padding-left: 12px; }
```

### 17. `TrialPeriod.vue` narrow button column
```vue
<div class="tw:w-1/6 tw:mt-2" v-if="currentPage != 'billing'">
  <OButton variant="primary" size="sm" class="float-right" @click="redirectBilling">
```
Wrapping an OButton in a 1/6-width column with `float-right` will yield a button that is at best cramped on smaller viewports and at worst overflows the gradient banner. Worth verifying visually.
Path: `web/src/enterprise/components/billings/TrialPeriod.vue:25-42`

**Solution:**
```diff
- <div class="tw:w-1/6 tw:mt-2" v-if="currentPage != 'billing'">
-   <OButton variant="primary" size="sm" class="float-right" @click="redirectBilling">
+ <div class="tw:mt-2 tw:flex tw:justify-end" v-if="currentPage != 'billing'">
+   <OButton variant="primary" size="sm" @click="redirectBilling">
```

### 18. `enterprisePlan.vue` and `proPlan.vue` — `OBadge` `border-radius: 0`
```vue
<OBadge variant="primary-soft" class="tw:mt-2 tw:text-xs tw:px-2 tw:py-3" style="border-radius: 0px">
```
OBadge size docs say "shape is always pill (rounded-full)" — the inline `border-radius: 0` style forces a sharp-cornered badge that contradicts the design system. Either remove the inline style or use a custom CSS class. Visible on the Subscribed / Discount-tag chips in both plan cards.
Paths: `proPlan.vue:30`, `enterprisePlan.vue:31`

**Solution:**
```diff
- <OBadge variant="primary-soft" class="tw:mt-2 tw:text-xs tw:px-2 tw:py-3" style="border-radius: 0px">
+ <OBadge variant="primary-soft" class="tw:mt-2 tw:text-xs tw:px-2 tw:py-3">
```

## Component Migration Issues

### 19. `invoiceTable.vue` — switched to `<script setup>` with no exposed methods
The original component had a sizable `setup()` returning `qTable`, `columns`, `resultTotal`, `perPageOptions`, `pagination`, `getInvoiceHistory`, `changePagination`, `changeMaxRecordToReturn`. The new file is `<script setup>`, exposes nothing on `wrapper.vm`, and dropped the `QTablePagination` slot entirely. Pagination is now driven by OTable's built-in `pagination="client"`. This is functionally fine in production but breaks every existing test that asserts `wrapper.vm.<x>` (see Test File Issues below).
Path: `web/src/enterprise/components/billings/invoiceTable.vue`

**Solution:**
```diff
- <script setup lang="ts">
- // internal-only refs
+ <script setup lang="ts">
+ // Expose helpers needed by tests
+ defineExpose({ columns, getInvoiceHistory });
```

### 20. `PendingSubscriptionWarning.vue` — leftover Quasar `text-red` class
```vue
<span class="text-red">Warning:</span>
```
`text-red` was a Quasar class. Should be `tw:text-red-500` or similar. The original (in `main`) also used it, but in main it was rendered alongside a `q-icon color="warning"` — converting that icon to `OIcon name="warning"` without a color leaves the warning visually washed-out.
Path: `web/src/components/PendingSubscriptionWarning.vue:23`

**Solution:**
```diff
- <OIcon name="warning" />
- <span class="text-red">Warning:</span>
+ <span class="tw:text-[var(--o2-warning)]"><OIcon name="warning" /></span>
+ <span class="tw:text-red-500">Warning:</span>
```

### 21. `Billing.vue` `OSplitter` orientation changed
Original: `<q-splitter v-model="splitterModel" unit="px" class="logs-splitter-smooth">` — Quasar's q-splitter defaults to `horizontal=false` meaning vertical splitter (side-by-side panes). New: `<OSplitter ... :horizontal="false">` — OSplitter exposes `before/after` slots which behave the same. Behavior preserved; the obsolete `logs-splitter-smooth` class was dropped (no animated smoothing now).
Path: `web/src/enterprise/components/billings/Billing.vue:47-118`

**Solution:** No code change needed — behavior preserved with `:horizontal="false"`. The `logs-splitter-smooth` class can stay dropped.

### 22. OBadge variant `success-soft` icon prop spelling — design system mismatch
OBadge accepts an `icon` prop typed as `IconName` (kebab-case from registry). proPlan.vue passes `icon="check_circle"`, OBadge will pass that to `<OIcon name="check_circle"/>` and fail the IconName union. (Same as Critical Issue #2 — flagged again here because it is also a strict TS type violation, not just a runtime miss.)

**Solution:** Same as Critical Issue #2:
```diff
- <OBadge icon="check_circle" />
+ <OBadge> <OIcon name="check-circle" /> <slot/> </OBadge>
```

### 23. `OSpinner` `variant="dots"` only used in AWS, not Azure
`AwsMarketplaceSetup.vue:127` uses `<OSpinner variant="dots" size="xl" />` for the "Processing" state; the equivalent Azure file uses no spinner at all in `processing` state (it transitions immediately to `success`). See Logical Issue #12 for the activation-polling consequence.

**Solution:**
```diff
+ <div v-if="state === 'processing'" class="tw:flex tw:flex-col tw:items-center">
+   <OSpinner variant="dots" size="xl" />
+   <p>Linking your Azure subscription...</p>
+ </div>
```
(Add to Azure setup once polling is implemented per Issue #12.)

## Test File Issues

### 24. `Billing.spec.ts` — extensive `q-splitter` / `q-select` global stubs (active assertions)
```ts
global: {
  stubs: {
    'q-splitter': { template: '<div>...</div>' },
    'q-select': true,
    ...
  }
}
```
References at lines 45 (`vi.mock("quasar")`), 90-96, 195-201, 237-243, 306-312, 520-526, 554-560, 588-594. After migration these stubs no longer match any rendered component — `q-splitter`/`q-select` stubs are silently ignored, and the tests pass on the wrong elements (they may still pass on shape but verify nothing meaningful).
Path: `web/src/enterprise/components/billings/Billing.spec.ts`

**Solution:**
```diff
- vi.mock("quasar");
- stubs: { "q-splitter": { template: "<div>...</div>" }, "q-select": true, ... }
+ // Drop quasar mock; stub O* components or use shallow-mount
+ stubs: { OSplitter: true, OSelect: true, OButton: true, OTable: true }
```

### 25. `invoiceTable.spec.ts` — totally stale assertions
```ts
expect(wrapper.vm.resultTotal).toBe(0);
expect(wrapper.vm.perPageOptions).toHaveLength(5);
expect(typeof wrapper.vm.changePagination).toBe('function');
expect(templateHTML).toContain('q-table');
const idColumn = wrapper.vm.columns.find((col: any) => col.name === "id");
expect(idColumn).toEqual({ name: "id", field: "id", label: "#", align: "left", sortable: true });
```
None of these exist on the new `<script setup>`-style component (which uses OTable column shape `{id, accessorKey, header, sortable, meta:{align}}`). Affected lines include 152, 156, 160, 173, 186, 197, 208, 222-249, 402-429.
Path: `web/src/enterprise/components/billings/invoiceTable.spec.ts`

**Solution:**
```diff
- expect(wrapper.vm.resultTotal).toBe(0);
- expect(wrapper.vm.perPageOptions).toHaveLength(5);
- expect(typeof wrapper.vm.changePagination).toBe("function");
- const idColumn = wrapper.vm.columns.find(c => c.name === "id");
- expect(idColumn).toEqual({ name: "id", field: "id", label: "#", align: "left", sortable: true });
+ // Test via DOM/component, not internal state. <script setup> exposes nothing.
+ const idColumn = wrapper.findComponent(OTable).props("columns").find(c => c.id === "id");
+ expect(idColumn).toMatchObject({ id: "id", accessorKey: "id", header: "#", sortable: true, meta: { align: "left" } });
```

### 26. `proPlan.spec.ts` and `enterprisePlan.spec.ts` — `q-card: true` stubs
Both still stub `q-card: true` (`proPlan.spec.ts:59`, `enterprisePlan.spec.ts:62`). After migration the component renders `<OCard>`, so the stub is a dead key; the real OCard is rendered. May cause snapshot drift or assertion mismatches that depended on a flat `<q-card-stub>` element.

**Solution:**
```diff
- stubs: { "q-card": true }
+ stubs: { OCard: true }
```

### 27. `PendingSubscriptionWarning.spec.ts:64` — stubs `q-btn: true`
```ts
stubs: { 'q-btn': true }
```
Component now renders OButton; stub is dead.

**Solution:**
```diff
- stubs: { "q-btn": true }
+ stubs: { OButton: true }
```

### 28. `MemberSubscription.spec.ts:93-95` — stubs `q-btn`
```ts
'q-btn': { template: '<button class="q-btn"><slot /></button>' }
```
Component now renders no Quasar buttons (and the relevant OButton is inside a commented-out block), but the stub remains.

**Solution:**
```diff
- "q-btn": { template: '<button class="q-btn"><slot /></button>' }
+ // Remove dead stub entirely
```

## Recommendations

In order of impact:

1. **Fix the broken `block` prop** in `enterprisePlan.vue:80` — change `tw:block` back to `block`. Compile failure-equivalent for layout.
2. **Fix `tw-` → `tw:` typos** in `AwsMarketplaceSetup.vue:19` and `AzureMarketplaceSetup.vue:19`. Also drop the legacy `relative-position` class.
3. **Fix icon name** in `proPlan.vue:94, :109` — change `icon="check_circle"` to `icon="check-circle"`.
4. **Remove the stray `>`** in `plans.vue:71`.
5. **Migrate the schedule icon** in `Billing.vue:34-36` from `prepend` slot to OSelect's `icon-left` slot (or `trigger` slot), and drop the dead `:deep(.q-field--*)` CSS at lines 304-317.
6. **Replace `<OIcon name="" />`** in proPlan/enterprisePlan with either omitting the element when `feature.is_parent` is false, or using a neutral icon like `circle`. Also drop the obsolete `color="green"` prop (OIcon has no `color`).
7. **Add Azure activation polling** in `AzureMarketplaceSetup.vue` (or remove the unused `pending_activation` / `payment_failed` states and the unused `activatedOrgId` ref).
8. **Guard `customer_id`** in `Billing.vue:168` with optional chaining: `res.data?.customer_id?.length`.
9. **Fix the `invoice.statue` typo** in `invoiceTable.vue:144`.
10. **Replace `body--dark` SCSS** in `TrialPeriod.vue`, `LicensePeriod.vue`, `UsageReportBanner.vue` with the project's current dark-mode mechanism (Tailwind `dark:`/`tw:dark:` variant or class-based equivalent).
11. **Replace `var(--q-background)`** in the marketplace setup pages with a current theme token (or simply drop the rule — body bg already shows through).
12. **Sweep legacy classes** from active markup: `column`, `text-info`, `text-weight-medium`, `text-red`, `float-right`, `q-table__title`. Replace with Tailwind equivalents.
13. **Update test specs** — at minimum remove the now-meaningless `q-table`, `q-card`, `q-btn`, `q-splitter`, `q-select` stubs; rewrite the `invoiceTable.spec.ts` assertions against the OTable column shape (`id`/`accessorKey`/`header`/`meta.align`) and drop the `resultTotal`/`perPageOptions`/`changePagination` checks.
14. **Reorder declarations** in `Billing.vue:208-238` so `usageDate` is defined before `onMounted`.
15. **Remove or fix the inline `border-radius: 0`** on the badges in `proPlan.vue:30` and `enterprisePlan.vue:31` to match design-system rounded shape.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
| --- | --- | --- | --- |
| `MemberSubscription.vue:42` | `q-btn-primary` | `tw:bg-[var(--o2-primary)] tw:text-white` (or `<OButton variant="primary">`) | File |
| `Billing.vue:21` | `q-table__title` | `tw:text-base tw:font-semibold` | File |
| `invoiceHistory.vue:19` | `q-table__title` | `tw:text-base tw:font-semibold` | File |
| `usage.vue:20` | `q-table__title` | `tw:text-base tw:font-semibold` | File |
| `usage.vue:29` | `text-weight-medium` | `tw:font-medium` | File |
| `usage.vue:38,99` | `wrap` | `tw:flex-wrap` | File |
| `usage.vue:40,42,59,61,78,80,...` | `column` (~24 occurrences) | `tw:flex tw:flex-col` | File |
| `usage.vue:239` | `text-weight-medium` | `tw:font-medium` | File |
| `proPlan.vue:208` | `.full-width` (scoped style block) | `tw:w-full` (or delete if unused) | File |
| `enterprisePlan.vue:117` | `.full-width` (scoped style block) | `tw:w-full` (or delete if unused) | File |
| `TrialPeriod.vue:29,38` | `float-right` | `tw:float-right` | File |
| `plans.vue:30,31` | `column` | `tw:flex tw:flex-col` | File |
| `PendingSubscriptionWarning.vue:23` | `text-red` | `tw:text-red-500` | File |
| `plans.vue:57` | `text-info` | `tw:text-[var(--o2-info)]` (or tailwind `tw:text-blue-500`) | File |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
| --- | --- | --- | --- |
| `AwsMarketplaceSetup.vue:19` | `tw-px-3 tw-pt-2` | `tw:px-3 tw:pt-2` | File |
| `AzureMarketplaceSetup.vue:19` | `tw-px-3 tw-pt-2` | `tw:px-3 tw:pt-2` | File |
| `AwsMarketplaceSetup.vue:19` | `relative-position` | `tw:relative` | File |
| `AzureMarketplaceSetup.vue:19` | `relative-position` | `tw:relative` | File |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
| --- | --- | --- | --- |
| `AwsMarketplaceSetup.vue:423` | `var(--q-background)` | `var(--o2-bg-primary)` | File |
| `AzureMarketplaceSetup.vue:349` | `var(--q-background)` | `var(--o2-bg-primary)` | File |

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
| --- | --- | --- | --- |
| `Billing.vue:305` | `::v-deep(.q-field--auto-height.q-field--dense .q-field__control)` | Remove — `OSelect` does not emit `.q-field*` | File |
| `Billing.vue:313` | `::v-deep(.q-field--auto-height.q-field--dense .q-field__native)` | Remove — same as above | File |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
| --- | --- | --- | --- |
| `plans.vue:388` | `$primary` | `var(--o2-primary)` | File |

### 6. Quasar Directives
| File:Line | Directive | Action |
| --- | --- | --- |
| *(none found)* | | |

### 7. Icon Migration
| File:Line | Issue | Fix |
| --- | --- | --- |
| `proPlan.vue` (various) | `OIcon name=""` (empty string) — invalid IconName | Replace with valid hyphen name |
| `enterprisePlan.vue` (various) | `OIcon name=""` (empty string) | Replace with valid hyphen name |
| `proPlan.vue` (AWS/Azure badge) | `icon="check_circle"` underscore on plan badge | `icon="check-circle"` |

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
| --- | --- | --- |
| `PendingSubscriptionWarning.vue:20` | `width: 80px; height: 80px` (OIcon) | Use OIcon `:size="80"` prop or scoped `.warning-icon` |
| `AzureMarketplaceSetup.vue:34,49,61,135,150` | `width: 80px; height: 80px` / `60px` (OIcon ×5) | Use OIcon `:size` prop |
| `AwsMarketplaceSetup.vue:34,49,61,145,160` | `width: 80px; height: 80px` / `60px` (OIcon ×5) | Use OIcon `:size` prop |
| `proPlan.vue:30` / `enterprisePlan.vue:31` | `border-radius: 0px` | Remove — conflicts with design-system rounded badge |
| `invoiceHistory.vue:18` / `Billing.vue:19` | `min-height: inherit` | Move to scoped `.billing-root` rule |
| `Billing.vue:54,113` | `min-height/height: calc(100vh - var(--navbar-height) - 87px)` | Move to scoped `.card-container` (it already exists) |
| `plans.vue:18` | `min-height: inherit; overflow: auto` | Move to scoped `.plans-root` rule |
| `plans.vue:34,41,54,57` | `opacity: 0.8`, `font-size: 13px`, `width: fit-content` | Replace with `tw:opacity-80`, `tw:text-[13px]`, `tw:w-fit` |
| `usage.vue:18` | `height: calc(100vh - 130px); width: 100%` | Move to `.usage-root` scoped + `tw:w-full` |
| `usage.vue:46..220` (×9) | `opacity: 0.8` on tile icon wrappers | Replace with `tw:opacity-80` |
| `MemberSubscription.vue:20,27` | `text-align: center; ...` | Replace with `tw:text-center` + scoped typography |

### 9. Duplicate Style Blocks
| Files | Duplicated block | Suggested partial |
| --- | --- | --- |
| `proPlan.vue:208` + `enterprisePlan.vue:117` | `.full-width { width: 100% }` | Delete in both — use `tw:w-full` inline |
| `usage.vue` + `plans.vue` | Tile/card structure (`.tile-content`, `column tw:justify-between`, gradient backgrounds) | Extract to shared `_billing-tile.scss` partial |
| `AwsMarketplaceSetup.vue` + `AzureMarketplaceSetup.vue` | Marketplace banner layout (states: link/error/loading/success/failure) | Extract to `web/src/styles/_marketplace-setup.scss` |
| `Billing.vue:305-313` + nothing | Single-file scoped `::v-deep` (no other site) | Delete |

### 10. Layer Summary
- Global (`app.scss` / `_variables.scss`) changes needed: **0** (define usage only in scoped layers)
- Component-level partial changes: **2** (extract `_billing-tile.scss` for usage/plans tiles; extract `_marketplace-setup.scss` for AWS/Azure setup banners)
- File-level scoped changes: **14** (Tailwind dash → colon in AWS/Azure setups; `column`/`wrap`/`float-right`/`q-table__title`/`q-btn-primary` migrations; delete `::v-deep(.q-field*)` in Billing; replace `$primary` SCSS var in plans; fix `OIcon` empty `name=""` and `_` underscore badges; replace inline `style=` with `tw:` utilities)
