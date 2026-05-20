# Layout / Shell — Quasar Removal Audit

## Summary

The Quasar Framework has been fully removed from the app shell. Old Quasar-namespaced components (`q-layout`, `q-header`, `q-drawer`, `q-page-container`, `q-toolbar`, `q-item`, `q-icon`, `q-select`, `q-dialog`) and `useQuasar()` are gone from MainLayout, Header, MenuLink, RouteTabs, ThemeSwitcher, ConfirmDialog, EnterpriseUpgradeDialog, WebinarBanner, DatabaseDeprecationBanner, and AutoRefreshInterval. They have been replaced with native HTML elements + Tailwind `tw:` classes + the new O2 component library (`ONavbar`, `ODialog`, `OButton`, `OIcon`, `ODropdown`, etc.). The Quasar plugin registration in `web/src/main.ts` is removed (commit 1c38131b25).

The migration is mostly clean, but there are several serious regressions and dead-code/leftover problems that need attention. Most critical: **every spec test in the repo that calls `installQuasar(...)` is currently broken** because the helper function was renamed but call-sites were not updated. Second-most critical: the legacy `body--dark` / `body--light` class system used by ~189 CSS selectors across the app is no longer toggled anywhere — only `<html>.dark` is set — so a large swath of theme-specific CSS is now dead.

## Files Audited

- `web/src/layouts/MainLayout.vue` (1231 lines, -912 lines vs main)
- `web/src/components/Header.vue` (917 lines)
- `web/src/components/MenuLink.vue` (478 lines)
- `web/src/components/RouteTabs.vue` (61 lines)
- `web/src/components/ThemeSwitcher.vue` (124 lines)
- `web/src/components/EnterpriseUpgradeDialog.vue` (1506 lines)
- `web/src/components/WebinarBanner.vue` (357 lines)
- `web/src/components/DatabaseDeprecationBanner.vue` (123 lines)
- `web/src/components/AutoRefreshInterval.vue` (409 lines)
- `web/src/components/ConfirmDialog.vue` (80 lines)
- `web/src/components/ConfirmDialogProvider.vue` (27 lines)
- `web/src/lib/core/Navbar/ONavbar.vue` (109 lines)
- `web/src/App.vue` (where `ConfirmDialogProvider` is mounted)
- `web/src/main.ts` (Quasar plugin removed, +15/-22 lines)
- `web/src/test/unit/helpers/install-quasar-plugin.ts` (helper renamed)
- Spec counterparts of all above components
- `web/src/styles/_quasar-variables.scss` (new compat shim)

## Critical Issues

### 1. `installQuasar()` is not exported, breaking ~580 spec files

`web/src/test/unit/helpers/install-quasar-plugin.ts:27` exports only `tempQuasarPlugin`:

```ts
export function tempQuasarPlugin() { ... }
```

The previous `installQuasar(options?)` function was renamed but the rename was **not propagated** to consumers. A grep finds 580 files in `web/src/**` still importing `{ installQuasar }` from this file and calling it. Every one of them now throws at module-load time:

- `web/src/layouts/MainLayout.spec.ts:19`, `:83`
- `web/src/components/Header.spec.ts:18`, `:36`
- `web/src/components/MenuLink.spec.ts:18`, `:25`
- `web/src/components/RouteTabs.spec.ts:4`, `:14`
- `web/src/components/ThemeSwitcher.spec.ts:3`, `:27`
- `web/src/components/AutoRefreshInterval.spec.ts:3`, `:8`
- `web/src/components/ConfirmDialog.spec.ts:18`, `:23`
- `web/src/components/DatabaseDeprecationBanner.spec.ts:19`, `:22`
- `web/src/components/EnterpriseUpgradeDialog.spec.ts:26`, `:29`
- ...and ~570 more

The file even contains a TODO at the top admitting tests will be rewritten, but until then unit tests are broken. Either re-export an alias (`export const installQuasar = tempQuasarPlugin;` accepting/ignoring an options arg) or do a codemod across all `.spec.ts` files.

**Solution:**
```diff
 export function tempQuasarPlugin() { ... }
+// Back-compat shim — accepts an options arg, ignores it.
+export const installQuasar = (_options?: any) => tempQuasarPlugin();
```

### 2. `body.body--dark` / `body.body--light` class is no longer toggled

`web/src/components/ThemeSwitcher.vue:86` only toggles `document.documentElement.classList.toggle('dark', ...)`. Same pattern in `web/src/components/PredefinedThemes.vue:314`, `web/src/components/settings/General.vue:918`, `web/src/utils/theme.ts:100`.

But the codebase has **189 selectors using `.body--dark` / `.body--light`**, including key shell selectors:

- `web/src/components/Header.vue:810`, `:853`, `:882` (header language menu dark styles dead in dark mode)
- `web/src/components/MenuLink.vue:398`, `:452`, `:464` (active-state colors for left nav)
- `web/src/styles/app.scss:545`, `:1564`, `:1571`
- `web/src/styles/_variables.scss:470`
- `web/src/utils/logs/convertLogData.ts:101` — `document.body.classList.contains('body--dark')` will now ALWAYS return false, silently degrading log color coding.

Either (a) keep adding/removing `body--dark` / `body--light` body classes alongside `<html>.dark`, or (b) globally replace `body.body--dark` → `html.dark` in CSS and `document.body.classList.contains('body--dark')` → `document.documentElement.classList.contains('dark')`.

**Solution (option a, minimal disruption):**
```diff
 // ThemeSwitcher.vue / PredefinedThemes.vue / theme.ts
-document.documentElement.classList.toggle('dark', isDark);
+document.documentElement.classList.toggle('dark', isDark);
+document.body.classList.toggle('body--dark', isDark);
+document.body.classList.toggle('body--light', !isDark);
```
And in `convertLogData.ts:101`:
```diff
-document.body.classList.contains('body--dark')
+document.documentElement.classList.contains('dark')
```

### 3. Drawer collapse / mobile responsive nav is gone

In main, `q-drawer` had `v-model="drawer"` + `show-if-above` + `:breakpoint="500"` — i.e. it auto-hides on screens narrower than 500px and reopens when wider. The new `MainLayout.vue:1102` returns:

```
leftDrawerOpen: true,
```

(a static literal, not a ref) and passes it to `<ONavbar :visible="leftDrawerOpen">`. There is no toggle method, no hamburger button, no breakpoint listener. The media-query rule at `web/src/layouts/MainLayout.vue:1217-1222` only handles screens ≥501px — there is no rule for narrower screens, and `ONavbar` is always rendered visible regardless. **Mobile users get the sidebar permanently taking up width.**

Furthermore the watcher / mouse handler `expandMenu()` (`MainLayout.vue:984-987`) is still returned from `setup()` but never bound to anything in the template — dead code that used to be the drawer mouseenter handler.

**Solution:**
```diff
-leftDrawerOpen: true,
+leftDrawerOpen: ref(window.matchMedia('(min-width: 500px)').matches),
```
Add a `matchMedia` listener in `onMounted` to toggle on resize, plus a hamburger `OButton` in `Header.vue` that calls `leftDrawerOpen.value = !leftDrawerOpen.value`. Remove the dead `expandMenu` export.

### 4. Header is no longer sticky / pinned to top

Quasar's `<q-layout view="hHh Lpr lff">` ensured `<q-header>` was sticky-pinned across page scroll. The new `<header class="o2-app-header tw:shrink-0">` in `MainLayout.vue:21` has **no `position: sticky` or `position: fixed`**. Searching `web/src/styles/app.scss` and `MainLayout.vue` for the `.o2-app-header` class returns only `color: unset` (`MainLayout.vue:1224-1226`) and a dropdown-arrow margin tweak (`app.scss:2289`).

In practice, the root container is `tw:h-screen tw:flex tw:flex-col`, and the scroll is delegated to `.o2-content-scroll`, so for *most* layouts the header still stays at the top because the outer document doesn't scroll. But any inline `100vh` page content or any nested overflow that bubbles up to `document.documentElement` will scroll the header out of view. The aside `.o2-sidebar-right` at `MainLayout.vue:93` is given `tw:sticky tw:top-[var(--navbar-height,2.25rem)]` but the header it sticks beneath is not anchored — when AI chat panel detaches into an `o2-sidebar--expanded` overlay this still works because of `position: fixed` inline, but the inline (non-expanded) flow relies on the header retaining its 2.25rem height that is no longer enforced anywhere.

**Solution:**
```diff
 .o2-app-header {
   color: unset;
+  position: sticky;
+  top: 0;
+  z-index: 100;
+  min-height: var(--navbar-height, 2.25rem);
 }
```

### 5. Helper `installQuasar({ plugins: [Dialog, Notify] })` removed Notify support

`web/src/layouts/MainLayout.spec.ts:17` imported `{ Dialog, Notify } from "quasar"` before; the migrated spec deletes that import and calls `installQuasar()` with no plugins. But the production code path through `verifyStreamExist()` (`MainLayout.vue:659-666`) uses the new `toast()` from `@/lib/feedback/Toast/useToast` instead of `$q.notify` — good. However many other spec files still inject `Notify` plugin assuming Quasar is alive. Combined with issue #1 above, this compounds the spec breakage.

**Solution:** see Critical Issue #1 — once `installQuasar` accepts and ignores a plugin-options argument, existing `installQuasar({ plugins: [Dialog, Notify] })` callers work without modification. Also mock `useToast` in specs that previously asserted on `$q.notify`:
```diff
-vi.spyOn($q, 'notify')
+vi.mock('@/lib/feedback/Toast/useToast', () => ({ toast: vi.fn() }))
```

## Logical Issues

### 6. `MenuLink` doesn't declare `linkName`, `animationIndex`, or `exact` props but they are spread in

`MainLayout.vue:60-65` (via `<ONavbar>`) and `ONavbar.vue:31-33` spread `v-bind="{ ...nav, mini: miniMode }"` plus `:link-name="nav.name"` and `:animation-index="index"`. `MenuLink.vue` declares only `title, caption, link, icon, iconComponent, mini, target, external, badge` (`MenuLink.vue:120-166`). The undeclared props `linkName`, `animationIndex`, `exact`, `name`, `display`, `hide` fall through to the root `<a>` or `<router-link>` element as plain HTML attributes — they are inert at best, and in Chrome may trigger an "unknown attribute" warning. Worse, the `exact: true` flag set on the Home link in `MainLayout.vue:336` is completely ignored, replaced by a custom name-based check in `MenuLink.vue:178-184`. Strip the unused fields from the link list or declare them as props.

**Solution:**
```diff
 const props = defineProps<{
   title?: string;
   caption?: string;
   link?: string;
   icon?: string;
   iconComponent?: Component | null;
   mini?: boolean;
   target?: string;
   external?: boolean;
   badge?: string;
+  linkName?: string;
+  animationIndex?: number;
+  exact?: boolean;
+  name?: string;
+  display?: boolean;
+  hide?: boolean;
 }>();
+defineOptions({ inheritAttrs: false });
```

### 7. `<router-link :target="target">` is meaningless

`MenuLink.vue:76` binds `target` on `<router-link>`, but `<router-link>` does not honor a `target` attribute (it renders an `<a>` and does not forward arbitrary attrs unless `custom` slot is used). The original `q-item` accepted `target` via the `:to` link wrapper. Internal links can no longer open in `_blank`. Either switch to `<router-link custom v-slot="{ navigate, href }"><a :href="href" :target="target">` or drop the `target` binding for internal links.

**Solution:**
```diff
-<router-link :to="link" :target="target">
-  ...
-</router-link>
+<router-link :to="link" custom v-slot="{ navigate, href }">
+  <a :href="href" :target="target" @click="navigate">
+    ...
+  </a>
+</router-link>
```

### 8. `splitterModel`, `expandMenu`, `prefetch`, `outlinedSettings`/`"settings"` are dead exports

`MainLayout.vue:1112-1117` returns `prefetch`, `expandMenu`, `splitterModel`, `"settings": "settings"` — none of these are referenced by the template anymore (no `q-splitter`, no drawer mouseenter binding, no `outlinedSettings` icon binding). These are leftover from the Quasar template and add noise.

**Solution:**
```diff
 return {
   ...,
-  prefetch,
-  expandMenu,
-  splitterModel,
-  "settings": "settings",
 };
```
Also drop the declarations themselves above (`prefetch`, `expandMenu`, `splitterModel`).

### 9. `linksList[0].exact` and `iconComponent` props are dead

`MainLayout.vue:336` sets `exact: true` on Home; never read by `MenuLink`. `MenuLink.vue:141-144` declares an `iconComponent` prop with a `default: () => ({})` and falsy-checks it via `v-else-if="iconComponent"` (`:43, :94`). Since `default: () => ({})` is an empty object that is truthy, the `v-else-if` branch will render an empty `<component :is>` whenever the `icon` string is empty. Coerce to `null` default or use `Object.keys(iconComponent).length`.

**Solution:**
```diff
 iconComponent: {
-  type: Object,
-  default: () => ({}),
+  type: Object,
+  default: null,
 },
```

### 10. AI chat toggle no longer goes back to expanded

`MainLayout.vue:1000-1014` (`toggleAIChat()`): the third branch "Expanded overlay → Back to inline sidebar" only sets `isAiChatExpanded = false`. Previous Quasar behavior allowed reopening directly to expanded (via separate button); now there's a one-way collapse. This may be intentional but worth flagging.

**Solution (if a "re-expand" affordance is desired):**
```diff
 const toggleAIChat = () => {
   if (!isAiChatOpen.value) { isAiChatOpen.value = true; return; }
   if (!isAiChatExpanded.value) { isAiChatExpanded.value = true; return; }
-  isAiChatExpanded.value = false;
+  // close entirely on third click rather than just collapsing the overlay
+  isAiChatOpen.value = false;
+  isAiChatExpanded.value = false;
 };
```

### 11. ConfirmDialogProvider mounts at App.vue but ConfirmDialog (old) is still a public component

`web/src/App.vue:22` mounts `<ConfirmDialogProvider />` globally. But the legacy `ConfirmDialog.vue` is still used as a stand-alone two-way bound component in many places. Both coexist — this is fine for now, but be aware of two confirmation flows.

**Solution:** no change needed unless consolidating. To migrate a call site:
```diff
-<ConfirmDialog v-model="confirmOpen" title="..." @confirm="onConfirm" />
+// in script — use the provider's composable
+const { confirm } = useConfirmDialog();
+const ok = await confirm({ title: '...' });
+if (ok) onConfirm();
```

## CSS / Layout Issues

### 12. `:global(body)` inside scoped SCSS is not valid Vue SFC syntax

`MainLayout.vue:1196-1213`:

```scss
<style lang="scss" scoped>
.printMode {
  :global(body) {
    overflow: auto !important;
  }
  ...
}
</style>
```

Vue SFC scoped styles do **not** support `:global()` — that selector is a CSS Modules feature. Vue uses `:deep()` for descendant breakouts but cannot target ancestors. The compiled CSS will either drop the rule or scope it incorrectly. Print mode body overflow override will silently not work.

**Solution:** move the body rule to an unscoped block in the same file:
```diff
-<style lang="scss" scoped>
-.printMode {
-  :global(body) { overflow: auto !important; }
-  ...
-}
-</style>
+<style lang="scss" scoped>
+.printMode { /* scoped rules only */ }
+</style>
+<style lang="scss">
+body.printMode-active { overflow: auto !important; }
+</style>
```
Toggle `body.printMode-active` from JS when print mode activates.

### 13. `:deep()` inside an UNSCOPED `<style lang="scss">` block

`MenuLink.vue:407-432`:

```scss
<style lang="scss">
.navbar-links {
  .nav-menu-item {
    :deep(.nav-menu-item-avatar > span),
    :deep(.icon-wrapper > span) {
      height: 1.5rem !important;
      ...
    }
  }
}
</style>
```

`:deep()` is only valid in `<style scoped>` blocks. In an unscoped block the Vue compiler leaves the literal text `:deep(...)` in place, producing an invalid CSS selector. These two rules (sidebar icon size override) will not apply. Replace with plain descendant: `.navbar-links .nav-menu-item .nav-menu-item-avatar > span { ... }`.

**Solution:**
```diff
 <style lang="scss">
 .navbar-links .nav-menu-item {
-  :deep(.nav-menu-item-avatar > span),
-  :deep(.icon-wrapper > span) {
+  .nav-menu-item-avatar > span,
+  .icon-wrapper > span {
     height: 1.5rem !important;
   }
 }
 </style>
```

### 14. `.left-drawer` styles in `MainLayout.vue` scoped block cannot reach `<ONavbar>`'s `<nav>`

`MainLayout.vue:1217-1230`:

```scss
@media (min-width: 501px) {
  .left-drawer {
    display: flex !important;
    flex-direction: column;
  }
}
.left-drawer {
  margin-bottom: 0.675rem;
}
```

These live inside `<style scoped>`. The `.left-drawer` class is rendered by the child `ONavbar.vue:25` (on its `<nav>` element). Scoped style data-attributes attached by MainLayout won't be present on ONavbar's root, so these rules will never match. The drawer's mobile responsive rule is effectively a no-op (in addition to issue #3). Move to unscoped or to ONavbar.

**Solution:**
```diff
 <style lang="scss" scoped>
 /* … */
-@media (min-width: 501px) {
-  .left-drawer { display: flex !important; flex-direction: column; }
-}
-.left-drawer { margin-bottom: 0.675rem; }
 </style>
+<style lang="scss">
+@media (min-width: 501px) {
+  .left-drawer { display: flex !important; flex-direction: column; }
+}
+.left-drawer { margin-bottom: 0.675rem; }
+</style>
```

### 15. `--q-primary-rgb` is used but never defined

`web/src/styles/logs/json-preview.scss:75` references `rgba(var(--q-primary-rgb), 0.1)`. The codebase defines `--q-primary` (aliased to `--o2-theme-color`) at `web/src/styles/_variables.scss:366,517,550`, but not `--q-primary-rgb`. The `rgba()` call will compute to `rgba(, 0.1)` which is invalid and the rule will be dropped. Was previously injected by Quasar.

Same pattern in `web/src/components/EnterpriseUpgradeDialog.vue`: 18 references to `var(--q-primary)` and `var(--q-primary-rgb)` (lines 1072, 1224, 1289, 1346-1485 various). The `--q-primary` ones work via the alias; the `--q-primary-rgb` ones produce invalid color values. Search results show 314 total `--q-` references across `web/src`, mostly in tracing/dashboard plugins.

**Solution:** define the RGB alias in `_variables.scss`:
```diff
 :root {
   --q-primary: var(--o2-theme-color);
+  --q-primary-rgb: var(--o2-theme-color-rgb, 99, 102, 241);
 }
```
And set `--o2-theme-color-rgb` whenever `--o2-theme-color` changes (theme switcher).

### 16. `relative-position` Quasar utility class left in Header.vue

`Header.vue:24` and `:114` use `class="tw:flex relative-position tw:mr-2"`. `relative-position` is a Quasar utility (sets `position: relative`). Since Quasar CSS is no longer bundled, this is dead. Either remove or replace with `tw:relative`.

**Solution:**
```diff
-class="tw:flex relative-position tw:mr-2"
+class="tw:flex tw:relative tw:mr-2"
```

### 17. `navbar-height` CSS variable inconsistent between SCSS shim and runtime watcher

- `web/src/styles/_quasar-variables.scss:51` sets `--navbar-height: 36px` at `:root`.
- `MainLayout.vue:476-485` watcher sets it dynamically to `"2.5rem"` (40px) or `"calc(2.5rem + 1.688rem)"` (when webinar visible).

The 36→40px mismatch could cause a 4px shift on initial paint before Vue hydrates the watcher. Pick one source of truth.

**Solution:**
```diff
 :root {
-  --navbar-height: 36px;
+  --navbar-height: 2.5rem;
 }
```

### 18. Webinar banner color override lacks contrast verification

`MainLayout.vue:23-27`:

```html
<div class="tw:bg-[var(--o2-primary-btn-bg)] tw:text-[var(--o2-primary-btn-text)] tw:text-center">
  <WebinarBanner v-if="config.isCloud === 'true'" variant="header" />
</div>
```

The wrapper forces primary-button colors on the banner. `WebinarBanner.vue` itself defines its own colors via `.webinar-top-bar`. The wrapper colors may bleed through link/button children if the inner styles don't fully override — visual regression risk.

**Solution:**
```diff
-<div class="tw:bg-[var(--o2-primary-btn-bg)] tw:text-[var(--o2-primary-btn-text)] tw:text-center">
-  <WebinarBanner v-if="config.isCloud === 'true'" variant="header" />
-</div>
+<WebinarBanner v-if="config.isCloud === 'true'" variant="header" />
```
Let `WebinarBanner` own its colors via its own `.webinar-top-bar` styles.

## Component Migration Issues

### 19. Tailwind `tw:` prefix verification

The migration uses `tw:` as the Tailwind prefix everywhere (Header, MenuLink, MainLayout, AutoRefreshInterval). All looked correctly formatted. Inline arbitrary values like `tw:top-[var(--navbar-height,2.25rem)]`, `tw:bg-[var(--o2-primary-btn-bg)]`, and `tw:size-6` are syntactically valid. No broken Tailwind classes found.

### 20. Components migrated cleanly

- `q-layout` → `<div class="o2-app-root ...">` ✅
- `q-header` → `<header class="o2-app-header">` ✅ (but not sticky — issue #4)
- `q-drawer` + `q-list` + `menu-link` loop → `<ONavbar>` ✅
- `q-page-container` → `<main class="o2-content-scroll">` ✅
- `q-dialog` → `<ODialog>` ✅
- `q-toolbar` → `<div class="tw:flex tw:items-center ...">` in Header ✅
- `q-item` → `<a>` / `<router-link>` in MenuLink ✅
- `q-icon` → `<OIcon>` ✅
- `q-select` (org switcher) → `<ODropdown>` + `<OTable>` with built-in search ✅
- `q-btn-dropdown` → `<ODropdown>` ✅

### 21. AutoRefreshInterval migration

`AutoRefreshInterval.vue` is now pure O2 components (`OButton`, `ODropdown`, `OIcon`, `OTooltip`). Diff is +130/-130 lines. The compact-mode toggle (`isCompact` prop) still works — both branches in template render correctly. No leftover Quasar refs.

### 22. ThemeSwitcher uses `<OButton variant="ghost" size="icon-circle-sm">`

`ThemeSwitcher.vue:18-21` is now a single OButton. The dark-mode store sync (`:62-76`) preserves bidirectional sync between local ref + Vuex state. The only regression: the body class is not toggled (issue #2).

### 23. Unused imports in MainLayout.vue

`MainLayout.vue:177` `ThemeSwitcher` — moved into Header, still imported & registered (`:212`).
`MainLayout.vue:183` `ManagementIcon` — declared in `components` (`:211`) but never used in template.
`MainLayout.vue:192` `OIcon` — never used in template.

**Solution:**
```diff
-import ThemeSwitcher from "@/components/ThemeSwitcher.vue";
-import ManagementIcon from "@/assets/icons/management.vue";
-import OIcon from "@/lib/core/Icon/OIcon.vue";
 // ...
 components: {
-  ThemeSwitcher,
-  ManagementIcon,
-  OIcon,
   ...
 },
```

### 24. Webinar banner is wrapped twice

`MainLayout.vue:23-27` wraps `<WebinarBanner v-if="config.isCloud === 'true'" variant="header" />` in a div that applies primary-button background. But `WebinarBanner.vue` already has its own `.webinar-top-bar` styling. Effectively a redundant wrapper that may cause visual issues.

**Solution:** see Issue #18 — drop the outer `<div class="tw:bg-[var(--o2-primary-btn-bg)] …">` wrapper. `WebinarBanner` owns its layout.

## Test File Issues

### 25. Spec files universally broken — `installQuasar` import

(See Critical Issue #1.) All ~580 spec files importing `installQuasar` will fail at the import step with `SyntaxError: The requested module '...install-quasar-plugin' does not provide an export named 'installQuasar'`. CI will be red on the entire test suite.

**Solution:** see Critical #1 — add `export const installQuasar = (_options?: any) => tempQuasarPlugin();` to the helper. One-line fix unblocks all ~580 specs.

### 26. `MainLayout.spec.ts` integration tests skipped

`MainLayout.spec.ts:85` `describe.skip("Main Layout Component", ...)` — explicit acknowledgment that the integration tests cannot run because of dependency-injection complexity. Only the `describe("MainLayout Methods and Functions", ...)` block runs (134 nominal tests). This is a *significant* regression in coverage — the actual component is no longer truly exercised by integration tests.

**Solution:**
```diff
-describe.skip("Main Layout Component", () => {
+describe("Main Layout Component", () => {
   // re-mount with shallowMount({ global: { stubs: { ONavbar: true, Header: true, ... } } })
 });
```

### 27. Spec test refers to stale internals

`MainLayout.spec.ts:263` and `:1152` etc. test `filteredOrganizations` and `searchQuery` helpers, but these helpers were inlined as local logic in `Header.vue` per issue #6 of the diff (`MainLayout.vue` no longer owns `filteredOrganizations`, `searchQuery`, or `rowsPerPage`). The test still defines and asserts on a local copy of the logic but the implementation it should be guarding has moved out of `MainLayout` entirely. Tests pass but no longer validate the real production code.

**Solution:** move these tests into `Header.spec.ts`:
```diff
-// MainLayout.spec.ts — remove
-it("filteredOrganizations works", () => { ... });
+// Header.spec.ts — add
+it("filteredOrganizations works", () => {
+  const w = mount(Header, { ... });
+  // assert against w.vm.filteredOrganizations
+});
```

### 28. `Header.spec.ts` still asserts on `update:searchQuery` event

`Header.spec.ts:724-731`: emits and asserts on `update:searchQuery`. But in the migrated `Header.vue`, `searchQuery` is internal state, not a prop or emit (`Header.vue:720, 734-742`). Component no longer emits `update:searchQuery`. Test will pass because `wrapper.vm.$emit("update:searchQuery", "test")` manually triggers the emit at the wrapper layer — it bypasses the component logic and is a false positive.

**Solution:**
```diff
-it("emits update:searchQuery", async () => {
-  wrapper.vm.$emit("update:searchQuery", "test");
-  expect(wrapper.emitted("update:searchQuery")).toBeTruthy();
-});
+it("updates internal searchQuery on input", async () => {
+  await wrapper.findComponent(OInput).setValue("test");
+  expect(wrapper.vm.searchQuery).toBe("test");
+});
```

### 29. AutoRefreshInterval spec leftover Quasar stubs

`AutoRefreshInterval.spec.ts:45-74` defines stubs for `q-btn-dropdown`, `q-btn`, `q-tooltip`, `q-menu` — none of which appear in the migrated component anymore. The OButton/ODropdown stubs at lines 55-66 are the correct ones. The leftover `q-*` stubs are dead.

**Solution:**
```diff
 stubs: {
-  "q-btn-dropdown": true,
-  "q-btn": true,
-  "q-tooltip": true,
-  "q-menu": true,
   OButton: true,
   ODropdown: true,
 },
```

## Recommendations

1. **Fix `installQuasar` export** (critical, blocks all unit tests). Either restore the symbol as an alias in `install-quasar-plugin.ts` (`export const installQuasar = tempQuasarPlugin;` accepting an ignored options arg) or codemod every `.spec.ts` to use `tempQuasarPlugin()`. This is the highest-impact one-line fix.
2. **Restore `body--dark` / `body--light` class toggling** alongside `<html>.dark` in `ThemeSwitcher.vue:78-88`, `PredefinedThemes.vue:314`, `General.vue:918`, and `utils/theme.ts:100`. Until then, ~189 selectors and `convertLogData.ts:101` are dead in dark mode.
3. **Restore drawer collapse / mobile responsive navigation**. Make `leftDrawerOpen` a ref, add a hamburger toggle in `Header.vue` for screens <500px, and wire a window resize listener (or a `matchMedia` watcher) to auto-open/close like Quasar's `show-if-above` + `:breakpoint="500"` used to do.
4. **Anchor the header**. Add `position: sticky; top: 0; z-index: <appropriate>` to `.o2-app-header` (in `app.scss` or `MainLayout.vue`'s scoped style), or document why it doesn't need to be.
5. **Fix `:global(body)` and `:deep()` misuse** in MainLayout (issue #12) and MenuLink unscoped block (issue #13).
6. **Hoist `.left-drawer` rules** out of `MainLayout.vue`'s scoped style into either an unscoped block or `ONavbar.vue` (issue #14).
7. **Define `--q-primary-rgb`** alongside the existing `--q-primary` alias in `_variables.scss`, or remove the leftover `var(--q-primary-rgb)` references in `EnterpriseUpgradeDialog.vue` (lines 1346-1485) and `logs/json-preview.scss:75`.
8. **Strip dead exports**: remove `splitterModel`, `expandMenu`, `prefetch`, `"settings": "settings"`, unused `ThemeSwitcher`/`ManagementIcon`/`OIcon` imports/registrations from `MainLayout.vue`.
9. **Clean MenuLink props**: declare `linkName`, `animationIndex`, `exact`, `name`, `display`, `hide` (or strip them from the link list spread in `MainLayout.vue:331-394`) to avoid silent attribute fallthrough.
10. **Remove `relative-position` Quasar utility class** from `Header.vue:24,114`.
11. **Reconcile `--navbar-height` initial value** between `_quasar-variables.scss:51` (`36px`) and the runtime watcher in `MainLayout.vue:479` (`2.5rem` = 40px).
12. **Unskip and rewrite `MainLayout` integration tests** to use Vue Test Utils 2 with shallowMount + dependency stubs; the `describe.skip` at `MainLayout.spec.ts:85` removes coverage of the actual component.
13. **Update Header.spec.ts** to reflect that `searchQuery` is internal; remove the `update:searchQuery` emit assertion.
14. **Strip leftover Quasar stubs** from `AutoRefreshInterval.spec.ts:45-74` (`q-btn-dropdown`, `q-btn`, `q-tooltip`, `q-menu`).
15. **Decide on accessibility additions**: add a skip-to-main-content link (`<a href="#main-content" class="sr-only focus:not-sr-only">`) at the top of the new layout. The original Quasar layout had none either, but this is a known accessibility improvement opportunity now that the shell is being rewritten.


## Class-Level Styling Audit

### 1. Quasar Class Leftovers
*(none found in audited layout files — `q-*` template classes have been fully removed)*

### 2. Bare Quasar Utility Classes
| File:Line | Class | Replacement | Layer |
|---|---|---|---|
| `web/src/components/Header.vue:24` | `relative-position` | `tw:relative` | File-scoped |
| `web/src/components/Header.vue:114` | `relative-position` | `tw:relative` | File-scoped |
| `web/src/components/AutoRefreshInterval.vue:18` | `float-left` (conditional class) | `tw:float-left` | File-scoped |
| `web/src/components/AutoRefreshInterval.vue:104` | `text-primary` | `tw:text-[var(--o2-primary)]` | File-scoped |

### 3. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|---|---|---|---|
| `web/src/components/Header.vue:99` | `hover:tw:opacity-80` | `tw:hover:opacity-80` | File-scoped |
| `web/src/components/Header.vue:116` | `hover:tw:opacity-80` | `tw:hover:opacity-80` | File-scoped |

### 4. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| `web/src/components/WebinarBanner.vue:246,249,251,261,306,313` | `var(--q-secondary)` | `var(--o2-secondary)` | File-scoped (6 sites) |
| `web/src/components/EnterpriseUpgradeDialog.vue:1072,1224,1289,1365,1399,1413,1414,1481,1485,1486` | `var(--q-primary)` | `var(--o2-primary)` | File-scoped (10 sites) |
| `web/src/components/EnterpriseUpgradeDialog.vue:1346,1347,1361,1398,1466,1467,1472,1480` | `var(--q-primary-rgb)` | Add `--o2-primary-rgb` token, then replace | Global + File-scoped (8 sites) |

### 5. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|---|---|---|---|
| `web/src/components/MenuLink.vue:398` | `body.body--light &` | Replace with `html:not(.dark) &` | File-scoped |
| `web/src/components/MenuLink.vue:452` | `body.body--light &` | Replace with `html:not(.dark) &` | File-scoped |
| `web/src/components/MenuLink.vue:464` | `body.body--dark &` | Replace with `html.dark &` | File-scoped |
| `web/src/components/Header.vue:810` | `body.body--dark &` | Replace with `html.dark &` | File-scoped |
| `web/src/components/Header.vue:853` | `body.body--dark &` | Replace with `html.dark &` | File-scoped |
| `web/src/components/Header.vue:882` | `body.body--dark &` | Replace with `html.dark &` | File-scoped |
| `web/src/components/EnterpriseUpgradeDialog.vue:1432` | `body.body--dark { ... }` | `html.dark { ... }` | File-scoped |

### 6. Quasar SCSS Variables in Scoped Styles
*(none found)*

### 7. Quasar Directives
*(none found — `v-close-popup` / `v-ripple` fully removed from layout files)*

### 8. Icon Migration
*(none found — no underscored OIcon names, no `:color` prop in audited layout files)*

### 9. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
|---|---|---|
| `web/src/components/Header.vue:60,70,81,89` | `max-width: 150px; max-height: 32px` (4 duplicate `<img>` sizes) | `.openobserve-logo { max-width: 150px; max-height: 32px }` partial |
| `web/src/components/Header.vue:141` | `display: inline` | `tw:inline` |
| `web/src/components/Header.vue:187` | `:style="{ color: ingestionQuotaColor }"` (dynamic) | Keep dynamic, but document |
| `web/src/components/Header.vue:204` | `width: 18px; height: 18px` (ai-icon) | `.header-icon.ai-icon` already exists — move there |
| `web/src/components/Header.vue:219` | `max-width: 250px` | `tw:max-w-[250px]` |
| `web/src/components/Header.vue:252` | `width: 470px; min-height: 420px; height: 420px` | `.org-popover` scoped class |
| `web/src/components/EnterpriseUpgradeDialog.vue:51` | `width: 40px; height: 40px` | `tw:w-10 tw:h-10` |
| `web/src/components/EnterpriseUpgradeDialog.vue:56` | `width: 200px; height: 44px` | `tw:w-[200px] tw:h-11` |
| `web/src/components/EnterpriseUpgradeDialog.vue:76,83` | `height: 150px; width: 100%` (chart skeleton) | `.usage-chart-container` already exists — extend |
| `web/src/components/EnterpriseUpgradeDialog.vue:89` | `color: rgba(255,255,255,0.7); font-size:10px; ...` | `.upgrade-meta-text` scoped class |
| `web/src/components/AutoRefreshInterval.vue:43,61,114,137` | `text-align: center` (4 dupes) | `tw:text-center` |
| `web/src/layouts/MainLayout.vue:71` | `:style="{ ... }"` (computed) | OK if computed; otherwise tokenize |
| `web/src/layouts/MainLayout.vue:100` | `:style="[ ... ]"` (computed array) | OK if computed |

### 10. Duplicate Style Blocks (candidates for partial)
| Files | Duplicated block | Suggested partial |
|---|---|---|
| `Header.vue:60,70,81,89` | `.openobserve-logo` sizing (4 occurrences in template) | Single `.openobserve-logo` class in `Header.vue` scoped style (already present at line 99/116 but template still uses inline `style`) |
| `Header.vue:810,853,882` | `body.body--dark &` overrides for language menu | One `html.dark .language-menu { ... }` block |
| `MenuLink.vue:398,452,464` | `body.body--light/dark &` nav active-state | One `html.dark .nav-active { ... }` partial |
| `AutoRefreshInterval.vue:43,61,114,137` | `text-align: center` on `tw:flex tw:flex-col tw:w-full tw:p-2` | `.auto-refresh-panel-row` scoped class |

### 11. Layer Summary
- Global (`app.scss`) changes needed: 3 (define `--o2-primary-rgb`, define `--o2-secondary`, global `body--dark` → `html.dark` policy if not already)
- Component-level partial changes: 3 (logo sizing, language-menu dark, nav-active partial)
- File-level scoped changes: ~30 (Quasar var renames, `body--dark` rewrites, `hover:tw:` order fixes, inline-style → utility conversions)

