# Reports Page — Quasar Removal Audit

## Summary

Audit of the Reports page after the Quasar Framework removal refactor. Scope: scheduled and cached reports list, create/edit report (3-step stepper with dashboard selection, schedule, share/recipients). RCA reports are not a standalone reports feature (only `web/src/components/alerts/RcaReport.scss` exists, scoped to `IncidentDetailDrawer.vue`), so they are out of scope.

The migration converted Quasar primitives (`q-input`, `q-select`, `q-toggle`, `q-stepper`, `q-table`, `q-dialog`, `q-tooltip`, `q-icon`, `q-date`, `q-time`, `q-banner`, `q-form`, `q-splitter`) to OpenObserve's O* components and `useQuasar()` notifications to the new `toast()` helper. Validation moved from Quasar rule props to manual `*Error` refs.

Several high-impact bugs slipped in during the migration — notably a date-format mismatch between `ODate` (ISO `YYYY-MM-DD`) and `convertDateToTimestamp` (`DD-MM-YYYY`) that will silently corrupt scheduled-report timestamps; a `timezoneOptions` array of bare strings passed to `OSelect` (expects `{label, value}` objects); broken Quasar-only props/slots that no longer do anything (`v-bind:disable`, `v-slot:hint`, `v-slot:option`); a tooltip-text regex replacement accident ("inline" → "tw:inline"); and tooltip-trigger scope regressions where `OTooltip` is now a sibling of the icon rather than nested. Both spec files reference removed identifiers and will fail.

## Files Audited

- `web/src/components/reports/CreateReport.vue` (1779 lines, +321 / -495)
- `web/src/components/reports/ReportList.vue` (751 lines, +189 / -226)
- `web/src/components/reports/CreateReport.spec.ts` (+2 / -3)
- `web/src/components/reports/ReportList.spec.ts` (+120 / -44)
- `web/src/components/reports/ReportList.spec.js` (+148 / -7)
- `web/src/services/reports.ts`, `web/src/ts/interfaces/report.ts` — no diffs

## Critical Issues

### 1. ODate / `convertDateToTimestamp` format mismatch — silently corrupts schedule timestamps
- **File:** `CreateReport.vue:601-606, 1316, 1676, 1331-1336`
- **Detail:** `ODate` emits ISO `YYYY-MM-DD`. But `saveReport()` sets `scheduling.value.date = "${day}-${month}-${year}"` (DD-MM-YYYY) at line 1316, and `setupEditingReport()` sets it via `toFormat("dd-MM-yyyy")` at line 1676. `convertDateToTimestamp` parses input as `[day, month, year]` — DD-MM-YYYY.
- **Result:** When a user picks a date via the new `ODate` calendar (`2026-05-20`), `convertDateToTimestamp` interprets day=2026, month=05, year=20 → garbage epoch. When opening an existing report for edit, `ODate` receives `20-05-2026` and silently fails to parse so the field appears blank.
- **Severity:** Critical.
- **Solution:**
  ```ts
  // In saveReport(), don't reformat:
  // scheduling.value.date is already YYYY-MM-DD from ODate
  const startTs = convertDateToTimestamp(scheduling.value.date, scheduling.value.time, "ISO");

  // In setupEditingReport():
  scheduling.value.date = DateTime.fromMillis(reportStart).toFormat("yyyy-MM-dd");

  // In convertDateToTimestamp (web/src/utils/date.ts), accept ISO:
  const [year, month, day] = date.split("-");
  ```

### 2. `timezoneOptions` is `string[]` but `OSelect` requires `{label, value}` objects
- **File:** `CreateReport.vue:1252-1261` (definition), `:510, :621` (usage)
- **Detail:** `OSelect` expects `SelectOption[]` with `{ label, value }`. Bare strings render with empty labels.
- **Result:** Timezone dropdown items are empty; required-field guard then blocks save.
- **Severity:** Critical — blocks Schedule step.
- **Solution:**
  ```ts
  let timezoneOptions: Array<{label: string, value: string}> = Intl
    .supportedValuesOf("timeZone")
    .map(tz => ({ label: tz, value: tz }));
  timezoneOptions.unshift({ label: "UTC", value: "UTC" });
  timezoneOptions.unshift({ label: `Browser Time (${Intl.DateTimeFormat().resolvedOptions().timeZone})`, value: "Browser" });
  ```
  Also set `<OSelect searchable :options="timezoneOptions" labelKey="label" valueKey="value" />`.

### 3. `v-bind:disable="isEditingReport"` on `OInput` is a no-op — report name editable in edit mode
- **File:** `CreateReport.vue:73-74`
- **Detail:** Quasar's prop is `disable`; `OInput` uses `disabled`.
- **Result:** Report name editable when editing; backend update by ID may reject renamed payload.
- **Severity:** Critical.
- **Solution:**
  ```diff
  - <OInput v-model="formData.name" :disable="isEditingReport" />
  + <OInput v-model="formData.name" :disabled="isEditingReport" />
  ```

### 4. `<template v-slot:option>` on `OSelect` doesn't exist — disabled-PDF state for inline attachment is lost
- **File:** `CreateReport.vue:297-315`
- **Detail:** `OSelect` slots are `default | trigger | chip | empty | before-options | icon-left | icon-right | tooltip`. The `v-slot:option` template renders nothing.
- **Solution:** Filter options reactively:
  ```ts
  const attachmentTypeOptions = computed(() => {
    const base = [{ label: "Attached as PDF", value: "pdf" }, { label: "Inline (embedded in email body)", value: "inline" }];
    return formData.value.reportType === "pdf"
      ? base.filter(o => o.value !== "inline")
      : base;
  });
  ```

### 5. Tooltip text corrupted by regex replacement: "inline" → "tw:inline"
- **File:** `CreateReport.vue:725`
- **Solution:** Find every occurrence of `tw:inline` *in tooltip/label/aria text* (not in `class=`) and revert to `inline`.

## Logical Issues

### 6. Tooltip trigger scope regression
- **Files:** `CreateReport.vue:125-137, 466-493, 539-549, 718-727`
- **Detail:** `OTooltip` sibling of self-closed `OIcon` → attaches to parent block, hover triggers anywhere.
- **Solution:**
  ```vue
  <span class="tw:inline-flex">
    <OIcon name="info-circle" />
    <OTooltip>This is the tooltip</OTooltip>
  </span>
  ```
  Or use wrapper-mode:
  ```vue
  <OTooltip>
    <template #default>
      <OIcon name="info-circle" />
    </template>
    <template #content>This is the tooltip</template>
  </OTooltip>
  ```

### 7. Dead helper functions and refs still in `CreateReport.vue`
- Remove: `showInfoTooltip`, `filteredTimezone`, `timezoneFilterFn`, `filterColumns`, `onFilterOptions`, `filterOptions`, `isValidName` (duplicated by `validateReportData`).

### 8. `<template v-slot:hint>` on `OInput` does nothing
- **Solution:** Use `OInput`'s `helpText` prop or add an external `<small>`:
  ```vue
  <OInput v-model="formData.name" :error="nameError" />
  <small class="tw:text-xs tw:text-muted">Characters like :, ?, /, #, and spaces are not allowed.</small>
  ```

### 9. Lost timezone search/filter
- **Solution:** Set `<OSelect searchable :options="timezoneOptions" />` and remove `timezoneFilterFn`.

### 10. Lost dashboard/folder/tab search-as-you-type
- **Solution:** Same as above — set `searchable` on the OSelects in `:166-208`.

### 11. Loading toast may auto-hide before the operation completes
- **Solution:** Use `timeout: 0` for sticky loading toasts and dismiss explicitly in `try/finally`:
  ```ts
  const dismiss = toast({ message: "Saving…", variant: "loading", timeout: 0 });
  try { await reportsService.save(...); } finally { dismiss(); }
  ```

## CSS / Layout Issues

### 12. Quasar `col-auto` flex helper still in use
- **Files:** `CreateReport.vue:264, 284, 361, 379, 397, 559`
- **Solution:** Replace `col-auto` with `tw:flex-none` or `tw:basis-auto`.

### 13. Broken Tailwind variant ordering
- **File:** `CreateReport.vue:299`
- **Solution:** `hover:tw:bg-muted/50` → `tw:hover:bg-muted/50`.

### 14. Quasar `q-table__title` class without Quasar styles
- **File:** `ReportList.vue:28`
- **Solution:** Remove the `q-table__title` class; keep only `tw:font-[600]` (or use `tw:font-semibold tw:text-base`).

### 15. Stale Quasar comment block
- **File:** `CreateReport.vue:428-434`
- **Solution:** Delete the commented-out `<q-icon>` block.

## Component Migration Issues

### 16. Unused imports in `ReportList.vue`
- **Solution:** Remove `cloneDeep` (line 292) and `OCheckbox` (line 303) imports.

### 17. `OTooltip` "child mode" inconsistency — see #6 solution.

### 18. `OToggleGroup` `v-model` workaround
- **Solution:** Replace `:model-value=... @update:model-value=...` with `v-model="frequency.type"` if `OToggleGroup` supports it; otherwise keep the workaround but document.

### 19. `MoveAcrossFolders` self-hosting its drawer — functional, no change required.

## Test File Issues

### 20. `CreateReport.spec.ts` mocks removed identifier `addReportFormRef`
- **File:** `CreateReport.spec.ts:503, 543`
- **Solution:** Remove the `w.vm.addReportFormRef = ...` assignment and stub `validateReportData` directly or assert on the state mutations it produces.

### 21. `ReportList.spec.ts` references removed pagination wiring
- **Solution:** Drop the `QTablePagination` import, replace `wrapper.vm.pagination.rowsPerPage` assertions with `OTable` props (`page-size`, `page-size-options`), and find the pagination via `wrapper.findComponent(OTablePagination)`.

### 22. `ReportList.spec.js` references removed `q` and pagination
- **Solution:** Remove `wrapper.vm.q.notify = notifyMock`; mock `useToast` instead. Drop pagination-field assertions.

### 23. Both spec files still call `installQuasar`
- **Solution:** Remove `installQuasar(...)` calls — the helper is now a no-op shim per its TODO.

### 24. `CreateReport.spec.ts` "step to 3 when title missing" test no longer reaches step 3
- **Solution:** Update the test to first set `name`, then unset another required field, to actually exercise step-3 validation.

## Validation Issues

### 25-27. (cron, email, required-field cascade) — functional, no changes needed.

## Accessibility

### 28. Back button is a `<div>` not a `<button>`
- **Solution:**
  ```vue
  <OButton variant="ghost" size="icon-sm" :title="t('common.back')" @click="goBack">
    <OIcon name="arrow-back-ios-new" />
  </OButton>
  ```

### 29. Decorative icons next to switches lack `aria-hidden`
- **Solution:** Add `aria-hidden="true"` to all decorative `<OIcon>` instances inside info-tooltip groups.

## Recommendations (priority order)

1. **P0** — Fix `ODate` ↔ `convertDateToTimestamp` format mismatch (#1)
2. **P0** — Convert `timezoneOptions` to `SelectOption[]` (#2)
3. **P0** — `disable` → `disabled` on the name `OInput` (#3)
4. **P0** — Restore attachment-type disabled UX (#4)
5. **P0** — Fix "tw:inline" tooltip text (#5)
6. **P1** — Nest `OTooltip` inside trigger element (#6)
7. **P1** — Fix spec files (#20–#24)
8. **P2** — Remove dead code (#7, #16)
9. **P2** — Replace `col-auto` with Tailwind utilities (#12)
10. **P2** — Restore field hint on OInput (#8)
11. **P2** — Restore searchable dropdowns (#9, #10)
12. **P3** — Loading-toast lifecycle (#11)
13. **P3** — Back-button accessibility (#28)

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|---|---|---|---|
| ReportList.vue:28 | `q-table__title` | `tw:text-base tw:font-semibold` | file-scoped |
| CreateReport.vue:397 | `col-auto` (Quasar grid) | `tw:flex-none tw:items-end` | file-scoped |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|---|---|---|---|
| CreateReport.vue:299 | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | file-scoped |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| *(none found)* | | | |

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|---|---|---|---|
| RcaReport.scss:38 | `body.body--dark .rca-report-content` | replace with `html.dark .rca-report-content` | global SCSS |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| *(none found)* | | | |

### 6. Quasar Directives
| File:Line | Directive | Action |
|---|---|---|
| *(none found)* | | |

### 7. Icon Migration
| File:Line | Issue | Fix |
|---|---|---|
| *(none found)* | | |

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
|---|---|---|
| ReportList.vue:89,96 | `height: calc(100vh - 118px)` | scoped `.report-list-scroll` class |
| ReportList.vue:123 | `width:100%` | `tw:w-full` |
| ReportList.vue:164 | `display:inline-block; width:33.14px; height:auto` | scoped `.report-icon` class |
| CreateReport.vue:52 | `height: calc(100vh - 192px); overflow:auto` | scoped `.report-form-scroll` class |
| CreateReport.vue:57 | `width:1024px` | scoped `.report-form-shell` class |
| CreateReport.vue:65 | `padding-top:12px` | `tw:pt-3` |
| CreateReport.vue:79 | `width:330px` | `tw:w-[330px]` |
| CreateReport.vue:90 | `width:250px; padding-top:2px` | scoped class |
| CreateReport.vue:95 | `height:34px; top:28px` (dynamic) | acceptable |
| CreateReport.vue:114 | `width:600px` | `tw:w-[600px]` |
| CreateReport.vue:164,180,196 | `padding-top:0; width:30%` | scoped `.report-row-third` class |
| CreateReport.vue:174,190,206 | `min-width:250px !important; width:100% !important` | scoped `.report-input-flex` class |
| CreateReport.vue:216,256 | `font-size:14px` | `tw:text-sm` |
| CreateReport.vue:221 | `font-size:12px` | `tw:text-xs` |
| CreateReport.vue (36 total) | many other narrow widths/sizes | consolidate into report-specific SCSS |

### 9. Duplicate Style Blocks
| Files | Duplicated block | Suggested partial |
|---|---|---|
| CreateReport.vue:164/180/196 | repeated `padding-top:0; width:30%` | extract `.report-row-third` |
| CreateReport.vue:174/190/206 | repeated `min-width:250px !important; width:100% !important` | extract `.report-input-flex` |
| ReportList.vue:89/96 | repeated `height: calc(100vh - 118px)` | extract `.report-list-scroll` |

### 10. Layer Summary
- Global (`app.scss`) changes needed: 1 (RcaReport.scss `body.body--dark` -> `html.dark`)
- Component-level partial changes: 3 (.report-row-third, .report-input-flex, .report-list-scroll)
- File-level scoped changes: ~35+ (2 q-* class leftovers, 1 hover order, 36 inline styles in CreateReport)
