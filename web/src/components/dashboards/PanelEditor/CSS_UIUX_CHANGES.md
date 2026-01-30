# PanelEditor CSS & UI/UX Changes Verification

This document lists all CSS and UI/UX related changes made during the PanelEditor refactoring.
Verify each item by testing in the browser and mark with [x] when confirmed.

---

## 1. Row Style (`rowStyle` computed)

### 1.1 Dashboard Page
- [ ] Row has `overflow-y: auto`
- [ ] Vertical scrollbar appears when content exceeds viewport height

### 1.2 Metrics Page
- [ ] Row has `overflow-y: auto`
- [ ] Vertical scrollbar appears when content exceeds viewport height

### 1.3 Logs Page
- [ ] Row has `height: 100%`
- [ ] Row fills the entire available height
- [ ] No `overflow-y: auto` (parent controls scrolling)

---

## 2. Content Height (`contentHeight` computed)

### 2.1 Dashboard Page
- [ ] Content height is `calc(100vh - 110px)`
- [ ] Field list panel uses this height
- [ ] After slot inner div uses this height with `overflow-y: auto`

### 2.2 Metrics Page
- [ ] Content height is `calc(100vh - 106px)`
- [ ] Field list panel uses this height
- [ ] After slot inner div uses this height with `overflow-y: auto`

### 2.3 Logs Page
- [ ] Content height is `calc(100% - 36px)` (percentage-based)
- [ ] Field list panel uses `height: 100%` instead
- [ ] After slot inner div uses `height: 100%` instead

---

## 3. Chart Area Class (`chartAreaClass` computed)

### 3.1 Dashboard/Metrics Pages
- [ ] Chart area has class `tw:h-[calc(100vh-500px)]`
- [ ] Chart area has class `tw:min-h-[140px]`
- [ ] Chart area has class `tw:mt-[40px]` (40px top margin)

### 3.2 Logs Page
- [ ] Chart area has class `tw:h-[calc(100%-36px)]`
- [ ] Chart area has class `tw:min-h-[140px]`
- [ ] Chart area does NOT have `tw:mt-[40px]` (no top margin)
- [ ] Chart fills available height without extra spacing

---

## 4. Main Content Container Class (`mainContentContainerClass` computed)

### 4.1 Dashboard/Metrics Pages
- [ ] Container has class `col tw:mr-[0.625rem]`
- [ ] Layout is horizontal (field list beside chart)
- [ ] Right margin of 10px (0.625rem) applied

### 4.2 Logs Page
- [ ] Container has class `col flex column`
- [ ] Layout is vertical (field list above chart when expanded)
- [ ] No right margin class

---

## 5. Main Content Container Style (`mainContentContainerStyle` computed)

### 5.1 Dashboard/Metrics Pages
- [ ] Style has `display: flex`
- [ ] Style has `flexDirection: row`
- [ ] Style has `overflowX: hidden`

### 5.2 Logs Page
- [ ] Style has `width: 100%`
- [ ] Style has `height: 100%`
- [ ] No explicit flex direction (uses CSS class)

---

## 6. Splitter Limits (`splitterLimits` computed)

### 6.1 Dashboard/Metrics Pages
- [ ] Splitter limits are `[0, 20]`
- [ ] Field list cannot be dragged beyond 20% of container width
- [ ] Field list can be collapsed to 0%

### 6.2 Logs Page
- [ ] Splitter limits are `[0, 100]`
- [ ] Field list can expand to full width
- [ ] Field list can be collapsed to 0%

---

## 7. Splitter Style (`splitterStyle` computed)

### 7.1 Dashboard/Metrics Pages (Field List Shown)
- [ ] Splitter width is `100%`
- [ ] Splitter height is `100%`

### 7.2 Dashboard/Metrics Pages (Field List Hidden)
- [ ] Splitter width is `calc(100% - 50px)`
- [ ] Space reserved for collapsed sidebar (50px)

### 7.3 Logs Page
- [ ] Splitter width is always `100%`
- [ ] Splitter height is always `100%`
- [ ] No conditional width change

---

## 8. After Slot Style (`afterSlotStyle` computed)

### 8.1 Dashboard/Metrics Pages
- [ ] No explicit style applied (empty object `{}`)
- [ ] Width determined by parent flex layout

### 8.2 Logs Page (Field List Shown)
- [ ] Style has `height: 100%`
- [ ] Style has `width: 100%`

### 8.3 Logs Page (Field List Hidden)
- [ ] Style has `height: 100%`
- [ ] Style has `width: calc(100% - 58px)`
- [ ] 58px reserved for collapsed field list sidebar

---

## 9. After Slot Inner Class (`afterSlotInnerClass` computed)

### 9.1 Dashboard/Metrics Pages
- [ ] Class is `col scroll`
- [ ] Scroll behavior enabled

### 9.2 Logs Page
- [ ] Class is `col` only
- [ ] No `scroll` class
- [ ] Parent handles scrolling

---

## 10. After Slot Inner Style (`afterSlotInnerStyle` computed)

### 10.1 Dashboard/Metrics Pages
- [ ] Style has `height: {contentHeight}` (vh-based)
- [ ] Style has `overflowY: auto`
- [ ] Scroll appears when content exceeds height

### 10.2 Logs Page
- [ ] Style has `height: 100%` only
- [ ] No `overflowY: auto`
- [ ] Height fills parent container

---

## 11. Layout Panel Container Style (`layoutPanelContainerStyle` computed)

### 11.1 Dashboard/Metrics Pages
- [ ] No explicit style (empty object `{}`)

### 11.2 Logs Page
- [ ] Style has `height: 100%`
- [ ] Container fills available height

---

## 12. Field List Wrapper Class (`fieldListWrapperClass` computed)

### 12.1 Dashboard/Metrics Pages
- [ ] Class is `tw:w-full tw:h-full tw:pb-[0.625rem]`
- [ ] Has padding-bottom of 10px (0.625rem)

### 12.2 Logs Page
- [ ] Class is `tw:w-full tw:h-full`
- [ ] No padding-bottom
- [ ] Fills available space completely

---

## 13. Field List Container Style (`fieldListContainerStyle` computed)

### 13.1 Dashboard/Metrics Pages
- [ ] Style has `height: {contentHeight}` (vh-based)
- [ ] Style has `overflowY: auto`

### 13.2 Logs Page
- [ ] Style has `height: 100%`
- [ ] Style has `overflowY: auto`

---

## 14. Field List Inner Style (`fieldListInnerStyle` computed)

### 14.1 Dashboard/Metrics Pages
- [ ] Style has `width: 100%`
- [ ] No explicit height

### 14.2 Logs Page
- [ ] Style has `width: 100%`
- [ ] Style has `height: 100%`

---

## 15. Splitter Chevron Icon Direction

### 15.1 Field List Shown
- [ ] Icon is `chevron_left`
- [ ] Indicates clicking will collapse (move left)

### 15.2 Field List Hidden
- [ ] Icon is `chevron_right`
- [ ] Indicates clicking will expand (move right)

---

## 16. Splitter Icon Class

### 16.1 Field List Shown
- [ ] Class is `splitter-icon-collapse`
- [ ] Position is `absolute`, `left: -12px`

### 16.2 Field List Hidden
- [ ] Class is `splitter-icon-expand`
- [ ] Position is `absolute`, `left: -12px`

---

## 17. Collapsed Field List Sidebar

### 17.1 All Pages (When Field List Hidden)
- [ ] Sidebar width is `50px`
- [ ] Sidebar height is `100%`
- [ ] "Fields" text is displayed vertically (`writing-mode: vertical-rl`)
- [ ] Expand icon is visible (rotated 90 degrees)
- [ ] Cursor is `pointer` on hover
- [ ] Clicking expands the field list

---

## 18. UI Visibility Conditions

### 18.1 Query Builder (`v-if="resolvedConfig.showQueryBuilder"`)
- [ ] **Dashboard**: Visible
- [ ] **Metrics**: Visible
- [ ] **Logs**: NOT visible

### 18.2 Variables Selector (`v-if="resolvedConfig.showVariablesSelector"`)
- [ ] **Dashboard**: Visible (when variables exist)
- [ ] **Metrics**: NOT visible
- [ ] **Logs**: NOT visible

### 18.3 Query Editor (`v-if="resolvedConfig.showQueryEditor"`)
- [ ] **Dashboard**: Visible
- [ ] **Metrics**: Visible
- [ ] **Logs**: NOT visible

### 18.4 Last Refreshed Time (`v-if="resolvedConfig.showLastRefreshedTime"`)
- [ ] **Dashboard**: Visible
- [ ] **Metrics**: Visible
- [ ] **Logs**: NOT visible

### 18.5 Add To Dashboard Button (`v-if="resolvedConfig.showAddToDashboardButton"`)
- [ ] **Dashboard**: NOT visible
- [ ] **Metrics**: Visible
- [ ] **Logs**: Visible

### 18.6 Outdated Warning (`v-if="resolvedConfig.showOutdatedWarning && isOutDated"`)
- [ ] **Dashboard**: Visible when config changed
- [ ] **Metrics**: Visible when config changed
- [ ] **Logs**: NOT visible (isOutDated always returns false)

---

## 19. Chart Type Filtering (allowedchartstype prop)

### 19.1 Dashboard Page
- [ ] All chart types are selectable
- [ ] No filtering applied

### 19.2 Metrics Page
- [ ] All chart types are selectable
- [ ] No filtering applied

### 19.3 Logs Page
- [ ] Only these chart types are selectable: `area`, `bar`, `h-bar`, `line`, `scatter`, `table`
- [ ] Other chart types are disabled/grayed out
- [ ] Clicking disabled chart type does nothing

---

## 20. Search Type for PanelSchemaRenderer

### 20.1 Dashboard Page
- [ ] `searchType` prop is `"dashboards"`

### 20.2 Metrics Page
- [ ] `searchType` prop is `"ui"`

### 20.3 Logs Page
- [ ] `searchType` prop is `"ui"`

---

## 21. External Chart Data Behavior (Logs Only)

### 21.1 Initial Load
- [ ] Chart data is set immediately from `externalChartData` prop
- [ ] Watch has `immediate: true` option

### 21.2 Data Updates
- [ ] When `externalChartData` changes, internal `chartData` is updated
- [ ] Deep clone is performed (JSON.parse/stringify)

### 21.3 isOutDated Behavior
- [ ] Always returns `false` when `externalChartData` is provided
- [ ] No "not up to date" warning appears on logs page

---

## 22. Static CSS Styles

### 22.1 Panel Editor Root
- [ ] `.panel-editor` has `height: 100%`
- [ ] `.panel-editor` has `width: 100%`

### 22.2 Layout Panel Container
- [ ] `.layout-panel-container` has `display: flex`
- [ ] `.layout-panel-container` has `flex-direction: column`

### 22.3 Splitter Styles
- [ ] `.splitter` has `height: 4px`, `width: 100%`
- [ ] `.splitter-vertical` has `width: 4px`, `height: 100%`
- [ ] `.splitter-enabled` has transparent background
- [ ] `.splitter-enabled:hover` has orange background

### 22.4 Field List Collapsed Styles
- [ ] `.field-list-sidebar-header-collapsed` is flex column, centered
- [ ] `.field-list-collapsed-icon` has `margin-top: 10px`, `font-size: 20px`
- [ ] `.field-list-collapsed-title` has vertical text orientation

### 22.5 Warning and Time Styles
- [ ] `.warning` uses `var(--q-warning)` color
- [ ] `.lastRefreshedAt` has `font-size: 12px`, `color: var(--q-secondary)`

---

## 23. Card Container Background

### 23.1 All Pages
- [ ] `.card-container` class is applied to chart type sidebar
- [ ] `.card-container` class is applied to field list panel
- [ ] `.card-container` class is applied to main content area
- [ ] Background color matches theme (dark/light mode)

---

## 24. Responsive Behavior

### 24.1 Window Resize
- [ ] Chart resizes when window is resized
- [ ] Chart resizes when config panel is toggled
- [ ] Chart resizes when field list is toggled

### 24.2 Splitter Drag
- [ ] Dragging splitter smoothly adjusts widths
- [ ] Orange highlight appears on hover
- [ ] Transition animation (0.3s delay 0.2s)

---

## Verification Summary

| Section | Dashboard | Metrics | Logs |
|---------|-----------|---------|------|
| Row Style | [ ] | [ ] | [ ] |
| Content Height | [ ] | [ ] | [ ] |
| Chart Area Class | [ ] | [ ] | [ ] |
| Main Container Class | [ ] | [ ] | [ ] |
| Main Container Style | [ ] | [ ] | [ ] |
| Splitter Limits | [ ] | [ ] | [ ] |
| Splitter Style | [ ] | [ ] | [ ] |
| After Slot Style | [ ] | [ ] | [ ] |
| After Slot Inner Class | [ ] | [ ] | [ ] |
| After Slot Inner Style | [ ] | [ ] | [ ] |
| Layout Panel Style | [ ] | [ ] | [ ] |
| Field List Wrapper | [ ] | [ ] | [ ] |
| Field List Container | [ ] | [ ] | [ ] |
| Field List Inner | [ ] | [ ] | [ ] |
| Splitter Icon | [ ] | [ ] | [ ] |
| Collapsed Sidebar | [ ] | [ ] | [ ] |
| Query Builder Visibility | [ ] | [ ] | [ ] |
| Variables Visibility | [ ] | [ ] | [ ] |
| Query Editor Visibility | [ ] | [ ] | [ ] |
| Last Refreshed Visibility | [ ] | [ ] | [ ] |
| Add To Dashboard Visibility | [ ] | [ ] | [ ] |
| Outdated Warning | [ ] | [ ] | [ ] |
| Chart Type Filtering | [ ] | [ ] | [ ] |
| Search Type | [ ] | [ ] | [ ] |
| External Chart Data | N/A | N/A | [ ] |

---

## Notes

- Test each page type separately
- Use browser DevTools to inspect computed styles
- Toggle dark/light mode to verify theme compatibility
- Test with different screen sizes for responsive behavior
