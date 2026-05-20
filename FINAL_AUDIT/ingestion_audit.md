# Ingestion Page — Quasar Removal Audit

## Summary

The Ingestion page (`web/src/views/Ingestion.vue` + `web/src/components/ingestion/**`) has been largely migrated from Quasar to the in-house `O*` component library + Tailwind v4 (`tw:` prefix). 161 ingestion-related files changed in this refactor, with the overall structure intact: `OTabs`, `ORouteTab`, `OButton`, `OInput`, `OIcon`, `OSplitter`, `OCheckbox`, `OToggleGroup`, `OSeparator`, `OTooltip`, `OCard`, `ODialog`, `OSelect`, `OCollapsible`, `OTabPanels`, `OTabPanel`. `copyToClipboard` was replaced by `@/utils/clipboard` and `q.notify` by `toast()` from `@/lib/feedback/Toast/useToast`.

However, several real defects remain. The most consequential are concentrated in `web/src/views/Ingestion.vue`, `web/src/components/ingestion/recommended/KubernetesConfig.vue`, `web/src/components/ingestion/recommended/AzureConfig.vue`, and across spec files (89 spec files still reference `quasar` / `useQuasar` / `installQuasar`).

The runtime page chrome should render and work for end-users, but: (a) one Tailwind arbitrary value with spaces is silently dropped, (b) a typo collapses two props on a tab bar, (c) one class uses Quasar token sizing inside a `tw:` prefix, (d) one class uses old Tailwind v3 variant syntax, (e) a handful of links use the legacy `text-primary` (Quasar class), and (f) ~89 spec files almost certainly fail to compile because the source migrated away from `quasar.copyToClipboard` / `useQuasar` / `q.notify`.

---

## Files Audited

### Top-level view
- `web/src/views/Ingestion.vue`

### Category index components
- `web/src/components/ingestion/Recommended.vue`
- `web/src/components/ingestion/Custom.vue`
- `web/src/components/ingestion/Server.vue`
- `web/src/components/ingestion/Database.vue`
- `web/src/components/ingestion/Security.vue`
- `web/src/components/ingestion/DevOps.vue`
- `web/src/components/ingestion/Networking.vue`
- `web/src/components/ingestion/MessageQueues.vue`
- `web/src/components/ingestion/Languages.vue`
- `web/src/components/ingestion/Others.vue`
- `web/src/components/ingestion/AIIntegrations.vue`

### Sub-category index components
- `web/src/components/ingestion/logs/Index.vue`
- `web/src/components/ingestion/metrics/Index.vue`
- `web/src/components/ingestion/traces/Index.vue`
- `web/src/components/ingestion/rum/Index.vue`

### Source/config components (spot-checked)
- `web/src/components/ingestion/logs/{Curl,Vector,Fluentd,FluentBit,FileBeat,Vector,LogstashDatasource,SyslogNg,OtelConfig}.vue`
- `web/src/components/ingestion/metrics/{PrometheusConfig,OtelCollector,TelegrafConfig,CloudWatchMetrics}.vue`
- `web/src/components/ingestion/traces/OpenTelemetry.vue`
- `web/src/components/ingestion/recommended/{KubernetesConfig,LinuxConfig,WindowsConfig,OtelConfig,GCPConfig,AzureConfig,AzureQuickSetup,AWSConfig,AWSQuickSetup,AWSIntegrationGrid,AWSIntegrationTile,AzureIntegrationTile,AzureIndividualServices,AWSIndividualServices,FrontendRumConfig}.vue`
- `web/src/components/ingestion/devops/GithubActions.vue`
- `web/src/components/ingestion/databases/Databricks.vue` (sample)
- `web/src/components/CopyContent.vue`

### Spec files (counted, sampled)
- 89 ingestion spec files reference `quasar` / `useQuasar` / `installQuasar` (see Test File Issues).

---

## Critical Issues

### 1. Broken Tailwind arbitrary value (spaces inside `[...]`) — `Ingestion.vue:210`

```html
<div class="tw:max-h-[calc(100vh - var(--navbar-height) - 100px)]">
```

Tailwind v4 arbitrary values may NOT contain unescaped spaces — Tailwind silently fails to emit a rule and the constraint is dropped at runtime. Every other place in the codebase uses underscores or removes the spaces, e.g.:
- `web/src/components/ingestion/AIIntegrations.vue:18` → `tw:h-[calc(100vh-var(--navbar-height)-100px)]`
- `web/src/components/ingestion/Custom.vue:22` → `tw:h-[calc(100vh-140px)]`

The result on the Ingestion shell is that `router-view`'s outer wrapper has no `max-height`, so any inner content that does not impose its own height bound can break the page scroll layout.

**Fix:** `tw:max-h-[calc(100vh-var(--navbar-height)-100px)]` (drop the spaces) **or** `tw:max-h-[calc(100vh_-_var(--navbar-height)_-_100px)]` (use Tailwind's underscore syntax).

**Solution:**
```diff
- <div class="tw:max-h-[calc(100vh - var(--navbar-height) - 100px)]">
+ <div class="tw:max-h-[calc(100vh-var(--navbar-height)-100px)]">
```

### 2. Typo collapses two props into one malformed attribute — `KubernetesConfig.vue:97`

```html
<OTabs v-model="tab" horizontalalign="left">
```

This was meant to be two props (`horizontal align="left"`), but the missing space concatenates them into `horizontalalign`. Vue passes this through as a string DOM attribute on `OTabs`, so neither the `horizontal` flag nor the `align="left"` reach the component. Render is wrong (tabs may stack vertically and/or be center-aligned instead of left).

**Fix:** `<OTabs v-model="tab" horizontal align="left">`

**Solution:**
```diff
- <OTabs v-model="tab" horizontalalign="left">
+ <OTabs v-model="tab" horizontal align="left">
```

### 3. Quasar utility leaking into a Tailwind prefix — `KubernetesConfig.vue:76`

```html
<div class="tw:text-base tw:font-medium tw:pl-1 q:mt-md">
```

`q:mt-md` is not a real utility. It looks like a botched migration of Quasar's `q-mt-md` (margin-top medium) into the new `tw:` namespace. Tailwind ignores it; no top margin is applied. The "Install OpenTelemetry operator" heading sits flush against the previous block instead of having the intended spacing.

**Fix:** `tw:mt-3` (or whichever spacing token matches the design).

**Solution:**
```diff
- <div class="tw:text-base tw:font-medium tw:pl-1 q:mt-md">
+ <div class="tw:text-base tw:font-medium tw:pl-1 tw:mt-4">
```

### 4. Invalid `pb-lg` token under `tw:` prefix — `KubernetesConfig.vue:3`

```html
<div class="tw:p-3 kubernetes-config-section tw:pb-lg">
```

`tw:pb-lg` is also a Quasar-token-shaped value (`pb-lg` = padding-bottom-large in Quasar). Tailwind v4 has no `lg` spacing token by default — the project does not appear to extend it. This silently drops, leaving the Kubernetes section without the intended bottom padding.

**Fix:** `tw:pb-8` or similar.

**Solution:**
```diff
- <div class="tw:p-3 kubernetes-config-section tw:pb-lg">
+ <div class="tw:p-3 kubernetes-config-section tw:pb-8">
```

### 5. Wrong Tailwind variant order (`hover:tw:` → must be `tw:hover:`) — `KubernetesConfig.vue:185, 191`

```html
<a href="..." class="hover:tw:underline text-primary">HOT commerce</a>
<a href="..." class="hover:tw:underline text-primary">OpenTelemetry operator</a>
```

Tailwind v4 with the `tw:` prefix requires the variant to come AFTER the prefix: `tw:hover:underline`, not `hover:tw:underline`. The hover underline never applies. Additionally, `text-primary` is the leftover Quasar text-color class — there is no Tailwind utility by that name without explicit theming.

The same anti-pattern exists in `web/src/components/ingestion/recommended/AWSIntegrationTile.vue:90,109` (`hover:tw:bg-muted/50`) — broken hover effects on the AWS individual-service rows.

**Fix:** Replace with `tw:hover:underline tw:text-primary` (or whichever palette token is the intended link color).

**Solution:**
```diff
- <a class="hover:tw:underline text-primary">HOT commerce</a>
+ <a class="tw:hover:underline tw:text-[var(--o2-primary)]">HOT commerce</a>
- class="hover:tw:bg-muted/50"
+ class="tw:hover:bg-muted/50"
```

---

## Logical Issues

### 6. Dead `copyToClipboard` import in category index components

All eight category-index components import `copyToClipboard` from `@/utils/clipboard` but never reference it (no `copyToClipboardFn`, no `@copy-to-clipboard-fn` listener):

- `web/src/components/ingestion/Server.vue:86`
- `web/src/components/ingestion/Database.vue:86`
- `web/src/components/ingestion/Networking.vue:86`
- `web/src/components/ingestion/Security.vue:86`
- `web/src/components/ingestion/Languages.vue:86`
- `web/src/components/ingestion/MessageQueues.vue:86`
- `web/src/components/ingestion/DevOps.vue:86`
- `web/src/components/ingestion/Others.vue:86`

Behavior-neutral but: (a) these listeners *were* present in the `main` branch (they used `q.notify`) and were removed without the import being removed; (b) the underlying source child components (`Curl.vue`, `Vector.vue`, etc.) all use `<CopyContent>` directly, so the parent passthrough is no longer needed — but `Custom.vue` and `Recommended.vue` still wire `@copy-to-clipboard-fn` to a usage-less prop, and the children no longer emit it. This is now a no-op wiring path that should be cleaned up.

**Solution:**
```diff
- import { copyToClipboard } from "@/utils/clipboard";
```
Delete the unused import from all 8 category-index components.

### 7. Custom.vue / Recommended.vue still wire a dead emit path

```html
<!-- Custom.vue:72 / Recommended.vue does NOT wire (cleaner), Ingestion.vue:215 -->
<router-view ... @copy-to-clipboard-fn="copyToClipboardFn">
```

The migrated source pages (Curl, Vector, Fluentd, Filebeat, FluentBit, Logstash, SyslogNg, etc.) use `<CopyContent>` (`web/src/components/CopyContent.vue`) which calls `copyToClipboard` itself and shows its own toast. They no longer emit `copy-to-clipboard-fn`. The wiring in `Custom.vue:72`, `Ingestion.vue:215`, and the `copyToClipboardFn` in `Custom.vue:186` and `Ingestion.vue:426` are unreachable dead code.

**Solution:**
```diff
- <router-view ... @copy-to-clipboard-fn="copyToClipboardFn" />
+ <router-view ... />
```
Delete the `copyToClipboardFn` function in `Custom.vue:186` and `Ingestion.vue:426` as well.

### 8. `onUpdated` redirects can fight current navigation

`Ingestion.vue:339-349`, `Custom.vue:174-184`, `Recommended.vue:113-123`, `Server.vue:128-138`, `Database.vue:128-138` keep an `onUpdated` hook that pushes the route back to a default child whenever the current route is the parent name. The mainline `onMounted` already does this, plus the route resolver does. This is pre-existing logic (also in `main`), but interacts with `OTabs`/`ORouteTab` emitted updates and can loop or cancel duplicate navigations in some edge cases. Worth a regression sanity-check after this refactor.

**Solution:** Move the redirect logic into a `beforeEnter` route guard, or guard the `onUpdated` to only fire when the route name is the parent:
```diff
  onUpdated(() => {
-   if (router.currentRoute.value.name === "ingestion") {
-     router.push({ name: defaultChild });
-   }
+   if (route.name === "ingestion" && route.name !== prevRoute) {
+     router.replace({ name: defaultChild });
+   }
  });
```

### 9. Search input in Ingestion.vue uses watcher with mid-typing replacement

`Ingestion.vue:572-629`: every keystroke calls `router.replace(...)` with a different target. With OInput's clearable enabled, partial matches keep navigating away from the user's current screen, and the AWS branch dynamically imports `awsIntegrations.ts` on every keystroke. The behavior is identical to `main` but worth flagging post-migration because OInput's input event may emit differently than QInput did. Quick manual smoke test recommended.

**Solution:** Debounce the search watcher:
```diff
- watch(() => searchTerm.value, (val) => { router.replace(...); });
+ import { useDebounceFn } from "@vueuse/core";
+ const debouncedSearch = useDebounceFn((val: string) => {
+   router.replace(...);
+ }, 300);
+ watch(() => searchTerm.value, debouncedSearch);
```

### 10. `Recommended.vue` icons use `"img:" + getImageURL(...)`

OK on `ORouteTab`/`OTab` (handled in `OTab.vue:23-25`), but if anyone ever uses `OIcon` with these strings, OIcon does NOT understand the `img:` prefix (see `web/src/lib/core/Icon/OIcon.vue`) — it will try to look up `img:.../kubernetes.svg` as an icon registry key and render nothing. No active usage of this pattern with `OIcon` was found in ingestion, so this is informational.

**Solution:** Add `img:` prefix handling to `OIcon.vue`:
```diff
+ if (props.name.startsWith('img:')) {
+   return h('img', { src: props.name.slice(4), class: '...' });
+ }
```

---

## CSS / Layout Issues

### 11. Stale `:deep(.q-field...)` selectors — `AzureConfig.vue:381-386`

```scss
// Suppress Quasar's focus container highlight for inputs in this component
:deep(.q-field--outlined.q-field--highlighted .q-field__control:after) {
  border-color: transparent !important;
}
:deep(.q-field--outlined.q-field--highlighted .q-field__control:before) {
  border-color: rgba(0, 0, 0, 0.24) !important;
}
```

`q-field` markup no longer exists (replaced by OInput). These rules are dead and harmless, but should be removed to (a) drop the misleading comment and (b) replace with a real `:deep(.o-input...)` rule if focus suppression on OInput in this section is still desired.

**Solution:**
```diff
- :deep(.q-field--outlined.q-field--highlighted .q-field__control:after) {
-   border-color: transparent !important;
- }
- :deep(.q-field--outlined.q-field--highlighted .q-field__control:before) {
-   border-color: rgba(0, 0, 0, 0.24) !important;
- }
```
Delete entirely or replace with `:deep(.o-input ...)` if focus suppression is still needed.

### 12. Quasar-derived utility classes still present alongside `tw:` — `Ingestion.vue:30,41,47,56,64`

```html
<span class="float-right tw:ml-3 tw:mb-1">
<OInput ... class="tw:max-w-sm tw:ml-3 tw:mb-1 right float-right indexlist-search-input">
<span class="text-subtitle tw:bg-amber-500 float-right tw:p-2 tw:font-bold">
```

`float-right`, `right`, `text-subtitle` come from Quasar's typography/positional utility CSS. Once Quasar's CSS is fully unloaded these will be no-ops. Since the bundle still ships the `_quasar-variables.scss` file (referenced via `--navbar-height`), some legacy Quasar CSS may still leak in for now and mask the issue. Recommend replacing with `tw:float-right` and an explicit Tailwind class (Tailwind has no `text-subtitle`; pick the closest design-system equivalent).

The "restricted_routes_on_empty_data" warning banner relies on `text-subtitle bg-warning` in main; here `bg-warning` was correctly rewritten to `tw:bg-amber-500`, but `text-subtitle` was left in, so the warning text's font sizing/weight has likely shifted.

**Solution:**
```diff
- class="float-right tw:ml-3 tw:mb-1"
+ class="tw:float-right tw:ml-3 tw:mb-1"
- class="text-subtitle tw:bg-amber-500 float-right tw:p-2 tw:font-bold"
+ class="tw:text-sm tw:bg-amber-500 tw:float-right tw:p-2 tw:font-bold"
```

### 13. `Recommended.vue` (and others) duplicate `:deep(.o-tab)` + side-effect `lang="scss"` selectors

`web/src/components/ingestion/Recommended.vue:262` (and replicated in `Server.vue:213`, `Database.vue:358`, `Networking.vue:190`, `Security.vue:261`, `Languages.vue:262`, `DevOps.vue:225`, `Others.vue:237`, `MessageQueues.vue:214`) each include a global (`<style lang="scss">` no scope) block that mutates `.ingestionPage .o-tab-panel { padding: 0 !important; ... }` and `.ingestionPage .OIcon > img { height: auto !important }`. This is duplicated 9 times. Two issues:

1. `.OIcon` is the class name with uppercase letters; `OIcon.vue:25` actually renders `<span class="tw:inline-flex...">` with no class named `OIcon`. The selector `.OIcon > img` matches nothing — image-icon sizing is *not* being constrained by these rules.
2. Duplicate global styles guarantee the *last* mounted category wins. With the SPA mount/unmount cycle through tabs, this is fine, but it's brittle and should be consolidated into one shared partial.

**Solution:** Consolidate into `web/src/styles/ingestion.scss`:
```diff
- // In each of 9 category files:
- <style lang="scss">.ingestionPage .o-tab-panel { padding: 0 !important } ...</style>
+ // In one shared file, scoped on a class once
+ .ingestionPage .o-tab-panel { padding: 0 !important; }
+ .ingestionPage .o-icon img { height: auto !important; }
```
Fix the selector `.OIcon > img` → `.o-icon img` to match the actual rendered class.

### 14. Empty selector parts (`tw:` + literal `pb-lg` / `mt-md` etc.) silently no-op

Already covered above (#3, #4) but worth calling out as a pattern. The mix of Quasar T-shirt sizing tokens (`md`, `lg`) with the `tw:` prefix is a recurring class of bug across the migration. A repo-wide regex sweep is warranted.

**Solution:** Add a lint rule to forbid `q[:-][a-z]+-(xs|sm|md|lg|xl)` patterns under `tw:` prefix. Replace with Tailwind numeric tokens (`tw:p-1`/`p-2`/`p-3`/etc.).

### 15. Inline-style + Tailwind conflict in `AzureConfig.vue` and `KubernetesConfig.vue`

`AzureConfig.vue:40-46, 75-81, 150-156, 168-174` use inline `style="display: grid; grid-template-columns: ...; gap: ...;"` rather than `tw:grid tw:grid-cols-[...] tw:gap-...`. Functional but inconsistent with the rest of the page. Not a bug.

**Solution:**
```diff
- style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;"
+ class="tw:grid tw:grid-cols-2 tw:gap-4"
```

### 16. Code-block / pre styling reliance

`CopyContent.vue:33` renders the content as a bare `<pre>{{ computedContent }}</pre>`. There is no Tailwind styling applied — its appearance depends on the global `.tabContent pre` / `pre` styles defined elsewhere. Verified that `web/src/styles/app.scss` keeps `.tabContent` styling, but a quick visual smoke test is recommended because `_quasar-variables.scss` is still imported and may shift base typography differently from the previous Quasar-bound state.

**Solution:** Make `<pre>` styling explicit in `CopyContent.vue`:
```diff
- <pre>{{ computedContent }}</pre>
+ <pre class="tw:overflow-x-auto tw:p-3 tw:rounded tw:bg-gray-100 tw:dark:bg-gray-800 tw:text-sm">{{ computedContent }}</pre>
```

---

## Component Migration Issues

### 17. `OTabPanels` is given Quasar-style props — `KubernetesConfig.vue:112-119`

```html
<OTabPanels
  v-model="tab"
  animated
  swipeable
  vertical
  transition-prev="jump-up"
  transition-next="jump-up"
>
```

- `animated` is supported by `OTabPanels` (see `OTabPanels.vue:7,20,33`).
- `swipeable`, `vertical`, `transition-prev`, `transition-next` are QTabPanels-only props. They become inert DOM attrs. The "swipe between Internal/External" gesture won't work, the transition is plain instead of `jump-up`, and `vertical` orientation is not applied.

If those behaviors aren't required, just remove these attrs to clean up the markup. Otherwise the equivalent O* features are missing.

**Solution:**
```diff
- <OTabPanels
-   v-model="tab"
-   animated
-   swipeable
-   vertical
-   transition-prev="jump-up"
-   transition-next="jump-up"
- >
+ <OTabPanels v-model="tab" animated>
```

### 18. `OTooltip` self-closing inside `OTab` — `KubernetesConfig.vue:32, 108` (works, but worth verifying)

```html
<OTab name="internal" label="Internal Endpoint">
  <OTooltip content="Use this if OpenObserve is in the same cluster" side="top" />
</OTab>
```

`OTooltip` does support "child mode" (`web/src/lib/overlay/Tooltip/OTooltip.vue:28-50`) which attaches listeners to its DOM parent like `q-tooltip` did. But the parent here is `OTab`'s rendered element — confirm that the OTab template forwards children inline. If `OTab` wraps the default slot inside an inner element, the OTooltip will attach to that inner element which may not be the visible tab trigger.

**Solution:** Use explicit trigger slot instead of child mode:
```diff
  <OTab name="internal" label="Internal Endpoint">
-   <OTooltip content="..." side="top" />
+   <template #trigger>...</template>
  </OTab>
```
Or, wrap the label slot of OTab with `<OTooltip>`.

### 19. Quasar QSplitter → OSplitter migration: prop name change

`traces/Index.vue:19-26`, `Custom.vue:19-23`, etc. went `<q-splitter v-model="splitterModel" unit="px">` → `<OSplitter v-model="splitterModel" unit="px" :horizontal="false">`. Quasar's default `q-splitter` is horizontal-divided (vertical orientation in O's terms). The new `OSplitter` likely defaults differently; `:horizontal="false"` was added — but Recommended.vue (line 22), Custom.vue (lacks the prop on line 19-23, just `unit="px"`) are inconsistent. Confirm OSplitter's default orientation and align all uses.

**Solution:** Explicitly pass `:horizontal="false"` on every usage:
```diff
- <OSplitter v-model="splitterModel" unit="px">
+ <OSplitter v-model="splitterModel" unit="px" :horizontal="false">
```

### 20. `text-blue-500 hover:text-blue-600` on a raw `<a>` — `GithubActions.vue:33`

```html
<a class="text-blue-500 hover:text-blue-600">here</a>
```

These are bare Tailwind utilities (no `tw:` prefix). Project convention everywhere else is `tw:text-blue-500 tw:hover:text-blue-600`. Without the prefix, these may be ignored depending on the Tailwind config — and they're hardcoded blue instead of using the design-system primary color.

**Solution:**
```diff
- <a class="text-blue-500 hover:text-blue-600">here</a>
+ <a class="tw:text-[var(--o2-primary)] tw:hover:underline">here</a>
```

### 21. `OCheckbox` array v-model usage — `AzureConfig.vue:158-164`

```html
<OCheckbox
  v-for="cat in LOG_CATEGORIES"
  v-model="enabledCategories"
  :val="cat.value"
  :label="cat.label"
/>
```

OCheckbox supports `val` as a q-checkbox alias and array-model detection (`OCheckbox.vue:34-35`), so this works. No issue, just noted for completeness.

**Solution:** No code change needed; informational only.

### 22. AIIntegrations.vue, Recommended.vue stray empty `<style>`

`AIIntegrations.vue:199` has a trailing empty block after `</script>` — harmless but suggests unfinished cleanup.

**Solution:**
```diff
- </script>
- <style></style>
+ </script>
```
Delete the empty `<style></style>` block.

---

## Test File Issues

89 ingestion spec files reference `quasar`, `useQuasar`, or `installQuasar`. The 15 most-broken examples (importing `quasar` directly, mocking pre-migration shapes) are:

```
web/src/components/ingestion/Security.spec.ts:7         import { useQuasar } from "quasar"
web/src/components/ingestion/Languages.spec.ts:7        import { useQuasar } from "quasar"
web/src/components/ingestion/Custom.spec.ts:7           import { useQuasar } from "quasar"
web/src/components/ingestion/Server.spec.ts:7           import { useQuasar } from "quasar"
web/src/components/ingestion/logs/ingestionIndex.spec.ts:19   import { copyToClipboard } from "quasar"
web/src/components/ingestion/Database.spec.ts:47        useQuasar: () => mockQuasar
web/src/components/ingestion/Networking.spec.ts:47      useQuasar: () => mockQuasar
web/src/components/ingestion/DevOps.spec.ts:47          useQuasar: () => mockQuasar
web/src/components/ingestion/Others.spec.ts:50          useQuasar: () => mockQuasar
web/src/components/ingestion/AIIntegrations.spec.ts:25  useQuasar: () => ({ notify: vi.fn() })
web/src/components/ingestion/metrics/Index.spec.ts:54   useQuasar: () => mockQuasar
web/src/components/ingestion/traces/Index.spec.ts:54    useQuasar: () => ({...})
web/src/components/ingestion/rum/Index.spec.ts:54       useQuasar: () => mockQuasar
web/src/components/ingestion/logs/Index.spec.ts:54      useQuasar: () => mockQuasar
web/src/components/ingestion/databases/Databricks.spec.ts:40  useQuasar: vi.fn(() => ({...}))
```

### 23. Tests assert `quasar.copyToClipboard` is called — `Custom.spec.ts:237-298` (5 sites), `logs/ingestionIndex.spec.ts:19,180,224,456`, `logs/Index.spec.ts:350,366`, `rum/Index.spec.ts:274,290`, `metrics/Index.spec.ts:322,338`

The source now calls `copyToClipboard(content, { successMessage, errorMessage, timeout })` from `@/utils/clipboard`. These tests still:
1. `vi.mock("quasar", { copyToClipboard: vi.fn() })`
2. `expect(copyToClipboard).toHaveBeenCalledWith("test content to copy")` — wrong signature now
3. `expect(mockQuasar.notify).toHaveBeenCalledWith({ type: "positive", ... })` — the migrated source calls `toast({ variant: "success", ... })` from `@/lib/feedback/Toast/useToast`, never `q.notify`.

These tests will fail at runtime (or pass falsely if the mocks satisfy the no-op assertions).

**Solution:**
```diff
- import { copyToClipboard } from "quasar";
+ import { copyToClipboard } from "@/utils/clipboard";
- vi.mock("quasar", () => ({ copyToClipboard: vi.fn() }));
+ vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn() }));
- expect(copyToClipboard).toHaveBeenCalledWith("test content to copy");
+ expect(copyToClipboard).toHaveBeenCalledWith("test content to copy", expect.any(Object));
- expect(mockQuasar.notify).toHaveBeenCalledWith({ type: "positive", message: "..." });
+ expect(toast).toHaveBeenCalledWith({ variant: "success", message: "..." });
```

### 24. Test stubs reference `OButton` / `OInput` but mock structure built around Quasar

Most specs use `mount` + `installQuasar({ plugins: [] })`. With Quasar no longer required, this still attempts to load Quasar plugins that may have been removed. `installQuasar` itself (`web/src/test/unit/helpers/install-quasar-plugin.ts`) needs auditing — outside of this audit scope but tightly coupled.

**Solution:** Replace `installQuasar({ plugins: [] })` with the new helper alias (e.g. `tempQuasarPlugin()`), or drop the call entirely if it's no longer needed.

### 25. `AzureConfig.spec.ts`, `AWSConfig.spec.ts`, `KubernetesConfig.spec.ts` etc. — may pass on stubs but exercise no migrated logic

The spec inventory is large; I sampled a handful. Recommendation: run `pnpm test web/src/components/ingestion` and triage from failures.

**Solution:** Run `pnpm test web/src/components/ingestion` and fix the failures triaged by error: missing `useQuasar` → mock `useToast`; missing `installQuasar` → use `tempQuasarPlugin`.

### 26. Recommended fix path for tests

For each of the 15 directly-importing `quasar` specs:
- Replace `import { copyToClipboard } from "quasar"` with `import { copyToClipboard } from "@/utils/clipboard"`.
- Replace `useQuasar` mocks with `vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }))`.
- Replace assertions `q.notify({ type: "positive", ... })` → `toast({ variant: "success", ... })`.
- Update `copyToClipboard` argument expectations to include the options object.

**Solution:** See #23 — same diff applies to all 15 spec files.

---

## Accessibility

### 27. Search input uses icon-only slot, no `aria-label`

`Ingestion.vue:52-62`, `Server.vue:27-37`, `Database.vue:27-37`, `Networking.vue:27-37`, etc. all render an `<OIcon name="search">` inside `#icon-left` with `class="tw:cursor-pointer"`. The cursor change suggests it is clickable but no `@click` handler exists and no `aria-label`/`role` is set. Decorative icons should have `aria-hidden="true"`; if they're not interactive, remove `tw:cursor-pointer`.

**Solution:**
```diff
- <OIcon name="search" class="tw:cursor-pointer" />
+ <OIcon name="search" aria-hidden="true" />
```

### 28. Token-reset OButton lacks descriptive accessible name when collapsed

`Ingestion.vue:32-50`: `<OButton variant="primary" size="sm">{{ t('ingestion.resetRUMTokenLabel') }}</OButton>` is fine because the label is rendered. No issue.

**Solution:** No code change needed; informational only.

### 29. Hover-only affordance on AWSIntegrationTile rows

`AWSIntegrationTile.vue:90,109` adds `hover:tw:bg-muted/50` (broken — see #5) plus no focus style. Keyboard users won't see a focus ring; combined with the broken hover, the rows give no interaction feedback at all. Add `tw:focus-visible:bg-muted/50 tw:focus-visible:outline-2` and fix the hover order.

**Solution:**
```diff
- class="hover:tw:bg-muted/50"
+ class="tw:hover:bg-muted/50 tw:focus-visible:bg-muted/50 tw:focus-visible:outline-2 tw:focus-visible:outline-[var(--o2-primary)]"
```

### 30. Color-only contrast for `text-blue-500` link — `GithubActions.vue:33`

Already noted (#20). Underline is forced via inline `style="text-decoration: underline"`, so semantic underline is OK. Color contrast for `text-blue-500` against light background is borderline (WCAG AA 4.5:1) — depends on the surrounding background. Worth audit.

**Solution:** See #20 — switch to `tw:text-[var(--o2-primary)]` which has tested contrast.

---

## Recommendations

1. **Fix the 5 critical bugs first** (Critical Issues #1-#5). They are concrete render regressions:
   - `Ingestion.vue:210` (max-h calc spaces)
   - `KubernetesConfig.vue:97` (`horizontalalign` typo)
   - `KubernetesConfig.vue:76` (`q:mt-md`)
   - `KubernetesConfig.vue:3` (`tw:pb-lg`)
   - `KubernetesConfig.vue:185,191`, `AWSIntegrationTile.vue:90,109` (`hover:tw:`)

2. **Cleanup pass**: remove the 8 dead `copyToClipboard` imports in category index components, remove `copyToClipboardFn` from `Ingestion.vue` + `Custom.vue` + the listener wiring on `<router-view @copy-to-clipboard-fn>`. The migrated child components handle copy via `<CopyContent>` directly.

3. **CSS cleanup pass**:
   - Drop `:deep(.q-field…)` from `AzureConfig.vue:381-386`.
   - Replace `float-right`, `right`, `text-subtitle`, `text-primary` Quasar utilities in `Ingestion.vue` and `KubernetesConfig.vue` with `tw:` equivalents.
   - Consolidate the 9 duplicated `.ingestionPage` global style blocks into one shared SCSS partial; remove the bogus `.OIcon > img` selector or update to the real OIcon class.

4. **Test migration**: triage all 89 spec files; the most urgent are those that directly `import ... from "quasar"` (15 files). They will fail compilation in a Quasar-free environment.

5. **OTabPanels props**: in `KubernetesConfig.vue:112-119`, decide whether `swipeable` / `vertical` / `transition-*` need to be re-implemented in `OTabPanels`, or whether removing them from the markup is acceptable.

6. **Smoke test the runtime page** in dev:
   - Confirm vertical scroll behavior on the Ingestion shell (Critical #1).
   - Confirm Kubernetes "Internal/External" tabs render horizontally with left alignment (Critical #2).
   - Confirm search bar in `Server.vue`, `Database.vue`, etc. filters and the icon doesn't suggest interactivity it doesn't have (#27).
   - Confirm `CopyContent` button copies and shows the success toast.
   - Confirm token-reset / RUM-token buttons fire the right `toast` notification.

7. **Future-proofing**: add a lint rule or pre-commit grep for `class="[^"]*q[:-][a-z]+-(xs|sm|md|lg|xl)` patterns and `hover:tw:` / `focus:tw:` / `dark:tw:` patterns — both classes of bug were introduced repeatedly in this migration and a guardrail will catch them on the next refactor.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|-----------|-------|-------------|-------|
| `views/Ingestion.vue:30` | `float-right` | `tw:float-right` (or restructure to flex layout) | File-scoped |
| `views/Ingestion.vue:41` | `float-right` | `tw:float-right` | File-scoped |
| `views/Ingestion.vue:47` | `float-right` | `tw:float-right` | File-scoped |
| `views/Ingestion.vue:56` | `right float-right` | `tw:float-right tw:text-right` (drop bare `right` Quasar alignment) | File-scoped |
| `views/Ingestion.vue:64` | `text-subtitle ... float-right` | `tw:text-sm tw:float-right` | File-scoped |
| `components/ingestion/recommended/KubernetesConfig.vue:185` | `text-primary` | `tw:text-[var(--o2-primary)]` | File-scoped |
| `components/ingestion/recommended/KubernetesConfig.vue:191` | `text-primary` | `tw:text-[var(--o2-primary)]` | File-scoped |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|-----------|-------|-------|-------|
| `components/ingestion/recommended/KubernetesConfig.vue:3` | `tw:pb-lg` (invalid token) | `tw:pb-8` (or `tw:pb-6`) | File-scoped |
| `components/ingestion/recommended/KubernetesConfig.vue:185` | `hover:tw:underline` | `tw:hover:underline` | File-scoped |
| `components/ingestion/recommended/KubernetesConfig.vue:191` | `hover:tw:underline` | `tw:hover:underline` | File-scoped |
| `components/ingestion/recommended/AWSIntegrationTile.vue:90` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-scoped |
| `components/ingestion/recommended/AWSIntegrationTile.vue:109` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-scoped |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|-----------|----------|-------------|-------|
*(none found)*

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|-----------|----------|--------|-------|
| `components/ingestion/recommended/AzureConfig.vue:381` | `:deep(.q-field--outlined.q-field--highlighted .q-field__control:after)` | Delete (no OInput emits these classes) | File-scoped |
| `components/ingestion/recommended/AzureConfig.vue:384` | `:deep(.q-field--outlined.q-field--highlighted .q-field__control:before)` | Delete | File-scoped |
| `components/ingestion/recommended/AWSIntegrationGrid.vue:159` | `.body--dark &` | `html.dark &` | File-scoped |
| `components/ingestion/recommended/AzureQuickSetup.vue:429` | `.body--dark &` | `html.dark &` | File-scoped |
| `components/ingestion/recommended/AzureIndividualServices.vue:135` | `.body--dark &` | `html.dark &` | File-scoped |
| `components/ingestion/recommended/AWSQuickSetup.vue:679` | `.body--dark &` | `html.dark &` | File-scoped |
| `components/ingestion/recommended/AWSIndividualServices.vue:159` | `.body--dark &` | `html.dark &` | File-scoped |
| `components/ingestion/recommended/AzureIntegrationTile.vue:267` | `.body--dark &` | `html.dark &` | File-scoped |
| `components/ingestion/recommended/AzureConfig.vue:412` | `.body--dark &` | `html.dark &` | File-scoped |
| `components/ingestion/recommended/AWSIntegrationTile.vue:640` | `.body--dark &` | `html.dark &` | File-scoped |
| `components/ingestion/recommended/AWSConfig.vue:160` | `.body--dark &` | `html.dark &` | File-scoped |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
|-----------|----------|-------------|-------|
| `components/ingestion/rum/Index.vue:184` | `$accent` | `var(--o2-accent)` | File-scoped |

### 6. Quasar Directives
| File:Line | Directive | Action |
|-----------|-----------|--------|
*(none found)*

### 7. Icon Migration
| File:Line | Issue | Fix |
|-----------|-------|-----|
| `components/ingestion/Recommended.vue:273` | `.OIcon > img { ... }` — selector targets a non-existent inner `<img>` of OIcon (OIcon renders inline SVG, not `<img>`) | Either delete the rule or rewrite to `.OIcon svg` / `.OIcon` directly |
| `components/ingestion/Custom.vue:245` | same `.OIcon > img` selector | Same |
| `components/ingestion/logs/Index.vue:286` | same `.OIcon > img` selector | Same |

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
|-----------|--------------|----------------|
| `components/ingestion/logs/Index.vue:23` | `style="min-height: calc(100vh - 130px)"` | scoped `.ingestionPage { min-height: calc(100vh - 130px); }` |
| `components/ingestion/rum/Index.vue:23` | `style="min-height: calc(100vh - 130px)"` | same — promote to shared partial |
| `components/ingestion/traces/Index.vue:23` | `style="min-height: calc(100vh - 130px)"` | same |
| `components/ingestion/metrics/Index.vue:23` | `style="min-height: calc(100vh - 130px)"` | same |

### 9. Duplicate Style Blocks (candidates for partial)
| Files | Duplicated block | Suggested partial |
|-------|------------------|-------------------|
| `views/Ingestion.vue:664`, `Security.vue:265`, `Recommended.vue:253/261`, `DevOps.vue:229`, `logs/Index.vue:265/274`, `Networking.vue:194`, `Others.vue:241`, `rum/Index.vue:161`, `Custom.vue:224/233`, `Database.vue:362`, `MessageQueues.vue:218`, `metrics/Index.vue:218`, `Server.vue:217`, `traces/Index.vue:192`, `Languages.vue:266` | `.ingestionPage { ... }` block repeated 18+ times | Promote to single `_ingestion.scss` partial imported once; remove the `<style>` duplicate from each file |
| `Recommended.vue:273`, `Custom.vue:245`, `logs/Index.vue:286` | `.OIcon > img { ... }` (dead) | Delete from all three |
| `Server.vue:35`, `Database.vue:35`, `Languages.vue:35`, `MessageQueues.vue:35`, `Networking.vue:35`, `Others.vue:35`, `Security.vue:35`, `DevOps.vue:35`, `AIIntegrations.vue:49` | `<OIcon name="search" size="sm" class="tw:cursor-pointer" />` inside the same search-input header | Promote header to `<IngestionSearchBar>` partial |
| Category index components (`Server.vue`, `Database.vue`, …) | same `copyToClipboard` import + listener wiring (per Summary) | Already noted under cleanup pass |

### 10. Layer Summary
- Global (`app.scss`) changes needed: 1 (extract `.ingestionPage` once or move to `_ingestion.scss`)
- Component-level partial changes: 2 (`IngestionSearchBar`, shared category card grid)
- File-level scoped changes: ~20
