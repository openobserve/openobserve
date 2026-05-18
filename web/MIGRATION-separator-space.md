# Migration: `q-separator` → `OSeparator` & `q-space` → `<div class="tw:flex-1">`

> **Scope**: All `.vue` files under `web/src/`
> **Status**: 0 / ~140 files migrated

---

## Part 1 — `q-separator` → `OSeparator`

### Component status

`OSeparator` is **built and ready** at `web/src/lib/core/Separator/OSeparator.vue`.

```ts
import OSeparator from '@/lib/core/Separator/OSeparator.vue'
```

It wraps Reka UI `Separator` — correct `role="separator"` and `aria-orientation` out of the box.  
Dark mode is handled automatically by design tokens — no conditionals needed.

---

### Prop mapping

| `q-separator` prop | `OSeparator` equivalent | Notes |
|---|---|---|
| _(none)_ | `<OSeparator />` | Default horizontal |
| `vertical` | `vertical` | Direct — only prop on `OSeparator` |
| `inset` | `class="tw:mx-4"` (horizontal) / `class="tw:my-2"` (vertical) | Drop prop — use Tailwind class |
| `spaced` | `class="tw:my-2"` | Drop prop — use Tailwind class |
| `horizontal` | _(drop)_ | Horizontal is the default |
| `color="grey-4"` | `class="tw:bg-separator-strong"` | Drop prop — use design token class |
| `color="white"` | `class="tw:bg-white"` | Drop prop — use Tailwind class |
| `size="2px"` | `class="tw:h-[2px]"` (horizontal) / `class="tw:w-[2px]"` (vertical) | Drop prop — use Tailwind class |
| `dark` | _(drop)_ | Design tokens handle dark mode |

---

### Quasar spacing class → Tailwind class

Carry these over on `class` — they go on `<OSeparator>` directly, not a wrapper:

| Quasar class | Tailwind equivalent |
|---|---|
| `class="q-my-sm"` | `class="tw:my-2"` |
| `class="q-my-md"` | `class="tw:my-4"` |
| `class="q-my-xs"` | `class="tw:my-1"` |
| `class="q-mt-sm"` | `class="tw:mt-2"` |
| `class="q-mt-md"` | `class="tw:mt-4"` |
| `class="q-mt-lg"` | `class="tw:mt-6"` |
| `class="q-mb-sm"` | `class="tw:mb-2"` |
| `class="q-mb-md"` | `class="tw:mb-4"` |
| `class="q-mb-xl"` | `class="tw:mb-8"` |
| `class="q-mt-lg q-mb-md"` | `class="tw:mt-6 tw:mb-4"` |
| `class="q-mx-md q-mt-md"` | `class="tw:mx-4 tw:mt-4"` |
| `class="q-mr-sm"` (vertical) | `class="tw:mr-2"` |
| `class="q-mr-md"` (vertical) | `class="tw:mr-4"` |
| `class="full-width"` | `class="tw:w-full"` |
| `class="full-height"` | `class="tw:h-full"` |

Inline styles:

| Inline style | Tailwind equivalent |
|---|---|
| `style="width: 100%"` | `class="tw:w-full"` |
| `style="margin-top: -1px; flex-shrink: 0"` | `class="tw:-mt-px tw:shrink-0"` |

Tailwind classes that are already on `q-separator` (e.g. `class="tw:my-[1rem]! tw:h-[1.875rem]! tw:w-[1px]"`) carry over to `<OSeparator>` unchanged.

---

### Standard replacements

```vue
<!-- simple horizontal -->
<q-separator />
→ <OSeparator />

<!-- vertical -->
<q-separator vertical />
→ <OSeparator vertical />

<!-- inset (adds side padding / indentation) -->
<q-separator inset />
→ <OSeparator class="tw:mx-4" />

<q-separator vertical inset />
→ <OSeparator vertical class="tw:my-2" />

<!-- spaced (adds vertical margin) -->
<q-separator spaced />
→ <OSeparator class="tw:my-2" />

<!-- horizontal is default — drop the prop -->
<q-separator horizontal />
→ <OSeparator />

<q-separator horizontal inset></q-separator>
→ <OSeparator class="tw:mx-4" />

<!-- with Quasar spacing class -->
<q-separator class="q-my-sm" />
→ <OSeparator class="tw:my-2" />

<q-separator class="q-mx-md q-mt-md" />
→ <OSeparator class="tw:mx-4 tw:mt-4" />

<!-- with inline style -->
<q-separator style="width: 100%" />
→ <OSeparator class="tw:w-full" />

<q-separator style="margin-top: -1px; flex-shrink: 0" />
→ <OSeparator class="tw:-mt-px tw:shrink-0" />

<!-- with v-if — just add it to OSeparator -->
<q-separator v-if="tab === 'json' || tab === 'table'" />
→ <OSeparator v-if="tab === 'json' || tab === 'table'" />

<!-- with data-test — preserve the attribute -->
<q-separator data-test="separator" vertical />
→ <OSeparator data-test="separator" vertical />
```

---

### Special-case rules

#### 1. Separators inside `q-menu` / `q-list` (Quasar context menus)

**Do NOT migrate these yet.** They sit inside `q-menu` > `q-list` structures in SearchBar.vue, Header.vue, and AlertList.vue. When those `q-menu` blocks are migrated to `ODropdown`, replace these with `<ODropdownSeparator />` at that time.

```vue
<!-- Inside q-menu > q-list — leave as-is until q-menu is migrated -->
<q-separator />  ← do NOT touch

<!-- Once migrated to ODropdown, use: -->
<ODropdownSeparator />
import ODropdownSeparator from '@/lib/overlay/Dropdown/ODropdownSeparator.vue'
```

Files affected: `SearchBar.vue` (lines 496, 534, 555, 617, 636, 734, 753, 798), `Header.vue` (lines 267, 278, 345, 413, 431), `AlertList.vue` (lines 365, 379, 391).

#### 2. Dark-mode hardcoded hex colors

These must be replaced with design tokens — not kept as conditional bindings:

```vue
<!-- BEFORE — manual dark/light branching -->
<q-separator :class="store.state.theme === 'dark' ? 'tw:bg-[#3A3A3A]' : 'tw:bg-[#E5E7EB]'" />
<q-separator :class="store.state.theme === 'dark' ? 'tw:bg-[#444444]' : 'tw:bg-[#D1D5DB]'" />

<!-- AFTER — token handles dark mode automatically -->
<OSeparator />                           <!-- uses --color-separator (default) -->
<OSeparator class="tw:bg-separator-strong" />  <!-- uses --color-separator-strong -->
```

Files: `AssociatedRegexPatterns.vue` lines 154, 203, 222, 252.

#### 3. Dark-mode theme conditional with `tw:!bg-grey-8`

```vue
<!-- BEFORE -->
<q-separator :class="store.state.theme === 'dark' ? 'tw:!bg-grey-8' : ''" class="tw:mb-3 tw:shrink-0" />

<!-- AFTER — drop the conditional, token handles dark mode -->
<OSeparator class="tw:mb-3 tw:shrink-0" />
```

File: `ServiceIdentitySetup.vue` line 1054.

#### 4. `size` prop → Tailwind class

The `size` prop does not exist on `OSeparator`. Convert to a Tailwind size class:

```vue
<!-- BEFORE -->
<q-separator class="tw:mb-1 tw:mt-[3px]" size="2px"></q-separator>

<!-- AFTER — size="2px" becomes tw:h-[2px] on a horizontal separator -->
<OSeparator class="tw:h-[2px] tw:mb-1 tw:mt-[3px]" />
```

Files: `FolderList.vue` line 36, `Dashboards.vue` lines 141–144.

#### 5. Scoped CSS targeting `.q-separator` by class name

The scoped CSS rule must be removed and replaced with a wrapper or dropped:

**`NodeForm/Stream.vue` — `display: none !important` on `.q-separator`**

```vue
<!-- This scoped rule hides q-separator inside a media query -->
.q-separator { display: none !important; }
```

After migration, the selector becomes useless since OSeparator renders a `<div>` via Reka UI without a `.q-separator` class. Update the selector to the actual DOM element Reka renders, or use `display: none` on a wrapper `<span>` around `<OSeparator>`:

```vue
<!-- Wrap OSeparator in a span and target the span in scoped CSS -->
<span class="separator-wrapper"><OSeparator /></span>

<style scoped>
@media (...) {
  .separator-wrapper { display: none; }
}
</style>
```

#### 6. `:deep()` selector targeting `.q-separator` (HomeView.vue)

```vue
/* BEFORE — hides separator rendered inside a child component */
.home-ai-panel :deep(.chat-content-wrapper > .q-separator) {
  display: none;
}
```

After the child component (`O2AIChat.vue`) migrates its `q-separator` to `OSeparator`, the `:deep` rule must also be updated. `OSeparator` renders a `<div>` with no Quasar class — the `:deep` must target the rendered `div[role="separator"]`:

```css
/* AFTER */
.home-ai-panel :deep(.chat-content-wrapper > [role="separator"]) {
  display: none;
}
```

Update `HomeView.vue` in the same PR as `O2AIChat.vue`.

#### 7. `var(--q-separator-color)` in scoped CSS borders

Several components use the Quasar CSS variable in `border` rules (no `<q-separator>` element — pure CSS):

```css
/* BEFORE */
border-bottom: 1px solid var(--q-separator-color);
border-top: 1px solid var(--q-separator-color);
```

Replace with the O2 design token:

```css
/* AFTER */
border-bottom: 1px solid var(--color-separator);
border-top: 1px solid var(--color-separator);
```

Files:
- `O2AIChat.vue` lines 71, 5621, 5666, 6417, 6444
- `SemanticFieldGroupsConfig.vue` lines 431, 451
- `ImportSemanticGroups.vue` line 606
- `ImportSemanticGroupsDrawer.vue` line 568

#### 8. `NodeSidebar.vue` — scoped CSS `.node-separator` class on `q-separator`

```vue
<!-- BEFORE -->
<q-separator vertical class="node-separator" />
```

The class is used for scoped CSS. After migration:

```vue
<!-- AFTER — keep the class on OSeparator, update the scoped rule selector if needed -->
<OSeparator vertical class="node-separator" />
```

Reka UI's `Separator` passes through unknown classes — `class="node-separator"` will land on the rendered `div`. The scoped CSS rule `.node-separator { ... }` continues to work as-is.

#### 9. `O2AIChat.vue` — separator with explicit Tailwind color override

```vue
<!-- BEFORE -->
<q-separator class="tw:bg-[#DBDBDB]" />

<!-- AFTER — keep the explicit color, it's intentional branding in the chat UI -->
<OSeparator class="tw:bg-[#DBDBDB]" />
```

---

### Import statement

Every file that uses `OSeparator` needs:

```ts
import OSeparator from '@/lib/core/Separator/OSeparator.vue'
```

If the file already imports other O2 components from `@/lib/`, add it alongside them. There is no barrel index — import each component directly.

---

### Files to migrate — `q-separator`

Legend: `[ ]` not done · `[x]` done

#### Tier 1 — High density (5+ occurrences)

- [ ] `src/plugins/logs/SearchBar.vue` — **14 occurrences** · Lines: 303, 496, 534, 555, 617, 636, 734, 753, 798, 961, 1062, 1198–1204 + 1907 · **Rule 1**: lines 496, 534, 555, 617, 636, 734, 753, 798 are inside `q-menu > q-list` — skip until q-menu migration. Lines 303, 961, 1062, 1198–1204, 1907 → `<OSeparator>`.
- [ ] `src/components/logstream/AssociatedRegexPatterns.vue` — **8 occurrences** · Lines: 28, 90, 136, 154, 203, 222, 252, 351 · **Rule 2**: lines 154, 203, 222, 252 have dark-mode hex bindings → drop conditional, use `<OSeparator>` (+ `class="tw:bg-separator-strong"` on line 222 only).
- [ ] `src/components/alerts/AlertHistory.vue` — **9 occurrences** · Lines: 287, 311, 356, 385, 396, 424 (all `class="q-my-sm"`) and 3 more → `<OSeparator class="tw:my-2" />`.
- [ ] `src/components/pipelines/PipelineHistory.vue` — **9 occurrences** · Lines: 279, 303, 346, 399, 410, 436 (all `class="q-my-sm"`) + more → `<OSeparator class="tw:my-2" />`.
- [ ] `src/components/O2AIChat.vue` — **7 occurrences** · Lines: 122 (`<q-separator />`), 176 (`class="tw:bg-[#DBDBDB]"`) → template migration. Lines 71, 5621, 5666, 6417, 6444 → CSS only (replace `var(--q-separator-color)` with `var(--color-separator)`). **Rule 6**: update `HomeView.vue` `:deep` selector in same PR.
- [ ] `src/plugins/pipelines/CustomNode.vue` — **6 occurrences** · Lines: 495, 585, 663, 728, 792, 856 (all `vertical class="q-mr-sm"`) → `<OSeparator vertical class="tw:mr-2" />`.
- [ ] `src/components/dashboards/addPanel/DashboardQueryBuilder.vue` — **6 occurrences** · Lines: 193 (`vertical class="q-mr-md"`), 356, 502, 649, 651, 666 → mix of horizontal and one vertical.
- [ ] `src/components/Header.vue` — **5 occurrences** · Lines: 267, 278, 345, 413, 431 — all inside `q-menu > q-list` → **Rule 1**: skip until q-menu migration.
- [ ] `src/components/rum/ResourceDetailDrawer.vue` — **5 occurrences** · Lines: 51 (`vertical`), 56 (`vertical`), 69 (`q-my-md`), 113 (`q-my-md`), 141 (`q-my-md`).
- [ ] `src/components/alerts/ImportSemanticGroupsDrawer.vue` — **5 occurrences** · Line 224 (`class="q-mb-md"`) → template. Line 568 → CSS only (`var(--q-separator-color)` → `var(--color-separator)`).

#### Tier 2 — Medium density (2–4 occurrences)

- [ ] `src/components/DateTime.vue` — **4 occurrences** · L59: `vertical inset`, L70: plain, L182: `v-if !disableRelative class="q-my-sm"`, L236: `class="q-my-sm"`.
- [ ] `src/components/dashboards/PanelEditor/PanelEditor.vue` — **4 occurrences** · L38: `vertical`, L160: `v-if`, L309: `vertical`, L627: `vertical`.
- [ ] `src/components/pipeline/PipelinesList.vue` — **4 occurrences** · L222, L243, L257.
- [ ] `src/components/settings/ServiceIdentitySetup.vue` — **4 occurrences** · L275: inside `<span class="tw:flex-1">`, L1054: dark-mode conditional (**Rule 3**).
- [ ] `src/components/dashboards/addPanel/DashboardGeoMapsQueryBuilder.vue` — **4 occurrences** · L136, L254, L372, L374.
- [ ] `src/components/dashboards/addPanel/DashboardSankeyChartBuilder.vue` — **4 occurrences** · L140, L262, L384, L386.
- [ ] `src/components/QueryPlanDialog.vue` — **3 occurrences** · L35, L81, L147.
- [ ] `src/components/alerts/AlertList.vue` — **3 occurrences** · L365, L379, L391 — all inside `q-menu > q-list` → **Rule 1**: skip until q-menu migration.
- [ ] `src/components/alerts/SemanticFieldGroupsConfig.vue` — **2 template + 2 CSS** · CSS lines 431, 451 → `var(--color-separator)`. **Rule 7**.
- [ ] `src/components/alerts/ImportSemanticGroups.vue` — **1 CSS** · Line 606 → `var(--color-separator)`. **Rule 7**.
- [ ] `src/components/dashboards/addPanel/DashboardMapsQueryBuilder.vue` — **3 occurrences** · L140, L263, L265.
- [ ] `src/components/DateTimePicker.vue` — **3 occurrences** · L48: `vertical inset`, L60: plain, L128: `q-my-sm`.
- [ ] `src/plugins/logs/DetailTable.vue` — **3 occurrences** · L72: plain, L337: `v-if`.
- [ ] `src/plugins/traces/ServiceGraph.vue` — **3 occurrences** · L109.
- [ ] `src/views/CorrelationDemo.vue` — **3 occurrences** · L11, L74 (`q-my-md`).
- [ ] `src/components/alerts/ImportSemanticGroupsDrawer.vue` — see Tier 1 for remaining.
- [ ] `src/components/dashboards/settings/VariableQueryValueSelector.vue` — **2 occurrences** · L48, L57 (`v-if`).
- [ ] `src/components/functions/AddEnrichmentTable.vue` — **2 occurrences** · L29, L117 (`v-if` + `q-my-xs`).
- [ ] `src/components/ingestion/recommended/KubernetesConfig.vue` — **2 occurrences** · L47 (`tw:mb-6`), L112.
- [ ] `src/components/logstream/schema.vue` — **2 occurrences** · L754 (`tw:my-4`).
- [ ] `src/components/pipeline/NodeSidebar.vue` — **2 occurrences** · L63 (`vertical class="node-separator"` — **Rule 8**), L77.
- [ ] `src/components/pipeline/NodeForm/AssociateFunction.vue` — **2 occurrences**.
- [ ] `src/components/pipeline/NodeForm/Stream.vue` — **scoped CSS only** · `.q-separator { display: none !important }` → **Rule 5**: wrap with `<span class="separator-wrapper">`.
- [ ] `src/components/pipeline/PipelinesList.vue` — see above.
- [ ] `src/components/rum/EventDetailDrawerContent.vue` — **2 occurrences**.
- [ ] `src/components/rum/errorTracking/view/ErrorTags.vue` — **2 occurrences** · L32, L44 (both `vertical`).
- [ ] `src/components/settings/AddRegexPattern.vue` — **2 occurrences** · L158 (`tw:my-2`).
- [ ] `src/components/settings/BuiltInPatternsTab.vue` — **2 occurrences**.
- [ ] `src/components/settings/ModelPricingList.vue` — **2 occurrences** · L439 (`tw:mb-4`).
- [ ] `src/components/shared/HomeViewSkeleton.vue` — **2 occurrences** · L100, L131 (both `vertical`).
- [ ] `src/enterprise/components/billings/enterprisePlan.vue` — **2 occurrences** · L33 (`spaced`), L58.
- [ ] `src/enterprise/components/billings/proPlan.vue` — **2 occurrences** · L34 (`spaced`), L64.
- [ ] `src/plugins/correlation/DimensionFilterEditor.vue` — **2 occurrences**.
- [ ] `src/plugins/correlation/TimeRangeEditor.vue` — **2 occurrences**.
- [ ] `src/plugins/logs/SyntaxGuide.vue` — **2 occurrences** · L35, L112.
- [ ] `src/plugins/logs/components/FieldListPagination.vue` — **2 occurrences**.
- [ ] `src/plugins/logs/patterns/PatternDetailsDialog.vue` — **2 occurrences**.
- [ ] `src/plugins/metrics/SyntaxGuideMetrics.vue` — **2 occurrences** · L32, L66.
- [ ] `src/plugins/traces/SyntaxGuide.vue` — **2 occurrences** · L35, L84.
- [ ] `src/views/Dashboards/Dashboards.vue` — **2 occurrences** · L141–144: has `size="2px"` prop — **Rule 4** → `<OSeparator class="tw:h-[2px] tw:mb-1 tw:mt-[3px]" />`.
- [ ] `src/views/DetailTable.vue` — **2 occurrences** · L31, L37.
- [ ] `src/views/PromQL/QueryBuilder.vue` — **2 occurrences** · L11, L35.
- [ ] `src/components/dashboards/addPanel/DashboardErrors.vue` — **1 template + q-space** · L19.
- [ ] `src/components/pipelines/CreateBackfillJobDialog.vue` — **2 occurrences**.
- [ ] `src/components/settings/ModelPricingList.vue` — see above.
- [ ] `src/plugins/traces/SearchBar.vue` — **2 occurrences** · L228: `v-if … class="tw:h-[1.875rem]! tw:w-[1px]"` (carries through unchanged).
- [ ] `src/components/alerts/AlertInsights.vue` — **1 alert + q-space**.
- [ ] `src/components/shared/grid/Pagination.vue` — **1 occurrence** · L91: `vertical inset class="q-mr-md"` → `<OSeparator vertical class="tw:my-2 tw:mr-4" />`.

#### Tier 3 — Low density (1 occurrence)

- [ ] `src/components/AutoRefreshInterval.vue` — L53.
- [ ] `src/components/NLModeQueryBar.vue` — `class="tw:h-[29px] tw:w-[1px]"` (carries through).
- [ ] `src/components/PredefinedThemes.vue` — L196 (`class="q-mb-sm"`).
- [ ] `src/components/TelemetryCorrelationPanel.vue` — L108.
- [ ] `src/components/ai_toolsets/AddAiToolset.vue` — L35.
- [ ] `src/components/alerts/AddTemplate.vue` — `style="width: 100%"` → `class="tw:w-full"`.
- [ ] `src/components/alerts/AlertHistoryDrawer.vue`.
- [ ] `src/components/alerts/DeduplicationConfig.vue` — L33 (`class="tw:my-2"`).
- [ ] `src/components/alerts/DestinationPreview.vue`.
- [ ] `src/components/alerts/ImportAlert.vue` — L92 (`class="q-mx-md q-mt-md"`).
- [ ] `src/components/alerts/ImportDestination.vue` — L45 (`class="q-mx-md q-mt-md"`).
- [ ] `src/components/alerts/ImportTemplate.vue` — L45 (`class="q-mx-md q-mt-md"`).
- [ ] `src/components/alerts/OrganizationDeduplicationSettings.vue` — L37 (`class="tw:mb-6"`).
- [ ] `src/components/cipherkeys/AddCipherKey.vue` — L41.
- [ ] `src/components/common/BaseImport.vue` — L193 (`class="q-mx-md q-mt-md"`).
- [ ] `src/components/common/GroupHeader.vue` — L24.
- [ ] `src/components/common/JsonEditor.vue` — *(also has q-space — see Part 2)*.
- [ ] `src/components/common/sidebar/AddFolder.vue`.
- [ ] `src/components/common/sidebar/FolderList.vue` — L36: `size="2px"` prop — **Rule 4** → `<OSeparator class="tw:h-[2px] tw:mb-1 tw:mt-[3px]" />`.
- [ ] `src/components/common/sidebar/MoveAcrossFolders.vue`.
- [ ] `src/components/dashboards/AddDashboard.vue`.
- [ ] `src/components/dashboards/AddFolder.vue`.
- [ ] `src/components/dashboards/AddDashboardFromGitHub.vue`.
- [ ] `src/components/dashboards/MoveDashboardToAnotherFolder.vue`.
- [ ] `src/components/dashboards/PanelSchemaRenderer.vue` — L254.
- [ ] `src/components/dashboards/addPanel/PanelSidebar.vue` — L40: `style="margin-top: -1px; flex-shrink: 0"` → `class="tw:-mt-px tw:shrink-0"`.
- [ ] `src/components/dashboards/addPanel/customChartExamples/CustomChartTypeSelector.vue` — L58 *(also has q-space — see Part 2)*.
- [ ] `src/components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue` — L68 (`v-if`).
- [ ] `src/components/dashboards/settings/VariableCustomValueSelector.vue`.
- [ ] `src/components/dashboards/settings/common/DashboardHeader.vue` — L39 (`class="q-mb-sm"`).
- [ ] `src/components/dashboards/tabs/AddTab.vue`.
- [ ] `src/components/dashboards/viewPanel/ViewPanel.vue` — L94 (`<q-separator></q-separator>`).
- [ ] `src/components/functions/EnrichmentSchema.vue`.
- [ ] `src/components/functions/StreamRouting.vue` — L13.
- [ ] `src/components/iam/groups/AddGroup.vue`.
- [ ] `src/components/iam/groups/EditGroup.vue` — L27.
- [ ] `src/components/iam/organizations/AddUpdateOrganization.vue`.
- [ ] `src/components/iam/roles/AddRole.vue`.
- [ ] `src/components/iam/roles/EditRole.vue`.
- [ ] `src/components/iam/serviceAccounts/AddServiceAccount.vue`.
- [ ] `src/components/iam/users/AddUser.vue`.
- [ ] `src/components/iam/users/UpdateRole.vue`.
- [ ] `src/components/ingestion/recommended/AWSConfig.vue` — L38 (`class="tw:mb-6"`).
- [ ] `src/components/ingestion/recommended/AWSQuickSetup.vue` — L280 (`class="tw:mb-4"`).
- [ ] `src/components/ingestion/recommended/AzureQuickSetup.vue` — L78.
- [ ] `src/components/ingestion/recommended/FrontendRumConfig.vue` — L23 (`class="q-my-sm"`).
- [ ] `src/components/logstream/AddStream.vue`.
- [ ] `src/components/pipeline/ImportPipeline.vue` — L43 (`class="q-mx-md q-mt-md"`).
- [ ] `src/components/pipeline/PipelineEditor.vue` — L67 (`class="q-mb-sm q-px-sm"` → `class="tw:mb-2 tw:px-2"`).
- [ ] `src/components/pipeline/NodeForm/Condition.vue`.
- [ ] `src/components/pipeline/NodeForm/ExternalDestination.vue` — L44.
- [ ] `src/components/pipeline/NodeForm/LlmEvaluation.vue`.
- [ ] `src/components/pipeline/NodeForm/Query.vue`.
- [ ] `src/components/pipeline/NodeForm/ScheduledPipeline.vue` — commented out, skip.
- [ ] `src/components/pipelines/BackfillJobDetails.vue`.
- [ ] `src/components/pipelines/BackfillJobsList.vue`.
- [ ] `src/components/pipelines/EditBackfillJobDialog.vue`.
- [ ] `src/components/promql/components/PromQLBuilderOptions.vue` — L3.
- [ ] `src/components/queries/QueryList.vue` — L26.
- [ ] `src/components/rum/PlayerEventsSidebar.vue` — L73 (`class="q-mt-sm"`).
- [ ] `src/components/rum/correlation/TraceCorrelationCard.vue` — L154 (`class="q-my-md"`).
- [ ] `src/components/rum/errorTracking/view/ErrorStackTrace.vue` — L34 (`class="q-mb-sm"`).
- [ ] `src/components/rum/errorTracking/view/ErrorTag.vue` — L20: `data-test="separator" vertical` → `<OSeparator data-test="separator" vertical />`.
- [ ] `src/components/settings/DiscoveredServices.vue` — L368.
- [ ] `src/components/settings/DomainManagement.vue` — L165 (`class="q-mb-xl"`).
- [ ] `src/components/settings/ImportModelPricing.vue` — L45 (`class="q-mx-md q-mt-md"`).
- [ ] `src/components/settings/ImportRegexPattern.vue` — L46 (`class="q-mx-md q-mt-md"`).
- [ ] `src/components/settings/OrganizationSettings.vue` — L60 (`class="q-mt-lg q-mb-md"`).
- [ ] `src/components/settings/OrgStorageSettings.vue` — L210, L242 (`v-if`).
- [ ] `src/plugins/logs/SearchHistory.vue`.
- [ ] `src/plugins/logs/SearchJobInspector.vue`.
- [ ] `src/plugins/logs/SearchSchedulersList.vue`.
- [ ] `src/plugins/metrics/AddToDashboard.vue`.
- [ ] `src/plugins/metrics/MetricLegends.vue` — L16.
- [ ] `src/plugins/traces/ServiceGraphNodeSidePanel.vue` — L147 (`class="tw:my-[1rem]!"`).
- [ ] `src/plugins/traces/TraceDetailsSidebar.vue` — L337 (`style="width: 100%"`).
- [ ] `src/views/HomeView.vue` — **scoped CSS only** · L325: `:deep(.chat-content-wrapper > .q-separator)` → **Rule 6**: migrate in same PR as `O2AIChat.vue`.
- [ ] `src/views/Dashboards/DashboardJsonEditor.vue`.
- [ ] `src/views/Dashboards/DashboardSettings.vue`.
- [ ] `src/views/Dashboards/ImportDashboard.vue` — L196 (`class="q-mt-md"`).
- [ ] `src/views/Dashboards/PanelLayoutSettings.vue`.
- [ ] `src/views/Dashboards/ViewDashboard.vue` — L240 (`<q-separator></q-separator>`).
- [ ] `src/views/Dashboards/addPanel/AddCondition.vue` — L54 (`<q-separator></q-separator>`).
- [ ] `src/views/RUM/ErrorViewer.vue` — L37 (`class="full-width"`).
- [ ] `src/views/RUM/SessionViewer.vue` — L84 (`vertical class="full-height"`).
- [ ] `src/views/RUM/SourceMaps.vue` — L79.

---

---

## Part 2 — `q-space` → `<div class="tw:flex-1" />`

### Why no O2 component / Reka UI primitive

`q-space` renders a single element with `flex: 10000 1 0%`. It has no ARIA role, no design tokens, no visual output. It is a **pure layout utility** — Reka UI is for ARIA-complex primitives only. 15 occurrences across 10 files do not justify a new O2 component.

### Replacement

```vue
<!-- BEFORE -->
<q-space />
<q-space></q-space>

<!-- AFTER -->
<div class="tw:flex-1" />
```

`tw:flex-1` expands to `flex: 1 1 0%`. In all 15 usages the parent is a flex row with no competing high-flex-grow siblings, so this is functionally identical to Quasar's `flex: 10000 1 0%`.

No import needed.

### Files to migrate — `q-space`

| File | Line(s) | Notes |
|---|---|---|
| `src/components/PredefinedThemes.vue` | 62, 102, 136, 176 | 4 occurrences in flex rows |
| `src/components/QueryPlanDialog.vue` | 69 | flex row spacer |
| `src/components/common/JsonEditor.vue` | 34 | `<q-space></q-space>` long-form |
| `src/components/queries/RunningQueries.vue` | 23 | pushes toolbar controls to right |
| `src/components/dashboards/PanelContainer.vue` | 41 | flex row spacer |
| `src/components/dashboards/panels/TableRenderer.vue` | 49 | flex row spacer |
| `src/components/dashboards/panels/PromQLTableChart.vue` | 54 | flex row spacer |
| `src/plugins/traces/SearchResult.vue` | 69 | flex row spacer |
| `src/components/dashboards/addPanel/customChartExamples/CustomChartTypeSelector.vue` | 35 | flex row spacer (also has q-separator on L58) |
| `src/components/dashboards/addPanel/DashboardErrors.vue` | 32 | flex row spacer (also has q-separator on L19) |
| `src/components/alerts/AlertInsights.vue` | 217 | flex row spacer |

**Checklist:**

- [ ] `src/components/PredefinedThemes.vue`
- [ ] `src/components/QueryPlanDialog.vue`
- [ ] `src/components/common/JsonEditor.vue`
- [ ] `src/components/queries/RunningQueries.vue`
- [ ] `src/components/dashboards/PanelContainer.vue`
- [ ] `src/components/dashboards/panels/TableRenderer.vue`
- [ ] `src/components/dashboards/panels/PromQLTableChart.vue`
- [ ] `src/plugins/traces/SearchResult.vue`
- [ ] `src/components/dashboards/addPanel/customChartExamples/CustomChartTypeSelector.vue`
- [ ] `src/components/dashboards/addPanel/DashboardErrors.vue`
- [ ] `src/components/alerts/AlertInsights.vue`
