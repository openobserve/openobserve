# Dashboard Config Panel — Missing E2E Test Cases

**Coverage as of 2026-03-14 (original):** 42 tests across 9 spec files
**Coverage as of 2026-03-14 (updated):** 62 tests across 12 spec files — items 1–7, 10, 12–14 now implemented
**Gaps remaining:** Items 6 (column order drag), 8–9 (PromQL geomap), 11 (mark line — needs data-test in MarkLineConfig.vue first)
**Last audited:** 2026-03-14

---

## Currently Covered (for reference)

| Spec File | Tests | Chart Types Covered |
|---|---|---|
| `dashboard-config-general.spec.js` | 5 | All (SQL) |
| `dashboard-config-axis.spec.js` | 7 | Line/Bar/Area (SQL) |
| `dashboard-config-legends.spec.js` | 5 | Bar (SQL) |
| `dashboard-config-line-style.spec.js` | 4 | Line/Area (SQL) |
| `dashboard-config-panel-time.spec.js` | 6 | Bar (SQL) |
| `dashboard-config-trellis.spec.js` | 4 | Bar (SQL) |
| `dashboard-config-gauge-maps.spec.js` | 5 | Gauge / GeoMap / Maps (SQL) |
| `dashboard-config-table.spec.js` | 4 | Table (SQL) |
| `dashboard-config-advanced.spec.js` | 7 | Line/Bar/Table/Metric (SQL) |
| **Total** | **42** | **Mostly SQL mode** |

---

## Missing Tests — PromQL Mode

All PromQL config tests are missing. A `setupPromQLPanelWithConfig` helper will be needed.

### P1 — Core PromQL Config

#### 1. Aggregation Function
**File:** New `dashboard-config-promql.spec.js`
**Component:** `PromQLChartConfig.vue`
**data-test:** `dashboard-config-aggregation`
**Options:** Last · First · Min · Max · Avg · Sum · Count · Range · Diff

```
aggregation function: visible in PromQL mode → change to Max → apply → chart renders; change to Avg → apply
```

---

#### 2. Step Value (PromQL resolution)
**File:** `dashboard-config-promql.spec.js`
**Component:** `ConfigPanel.vue` (`v-if="promqlMode"`)
**data-test:** `dashboard-config-step-value`
**Options:** 30s · 1m · 5m · 1h · auto

```
step value: visible in PromQL mode → select 5m → apply → chart renders; reopen → value persists
```

---

#### 3. PromQL Legend Configuration
**File:** `dashboard-config-promql.spec.js`
**Component:** `ConfigPanel.vue` line ~1140 (PromQL-specific legend label/info)
**data-test:** `dashboard-config-promql-legend-info`

```
PromQL legend info: visible in PromQL mode → verify it renders without errors
```

---

### P1 — PromQL Table Mode

#### 4. Column Visibility (Show/Hide columns)
**File:** `dashboard-config-promql.spec.js`
**Component:** `PromQLChartConfig.vue` (table mode)
**data-test:** `dashboard-config-visible-columns` · `dashboard-config-hidden-columns`

```
column visibility: PromQL table → visible-columns dropdown shows → hide one column → apply → table renders without that column
```

---

#### 5. Sticky Columns
**File:** `dashboard-config-promql.spec.js`
**Component:** `PromQLChartConfig.vue`
**data-test:** `dashboard-config-sticky-first-column` · `dashboard-config-sticky-columns`

```
sticky columns: PromQL table → enable sticky-first-column toggle → apply → table renders; reopen → toggle state persists
```

---

#### 6. Column Order / Reorder
**File:** `dashboard-config-promql.spec.js`
**Component:** `ColumnOrderPopUp.vue`
**data-test:** `dashboard-config-column-order-button` · `column-order-dialog`

```
column order: PromQL table → click reorder button → dialog opens → drag to reorder → save → table renders with new column order
```

---

#### 7. PromQL Table Mode Aggregations
**File:** `dashboard-config-promql.spec.js`
**Component:** `PromQLChartConfig.vue`
**data-test:** `dashboard-config-promql-table-mode`
**Options:** single (Timestamp) · expanded_timeseries · all

```
PromQL table mode: visible for PromQL table → switch to "expanded_timeseries" → apply → table renders; switch to "all" → apply → table renders
```

---

### P2 — PromQL Geo Labels

#### 8. GeoMap Lat/Lon/Weight Label Customization (PromQL)
**File:** `dashboard-config-promql.spec.js`
**Component:** `PromQLChartConfig.vue`
**data-test:** `dashboard-config-geo-lat-label` · `dashboard-config-geo-lon-label` · `dashboard-config-geo-weight-label`

```
PromQL geomap labels: visible → change lat label to "lat" → change lon label to "lon" → apply → chart renders; reopen → labels persist
```

---

#### 9. Maps Name Label (PromQL)
**File:** `dashboard-config-promql.spec.js`
**Component:** `PromQLChartConfig.vue`
**data-test:** `dashboard-config-maps-name-label`

```
PromQL maps name label: visible for maps chart → set custom name label → apply → chart renders
```

---

## Missing Tests — SQL + PromQL (Both Modes)

### P1 — Drilldown Configuration

#### 10. Add / Edit / Remove Drilldown
**File:** New `dashboard-config-drilldown.spec.js`
**Component:** `Drilldown.vue`
**data-test:** `dashboard-addpanel-config-drilldown-add-btn` · `dashboard-addpanel-config-drilldown-name-{index}` · `dashboard-addpanel-config-drilldown-remove-{index}`

```
drilldown: add button visible → click → name input appears → fill name → apply → chart renders
drilldown remove: add drilldown → remove it → count goes to 0 → apply → chart renders
drilldown persistence: add drilldown with name → save → reopen → name persists
```

---

### P2 — Mark Line Configuration

#### 11. Add / Edit Mark Lines
**File:** `dashboard-config-advanced.spec.js` (or new `dashboard-config-markline.spec.js`)
**Component:** `MarkLineConfig.vue`
**Note:** No `data-test` attributes found in component — may need to add them to the Vue component first before testing

```
mark line: add button visible for line/bar chart → add mark line with fixed value → apply → chart renders with mark line visible
mark line remove: add mark line → remove it → apply → chart renders without mark line
```

---

### P2 — Advanced Options

#### 12. Top Results "Others" Toggle
**File:** `dashboard-config-advanced.spec.js`
**Component:** `ConfigPanel.vue` line ~1070
**data-test:** `dashboard-config-top_results_others`
**Condition:** visible when `top_results` is set (breakdown field required)

```
top results others: set top N → "Others" toggle appears → enable → apply → chart renders with "Others" series
top results others: disable toggle → apply → chart renders without "Others"
```

---

#### 13. Chart Alignment
**File:** `dashboard-config-general.spec.js` or `dashboard-config-advanced.spec.js`
**Component:** `ConfigPanel.vue`
**data-test:** `dashboard-config-chart-align`
**Options:** varies by chart type

```
chart alignment: visible → change alignment → apply → chart renders; reopen → alignment persists
```

---

#### 14. Weight (Geomap/Maps layer)
**File:** `dashboard-config-gauge-maps.spec.js`
**Component:** `ConfigPanel.vue`
**data-test:** `dashboard-config-weight`
**Condition:** visible for geomap/maps with heatmap layer type

```
weight: geomap with heatmap layer → weight input visible → set custom weight field → apply → chart renders
```

---

## Missing Tests — SQL-Mode Only

### P3 — SQL Table Column Options

Currently the table config tests cover `wrap cells`, `transpose`, `dynamic columns`, `pagination` — but only in SQL mode. The following need coverage:

#### 15. SQL Table Config in PromQL vs SQL (parity check)
**Note:** `table_transpose` and `table_dynamic_columns` have `v-if="!promqlMode"` — they are SQL-only.
Existing tests cover these. No additional SQL-only tests needed unless PromQL parity testing is required.

---

## Suggested New Spec File Structure

```
dashboard-config-promql.spec.js          ← NEW (covers items 1–9 above)
dashboard-config-drilldown.spec.js       ← NEW (covers item 10)
dashboard-config-markline.spec.js        ← NEW (covers item 11, after adding data-test to MarkLineConfig.vue)
```

Items 12–15 can be added to existing spec files:
- `dashboard-config-advanced.spec.js` ← add items 12 and 13
- `dashboard-config-gauge-maps.spec.js` ← add item 14

---

## Prerequisites Before Writing Tests

| Item | Prerequisite |
|---|---|
| All PromQL tests (1–9) | Need `setupPromQLPanelWithConfig(page, pm, dashboardName)` helper in `configPanelHelpers.js` |
| Column order test (6) | Need drag-and-drop helper for reordering |
| Mark line tests (11) | Need `data-test` attributes added to `MarkLineConfig.vue` |
| PromQL geomap (8–9) | Need PromQL geomap panel setup helper |

---

## data-test Reference — Components Without Coverage

| Feature | data-test Attribute | Vue Component |
|---|---|---|
| Aggregation | `dashboard-config-aggregation` | `PromQLChartConfig.vue` |
| Step value | `dashboard-config-step-value` | `ConfigPanel.vue` |
| PromQL legend | `dashboard-config-promql-legend-info` | `ConfigPanel.vue` |
| Visible columns | `dashboard-config-visible-columns` | `PromQLChartConfig.vue` |
| Hidden columns | `dashboard-config-hidden-columns` | `PromQLChartConfig.vue` |
| Sticky first col | `dashboard-config-sticky-first-column` | `PromQLChartConfig.vue` |
| Sticky columns | `dashboard-config-sticky-columns` | `PromQLChartConfig.vue` |
| Column order btn | `dashboard-config-column-order-button` | `PromQLChartConfig.vue` |
| Column order dialog | `column-order-dialog` | `ColumnOrderPopUp.vue` |
| PromQL table mode | `dashboard-config-promql-table-mode` | `PromQLChartConfig.vue` |
| Geo lat label | `dashboard-config-geo-lat-label` | `PromQLChartConfig.vue` |
| Geo lon label | `dashboard-config-geo-lon-label` | `PromQLChartConfig.vue` |
| Geo weight label | `dashboard-config-geo-weight-label` | `PromQLChartConfig.vue` |
| Maps name label | `dashboard-config-maps-name-label` | `PromQLChartConfig.vue` |
| Drilldown add | `dashboard-addpanel-config-drilldown-add-btn` | `Drilldown.vue` |
| Drilldown name | `dashboard-addpanel-config-drilldown-name-{i}` | `Drilldown.vue` |
| Drilldown remove | `dashboard-addpanel-config-drilldown-remove-{i}` | `Drilldown.vue` |
| Top N others | `dashboard-config-top_results_others` | `ConfigPanel.vue` |
| Chart align | `dashboard-config-chart-align` | `ConfigPanel.vue` |
| Weight | `dashboard-config-weight` | `ConfigPanel.vue` |
| Mark line | *(no data-test — needs to be added)* | `MarkLineConfig.vue` |
