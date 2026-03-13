# ConfigPanel E2E Test Plan (Playwright)

## Overview

This document lists all existing and proposed E2E Playwright test cases for the `ConfigPanel.vue` component located at `web/src/components/dashboards/addPanel/ConfigPanel.vue`.

---

## Existing E2E Test Coverage (9 spec files)

| # | Spec File | Config Panel Area Covered |
|---|-----------|--------------------------|
| 1 | `dashboard-panel-time-config-behavior.spec.js` | Panel time toggle, +Set flow, apply/cancel |
| 2 | `dashboard-panel-time-apply-behavior.spec.js` | Panel time apply interactions |
| 3 | `dashboard-panel-time-advanced-edge-cases.spec.js` | Panel time edge cases |
| 4 | `dashboard-panel-time-url-priority.spec.js` | Panel time URL sync |
| 5 | `dashboard-series-color-multiwindow.spec.js` | Color by series configuration |
| 6 | `dashboard-table-pagination.spec.js` | Table pagination, rows per page |
| 7 | `dashboard-geoMap.spec.js` | GeoMap lat/lng/zoom config |
| 8 | `dashboard-transpose.spec.js` | Table transpose, wrap cells |
| 9 | `dashboard.spec.js` / `dashboard2.spec.js` | General panel config interactions |

---

## Proposed E2E Test Cases (164 total)

### 1. General / Description
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 1 | Description field is visible and editable for all chart types | `dashboard-config-description` |
| 2 | Description persists after saving the panel | `dashboard-config-description` |
| 3 | Custom chart type shows only description (no other config options) | `dashboard-config-description` |

---

### 2. Panel Default Time (Allow Panel Time)
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 4 | "Allow Panel Time" toggle is visible in config panel | `dashboard-config-allow-panel-time` |
| 5 | Enable toggle → "+Set" button appears | `dashboard-config-set-panel-time` |
| 6 | Click "+Set" → DateTimePicker appears | `dashboard-config-panel-time-picker` |
| 7 | Set relative time (e.g., Last 1h) → tooltip shows formatted time | `dashboard-config-panel-time-picker` |
| 8 | Click cancel (`X` icon) → picker hides and time cleared | `dashboard-config-cancel-panel-time` |
| 9 | Disable toggle → time picker section hides | `dashboard-config-allow-panel-time` |
| 10 | Panel time persists after saving and reopening panel | `dashboard-config-allow-panel-time` |
| 11 | Panel time picker visible in view mode when panel time is enabled | `panel-time-picker-${panelId}` |
| 12 | Global time change does NOT affect panel with individual time set | `dashboard-global-date-time-picker` |
| 13 | Toggle off → panel reverts to global time | `dashboard-config-allow-panel-time` |
| 14 | Panel time info tooltip is visible on hover | — |

---

### 3. PromQL Step Value
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 15 | Step value field visible only in PromQL mode | `dashboard-config-step-value` |
| 16 | Enter valid step value (e.g., "30s") → persists after apply | `dashboard-config-step-value` |
| 17 | Empty step value → fallback to "0" default | `dashboard-config-step-value` |

---

### 4. Trellis Layout
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 18 | Trellis dropdown visible for applicable chart types | `dashboard-trellis-chart` |
| 19 | Select "Auto" → chart reflows into auto trellis grid | `dashboard-trellis-chart` |
| 20 | Select "Vertical" → panels arranged vertically | `dashboard-trellis-chart` |
| 21 | Select "Custom" → number of columns input appears | `trellis-chart-num-of-columns` |
| 22 | Set custom columns to 3 → 3 columns rendered | `trellis-chart-num-of-columns` |
| 23 | Set columns above 16 → value capped at 16 | `trellis-chart-num-of-columns` |
| 24 | Trellis dropdown disabled when no breakdown field is set | `dashboard-trellis-chart` |
| 25 | Trellis dropdown disabled when time shifts are active | `dashboard-trellis-chart` |
| 26 | "Group by Y Axis" toggle appears when trellis layout is active | `dashboard-config-trellis-group-by-y-axis` |
| 27 | Enable "Group by Y Axis" → multiple Y axes grouped per trellis panel | `dashboard-config-trellis-group-by-y-axis` |

---

### 5. Legends
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 28 | "Show Legends" toggle visible for applicable chart types | `dashboard-config-show-legend` |
| 29 | Disable "Show Legends" → legend disappears from chart | `dashboard-config-show-legend` |
| 30 | Legend position set to "Right" → legend moves to right | `dashboard-config-legend-position` |
| 31 | Legend position set to "Bottom" → legend moves to bottom | `dashboard-config-legend-position` |
| 32 | Legend position set to "Auto" → default behavior restored | `dashboard-config-legend-position` |
| 33 | Legend type set to "Scroll" → legend becomes scrollable | `dashboard-config-legends-scrollable` |
| 34 | Legend type set to "Plain" → legend is static | `dashboard-config-legends-scrollable` |
| 35 | Legend width input appears when position is "Right" | `dashboard-config-legend-width` |
| 36 | Set legend width in px → chart area adjusts | `dashboard-config-legend-width` |
| 37 | Toggle legend width unit: px → % | `dashboard-config-legend-width-unit-active` |
| 38 | Legend height input appears when position is "Auto" or "Bottom" | `dashboard-config-legend-height` |
| 39 | Set legend height in px → chart adjusts | `dashboard-config-legend-height` |
| 40 | Toggle legend height unit: px → % | `dashboard-config-legend-height-unit-active` |

---

### 6. Table-Specific Config
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 41 | Wrap table cells toggle visible only for table chart type | `dashboard-config-wrap-table-cells` |
| 42 | Enable wrap cells → long text wraps inside cells | `dashboard-config-wrap-table-cells` |
| 43 | Table transpose toggle visible only for table (non-PromQL) | `dashboard-config-table_transpose` |
| 44 | Enable transpose → rows and columns are swapped | `dashboard-config-table_transpose` |
| 45 | Dynamic columns toggle visible only for table (non-PromQL) | `dashboard-config-table_dynamic_columns` |
| 46 | Enable dynamic columns → columns update dynamically | `dashboard-config-table_dynamic_columns` |
| 47 | Pagination toggle visible only for table chart type | `dashboard-config-show-pagination` |
| 48 | Enable pagination → pagination controls appear in table | `dashboard-config-show-pagination` |
| 49 | "Rows per page" input appears only when pagination is enabled | `dashboard-config-rows-per-page` |
| 50 | Set rows per page to 25 → table shows 25 rows per page | `dashboard-config-rows-per-page` |
| 51 | Disable pagination → rows per page input disappears | `dashboard-config-show-pagination` |

---

### 7. Chart Align
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 52 | Chart align dropdown visible for applicable chart types | `dashboard-config-chart-align` |
| 53 | Set chart align to "Left" → chart aligns left | `dashboard-config-chart-align` |
| 54 | Set chart align to "Center" → chart aligns center | `dashboard-config-chart-align` |

---

### 8. Unit Configuration
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 55 | Unit dropdown visible for all applicable panel types | `dashboard-config-unit` |
| 56 | Set unit to "Bytes" → values show byte suffix | `dashboard-config-unit` |
| 57 | Set unit to "Percent" → values show % suffix | `dashboard-config-unit` |
| 58 | Set unit to "Custom" → custom unit text input appears | `dashboard-config-custom-unit` |
| 59 | Enter custom unit text → values display with that suffix | `dashboard-config-custom-unit` |
| 60 | Decimals input is editable | `dashboard-config-decimals` |
| 61 | Set decimals to 0 → no decimal places shown in chart | `dashboard-config-decimals` |
| 62 | Set decimals to 4 → 4 decimal places shown | `dashboard-config-decimals` |
| 63 | Decimals value > 100 → validation error shown | `dashboard-config-decimals` |

---

### 9. Query Limit (SQL mode)
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 64 | Query limit field visible in SQL non-custom query mode | `dashboard-config-limit` |
| 65 | Query limit field hidden in PromQL / custom query mode | `dashboard-config-limit` |
| 66 | Set limit to 100 → results capped at 100 rows | `dashboard-config-limit` |
| 67 | Set limit to 0 → all results returned | `dashboard-config-limit` |

---

### 10. Top Results / Top N
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 68 | "Show Top N Values" field appears when breakdown field exists | `dashboard-config-top_results` |
| 69 | Top results field is disabled when no breakdown field | `dashboard-config-top_results` |
| 70 | Set top N to 5 → only top 5 series shown | `dashboard-config-top_results` |
| 71 | "Add Others Series" toggle appears alongside top N config | `dashboard-config-top_results_others` |
| 72 | Enable "Others" → remaining values grouped as "Others" | `dashboard-config-top_results_others` |
| 73 | "Others" toggle disabled when no breakdown field | `dashboard-config-top_results_others` |

---

### 11. Connect Null Values
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 74 | Toggle visible for line/area chart types | `dashboard-config-connect-null-values` |
| 75 | Enable → null gaps are connected in chart | `dashboard-config-connect-null-values` |
| 76 | Disable → gaps show as breaks in chart | `dashboard-config-connect-null-values` |

---

### 12. No Value Replacement
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 77 | Input visible for applicable chart types | `dashboard-config-no-value-replacement` |
| 78 | Set replacement to "N/A" → empty cells show "N/A" | `dashboard-config-no-value-replacement` |
| 79 | Clear replacement → empty cells show default "-" | `dashboard-config-no-value-replacement` |

---

### 13. Y-Axis Configuration
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 80 | Y-axis min input visible for cartesian chart types | `dashboard-config-y_axis_min` |
| 81 | Set Y-axis min → chart Y-axis starts from custom value | `dashboard-config-y_axis_min` |
| 82 | Set Y-axis max → chart Y-axis ends at custom value | `dashboard-config-y_axis_max` |
| 83 | Clear Y-axis min/max → auto-scaling resumes | `dashboard-config-y_axis_min` |

---

### 14. Axis Width & Border
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 84 | Axis width input visible for applicable chart types | `dashboard-config-axis-width` |
| 85 | Set axis width → Y-axis width adjusts | `dashboard-config-axis-width` |
| 86 | "Show Border" toggle visible for applicable chart types | `dashboard-config-axis-border` |
| 87 | Enable axis border → border appears around chart area | `dashboard-config-axis-border` |

---

### 15. Gridlines
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 88 | "Show Gridlines" toggle visible for applicable chart types | `dashboard-config-show-gridlines` |
| 89 | Disable gridlines → grid lines hidden from chart | `dashboard-config-show-gridlines` |
| 90 | Enable gridlines → grid lines visible in chart | `dashboard-config-show-gridlines` |

---

### 16. Label Configuration
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 91 | Label position dropdown visible for cartesian charts | `dashboard-config-label-position` |
| 92 | Set label position to "Top" → labels appear above bars | `dashboard-config-label-position` |
| 93 | Set label position to "Inside" → labels appear inside bars | `dashboard-config-label-position` |
| 94 | Set label position to "None" → no labels on data points | `dashboard-config-label-position` |
| 95 | Label rotate input visible for cartesian charts | `dashboard-config-label-rotate` |
| 96 | Set label rotate to 45° → labels rotate on chart | `dashboard-config-label-rotate` |
| 97 | X-axis label rotate input visible for applicable charts | `dashboard-config-axis-label-rotate` |
| 98 | Set x-axis label rotate angle → axis labels rotate | `dashboard-config-axis-label-rotate` |
| 99 | X-axis label truncate width input visible | `dashboard-config-axis-label-truncate-width` |
| 100 | Set truncate width → long axis labels are truncated | `dashboard-config-axis-label-truncate-width` |

---

### 17. Show Symbol
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 101 | "Show Symbol" dropdown visible for line/area charts | `dashboard-config-show_symbol` |
| 102 | Select circle symbol → markers appear on data points | `dashboard-config-show_symbol` |
| 103 | Select "No Symbol" → data points have no marker | `dashboard-config-show_symbol` |

---

### 18. Line Interpolation
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 104 | Line interpolation dropdown visible for line/area charts | `dashboard-config-line_interpolation` |
| 105 | Select "Smooth" → curved lines in chart | `dashboard-config-line_interpolation` |
| 106 | Select "Linear" → straight lines in chart | `dashboard-config-line_interpolation` |
| 107 | Select "Step Before" → step-before style lines | `dashboard-config-line_interpolation` |
| 108 | Select "Step After" → step-after style lines | `dashboard-config-line_interpolation` |
| 109 | Select "Step Middle" → step-middle style lines | `dashboard-config-line_interpolation` |

---

### 19. Line Thickness
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 110 | Line thickness input visible for line/area charts | `dashboard-config-line_thickness` |
| 111 | Set line thickness to 3 → thicker lines rendered | `dashboard-config-line_thickness` |
| 112 | Set line thickness to 0.5 → thinner lines rendered | `dashboard-config-line_thickness` |
| 113 | Set negative thickness → value falls back to default (1.5) | `dashboard-config-line_thickness` |

---

### 20. Time Shift / Compare Against
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 114 | "Comparison Against" section visible for applicable chart types | `scheduled-dashboard-period-title` |
| 115 | "0m" reference entry always present and disabled | — |
| 116 | Click "Add" → new time shift row appears | `dashboard-addpanel-config-time-shift-add-btn` |
| 117 | Set time shift to "1h" → comparison series added to chart | `dashboard-addpanel-config-time-shift-add-btn` |
| 118 | Add multiple time shifts → multiple comparison series shown | `dashboard-addpanel-config-time-shift-add-btn` |
| 119 | Remove a time shift row → that comparison series removed | `dashboard-addpanel-config-time-shift-remove-0` |
| 120 | Trellis is disabled when time shifts are active | `dashboard-trellis-chart` |

---

### 21. Color Palette & Color By Series
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 121 | Color palette dropdown visible for applicable chart types | — |
| 122 | Select different color palette → chart colors update | — |
| 123 | "Color By Series" add button visible | `dashboard-addpanel-config-colorBySeries-add-btn` |
| 124 | Open color by series popup → series list appears | `dashboard-color-by-series-popup` |
| 125 | Assign color to a series → chart series uses that color | `dashboard-color-by-series-popup` |
| 126 | Add multiple series color mappings | `dashboard-addpanel-config-color-by-series-add-btn` |
| 127 | Delete a color mapping row → reverts to default palette color | `dashboard-addpanel-config-color-by-series-delete-btn-0` |
| 128 | Save color by series → colors persist after apply | `dashboard-addpanel-config-color-by-series-apply-btn` |
| 129 | Cancel color by series → no changes applied | `dashboard-color-by-series-cancel` |

---

### 22. Gauge-Specific Config
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 130 | Gauge min input visible only for gauge chart type | `dashboard-config-gauge-min` |
| 131 | Set gauge min → gauge scale starts from custom value | `dashboard-config-gauge-min` |
| 132 | Gauge max input visible only for gauge chart type | `dashboard-config-gauge-max` |
| 133 | Set gauge max → gauge scale ends at custom value | `dashboard-config-gauge-max` |

---

### 23. GeoMap-Specific Config
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 134 | Basemap dropdown visible only for geomap type | `dashboard-config-basemap` |
| 135 | Latitude input visible only for geomap type | `dashboard-config-latitude` |
| 136 | Longitude input visible only for geomap type | `dashboard-config-longitude` |
| 137 | Zoom level input visible only for geomap type | `dashboard-config-zoom` |
| 138 | Set lat/lng/zoom → map view updates accordingly | `dashboard-config-latitude` |
| 139 | Symbol size "By Value" → min/max inputs appear | `dashboard-config-map-symbol-min` |
| 140 | Symbol size "Fixed" → fixed size input appears | `dashboard-config-map-symbol-fixed` |
| 141 | Set min/max symbol size → data points scale accordingly | `dashboard-config-map-symbol-max` |
| 142 | Layer type: select "Scatter" → scatter layer shown | `dashboard-config-layer-type` |
| 143 | Layer type: select "Heatmap" → heatmap layer shown | `dashboard-config-layer-type` |
| 144 | GeoMap weight input visible when no weight field present | `dashboard-config-weight` |

---

### 24. Mark Line Config
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 145 | Mark line config section visible for cartesian charts | — |
| 146 | Add a mark line → reference line appears on chart | — |
| 147 | Configure mark line value and label → displays correctly | — |
| 148 | Remove mark line → reference line disappears | — |

---

### 25. Drilldown
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 149 | Drilldown section visible for applicable chart types | — |
| 150 | Configure drilldown URL with a variable → link works on click | — |
| 151 | Remove drilldown config → clicking chart no longer navigates | — |

---

### 26. Value Mapping (Table only)
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 152 | Value mapping section visible only for table chart type | — |
| 153 | Add a value mapping rule → mapped value displayed in table | — |
| 154 | Remove a value mapping rule → original values restored | — |

---

### 27. Override Config (Table only)
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 155 | Override config section visible only for table chart type | `dashboard-addpanel-config-override-config-add-btn` |
| 156 | Add a column override → column-specific styling applied | `dashboard-addpanel-config-override-config-add-btn` |
| 157 | Remove an override → column reverts to default styling | — |

---

### 28. Background Color Config (Metric only)
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 158 | Background color config visible only for metric chart type | — |
| 159 | Set background color → metric panel background changes | — |
| 160 | Clear background color → panel background resets | — |

---

### 29. PromQL-Specific
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 161 | Query tab selector visible in PromQL mode (not geomap/maps) | `dashboard-config-query-tab` |
| 162 | Switch between query tabs → legend config updates per query | `dashboard-config-query-tab-0` |
| 163 | PromQL legend autocomplete suggests label placeholders | — |

---

### 30. Cross-Cutting / Edge Cases
| # | Test Case | `data-test` Selector |
|---|-----------|---------------------|
| 164 | Config panel opens via sidebar icon click | `dashboard-sidebar` |
| 165 | All changes reflected only after clicking "Apply" | `dashboard-apply` |
| 166 | Discard changes reverts all config modifications | `dashboard-panel-discard` |
| 167 | Config saved correctly survives page reload | — |
| 168 | Config panel is scrollable when many options are visible | — |

---

## Summary

| Category | Test Count |
|----------|-----------|
| General / Description | 3 |
| Panel Default Time | 11 |
| PromQL Step Value | 3 |
| Trellis Layout | 10 |
| Legends | 13 |
| Table-Specific Config | 11 |
| Chart Align | 3 |
| Unit Configuration | 9 |
| Query Limit | 4 |
| Top Results / Top N | 6 |
| Connect Null Values | 3 |
| No Value Replacement | 3 |
| Y-Axis Configuration | 4 |
| Axis Width & Border | 4 |
| Gridlines | 3 |
| Label Configuration | 10 |
| Show Symbol | 3 |
| Line Interpolation | 6 |
| Line Thickness | 4 |
| Time Shift / Compare Against | 7 |
| Color Palette & Color By Series | 9 |
| Gauge-Specific Config | 4 |
| GeoMap-Specific Config | 11 |
| Mark Line Config | 4 |
| Drilldown | 3 |
| Value Mapping | 3 |
| Override Config | 3 |
| Background Color Config | 3 |
| PromQL-Specific | 3 |
| Cross-Cutting / Edge Cases | 5 |
| **Total** | **168** |

---

## Gaps (Not Yet Covered by Existing Tests)

- Y-axis min/max configuration
- Axis width and border toggle
- Gridlines toggle
- Label position, rotation, truncation
- Line thickness input
- Show symbol dropdown
- Mark line config
- Value mapping (table)
- Background color config (metric)
- Gauge min/max values
- No value replacement
- Drilldown configuration
- Trellis group-by-Y-axis toggle
- Legend width/height with unit toggle (px/%)
- Chart align dropdown
