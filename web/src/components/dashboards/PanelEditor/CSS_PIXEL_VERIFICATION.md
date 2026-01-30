# PanelEditor CSS Pixel-by-Pixel Verification

This document lists EVERY CSS property, class, and inline style used in the PanelEditor refactoring.
Each item should be verified by inspecting the element in browser DevTools.

---

## FILE: PanelEditor.vue

### 1. Root Container `.panel-editor`
**Location:** Line 18, `<div class="panel-editor">`

| Property | Value | Dashboard | Metrics | Logs |
|----------|-------|-----------|---------|------|
| height | `100%` | [ ] | [ ] | [ ] |
| width | `100%` | [ ] | [ ] | [ ] |

---

### 2. Row Container (rowStyle computed)
**Location:** Line 19, `<div class="row" :style="rowStyle">`

| Property | Dashboard | Metrics | Logs |
|----------|-----------|---------|------|
| overflow-y | `auto` [ ] | `auto` [ ] | NOT SET [ ] |
| height | NOT SET [ ] | NOT SET [ ] | `100%` [ ] |

---

### 3. Chart Type Selection Outer Wrapper
**Location:** Line 21, `<div class="tw:pl-[0.625rem]">`

| Property | Value | All Pages |
|----------|-------|-----------|
| padding-left | `0.625rem` (10px) | [ ] |

---

### 4. Chart Type Selection Container
**Location:** Lines 22-30

```html
<div class="col scroll card-container tw:mr-[0.625rem]"
     style="overflow-y: auto; height: 100%; min-width: 100px; max-width: 100px;">
```

| Property | Value | All Pages |
|----------|-------|-----------|
| overflow-y | `auto` | [ ] |
| height | `100%` | [ ] |
| min-width | `100px` | [ ] |
| max-width | `100px` | [ ] |
| margin-right | `0.625rem` (10px) | [ ] |
| class `scroll` | Applied | [ ] |
| class `card-container` | Applied (background) | [ ] |

---

### 5. Vertical Separator After Chart Selection
**Location:** Line 38, `<q-separator vertical />`

| Property | Value | All Pages |
|----------|-------|-----------|
| orientation | vertical | [ ] |
| visible | true | [ ] |

---

### 6. Main Content Container Class (mainContentContainerClass)
**Location:** Line 47, `:class="mainContentContainerClass"`

| Page Type | Classes |
|-----------|---------|
| **Dashboard** | `col tw:mr-[0.625rem]` [ ] |
| **Metrics** | `col tw:mr-[0.625rem]` [ ] |
| **Logs** | `col flex column` [ ] |

**Dashboard/Metrics specific:**
| Property | Value |
|----------|-------|
| margin-right | `0.625rem` (10px) [ ] |

**Logs specific:**
| Property | Value |
|----------|-------|
| display | `flex` [ ] |
| flex-direction | `column` [ ] |

---

### 7. Main Content Container Style (mainContentContainerStyle)
**Location:** Line 48, `:style="mainContentContainerStyle"`

| Property | Dashboard | Metrics | Logs |
|----------|-----------|---------|------|
| display | `flex` [ ] | `flex` [ ] | NOT SET [ ] |
| flexDirection | `row` [ ] | `row` [ ] | NOT SET [ ] |
| overflowX | `hidden` [ ] | `hidden` [ ] | NOT SET [ ] |
| width | NOT SET [ ] | NOT SET [ ] | `100%` [ ] |
| height | NOT SET [ ] | NOT SET [ ] | `100%` [ ] |

---

### 8. Collapsed Field List Sidebar
**Location:** Lines 51-65

```html
<div v-if="!dashboardPanelData.layout.showFieldList"
     class="field-list-sidebar-header-collapsed card-container"
     style="width: 50px; height: 100%; flex-shrink: 0">
```

| Property | Value | All Pages |
|----------|-------|-----------|
| width | `50px` | [ ] |
| height | `100%` | [ ] |
| flex-shrink | `0` | [ ] |
| cursor | `pointer` (from class) | [ ] |
| display | `flex` (from class) | [ ] |
| flex-direction | `column` (from class) | [ ] |
| align-items | `center` (from class) | [ ] |
| justify-content | `flex-start` (from class) | [ ] |
| overflow-y | `auto` (from class) | [ ] |

---

### 9. Field List Collapsed Icon
**Location:** Lines 57-60

```html
<q-icon name="expand_all" class="field-list-collapsed-icon rotate-90" />
```

| Property | Value | All Pages |
|----------|-------|-----------|
| margin-top | `10px` | [ ] |
| font-size | `20px` | [ ] |
| rotation | `90deg` | [ ] |

---

### 10. Field List Collapsed Title
**Location:** Lines 62-64

```html
<div class="field-list-collapsed-title">{{ t("panel.fields") }}</div>
```

| Property | Value | All Pages |
|----------|-------|-----------|
| writing-mode | `vertical-rl` | [ ] |
| text-orientation | `mixed` | [ ] |
| font-weight | `bold` | [ ] |

---

### 11. Q-Splitter (Field List)
**Location:** Lines 68-72

```html
<q-splitter v-model="dashboardPanelData.layout.splitter"
            :limits="splitterLimits"
            :style="splitterStyle">
```

**splitterLimits:**
| Page Type | Value |
|-----------|-------|
| **Dashboard** | `[0, 20]` [ ] |
| **Metrics** | `[0, 20]` [ ] |
| **Logs** | `[0, 100]` [ ] |

**splitterStyle:**
| Property | Dashboard (showFieldList=true) | Dashboard (showFieldList=false) | Logs |
|----------|--------------------------------|----------------------------------|------|
| width | `100%` [ ] | `calc(100% - 50px)` [ ] | `100%` [ ] |
| height | `100%` [ ] | `100%` [ ] | `100%` [ ] |

---

### 12. Field List Wrapper (Before Slot)
**Location:** Line 75, `:class="fieldListWrapperClass"`

| Page Type | Classes |
|-----------|---------|
| **Dashboard** | `tw:w-full tw:h-full tw:pb-[0.625rem]` [ ] |
| **Metrics** | `tw:w-full tw:h-full tw:pb-[0.625rem]` [ ] |
| **Logs** | `tw:w-full tw:h-full` (NO pb) [ ] |

| Property | Dashboard/Metrics | Logs |
|----------|-------------------|------|
| width | `100%` [ ] | `100%` [ ] |
| height | `100%` [ ] | `100%` [ ] |
| padding-bottom | `0.625rem` (10px) [ ] | `0` [ ] |

---

### 13. Field List Container
**Location:** Lines 77-79

```html
<div v-if="dashboardPanelData.layout.showFieldList"
     class="col scroll card-container"
     :style="fieldListContainerStyle">
```

**fieldListContainerStyle:**
| Property | Dashboard | Metrics | Logs |
|----------|-----------|---------|------|
| height | `calc(100vh - 110px)` [ ] | `calc(100vh - 106px)` [ ] | `100%` [ ] |
| overflowY | `auto` [ ] | `auto` [ ] | `auto` [ ] |

---

### 14. Field List Inner Column
**Location:** Line 81

```html
<div class="column" style="height: 100%">
```

| Property | Value | All Pages |
|----------|-------|-----------|
| height | `100%` | [ ] |

---

### 15. Field List Header
**Location:** Lines 82-85

```html
<div class="col-auto q-pa-sm">
  <span class="text-weight-bold">{{ t("panel.fields") }}</span>
</div>
```

| Property | Value | All Pages |
|----------|-------|-----------|
| padding | `sm` (~8px) | [ ] |
| font-weight | `bold` | [ ] |

---

### 16. Field List Content Area
**Location:** Line 87, `:style="fieldListInnerStyle"`

| Property | Dashboard/Metrics | Logs |
|----------|-------------------|------|
| width | `100%` [ ] | `100%` [ ] |
| height | NOT SET [ ] | `100%` [ ] |

---

### 17. Splitter Separator (Vertical Line)
**Location:** Line 97

```html
<div class="splitter-vertical splitter-enabled"></div>
```

| Property | Value | All Pages |
|----------|-------|-----------|
| width | `4px` | [ ] |
| height | `100%` | [ ] |
| background-color | `transparent` | [ ] |
| background-color:hover | `orange` | [ ] |
| transition | `0.3s` | [ ] |
| transition-delay | `0.2s` | [ ] |

---

### 18. Splitter Chevron Button
**Location:** Lines 98-115

```html
<q-btn color="primary" size="sm"
       :icon="showFieldList ? 'chevron_left' : 'chevron_right'"
       dense round
       :class="showFieldList ? 'splitter-icon-collapse' : 'splitter-icon-expand'"
       style="top: 14px; z-index: 100">
```

| Property | Value | All Pages |
|----------|-------|-----------|
| top | `14px` | [ ] |
| z-index | `100` | [ ] |
| position | `absolute` (from class) | [ ] |
| left | `-12px` (from class) | [ ] |

**Icon direction:**
| State | Icon |
|-------|------|
| Field list SHOWN | `chevron_left` [ ] |
| Field list HIDDEN | `chevron_right` [ ] |

**Class applied:**
| State | Class |
|-------|-------|
| Field list SHOWN | `splitter-icon-collapse` [ ] |
| Field list HIDDEN | `splitter-icon-expand` [ ] |

---

### 19. After Slot Outer Div
**Location:** Line 120, `:style="afterSlotStyle"`

| Property | Dashboard/Metrics | Logs (showFieldList=true) | Logs (showFieldList=false) |
|----------|-------------------|---------------------------|---------------------------|
| height | NOT SET [ ] | `100%` [ ] | `100%` [ ] |
| width | NOT SET [ ] | `100%` [ ] | `calc(100% - 58px)` [ ] |

---

### 20. After Slot Inner Div
**Location:** Line 121

```html
<div :class="afterSlotInnerClass" :style="afterSlotInnerStyle">
```

**afterSlotInnerClass:**
| Page Type | Class |
|-----------|-------|
| **Dashboard** | `col scroll` [ ] |
| **Metrics** | `col scroll` [ ] |
| **Logs** | `col` (NO scroll) [ ] |

**afterSlotInnerStyle:**
| Property | Dashboard | Metrics | Logs |
|----------|-----------|---------|------|
| height | `calc(100vh - 110px)` [ ] | `calc(100vh - 106px)` [ ] | `100%` [ ] |
| overflowY | `auto` [ ] | `auto` [ ] | NOT SET [ ] |

---

### 21. Layout Panel Container
**Location:** Lines 122-124

```html
<div class="layout-panel-container col" :style="layoutPanelContainerStyle">
```

**layoutPanelContainerStyle:**
| Property | Dashboard/Metrics | Logs |
|----------|-------------------|------|
| height | NOT SET [ ] | `100%` [ ] |

**From class `.layout-panel-container`:**
| Property | Value | All Pages |
|----------|-------|-----------|
| display | `flex` | [ ] |
| flex-direction | `column` | [ ] |

---

### 22. Outdated Warning Container
**Location:** Lines 162-186

```html
<div v-if="resolvedConfig.showOutdatedWarning && isOutDated" class="tw:p-2">
```

| Property | Value | Dashboard/Metrics |
|----------|-------|-------------------|
| padding | `0.5rem` (8px) | [ ] |
| border-color | `#c3920d` | [ ] |
| border-width | `1px` | [ ] |
| border-style | `solid` | [ ] |
| background-color (light) | `#faf2da` | [ ] |
| background-color (dark) | `#2a1f03` | [ ] |
| border-radius | `5px` | [ ] |

**Visibility:**
| Page Type | Visible |
|-----------|---------|
| **Dashboard** | When config changed [ ] |
| **Metrics** | When config changed [ ] |
| **Logs** | NEVER (isOutDated returns false) [ ] |

---

### 23. Warning Icons Row
**Location:** Line 189

```html
<div class="tw:flex tw:justify-end tw:mr-2 tw:items-center">
```

| Property | Value | All Pages |
|----------|-------|-----------|
| display | `flex` | [ ] |
| justify-content | `flex-end` | [ ] |
| margin-right | `0.5rem` (8px) | [ ] |
| align-items | `center` | [ ] |

---

### 24. Warning Button Styling
**Location:** Lines 191-251

```html
<q-btn :icon="outlinedWarning" flat size="xs" padding="2px" class="warning q-mr-xs">
```

| Property | Value | All Pages |
|----------|-------|-----------|
| padding | `2px` | [ ] |
| margin-right | `xs` (~4px) | [ ] |
| color | `var(--q-warning)` (from `.warning` class) | [ ] |

---

### 25. Last Refreshed Time
**Location:** Lines 253-265

```html
<span class="lastRefreshedAt">
  <span class="lastRefreshedAtIcon">&#x1F551;</span>
  <RelativeTime ... />
</span>
```

| Property | Value | Dashboard/Metrics |
|----------|-------|-------------------|
| font-size | `12px` | [ ] |
| color | `var(--q-secondary)` | [ ] |
| icon margin-right | `4px` | [ ] |

**Visibility:**
| Page Type | Visible |
|-----------|---------|
| **Dashboard** | YES [ ] |
| **Metrics** | YES [ ] |
| **Logs** | NO [ ] |

---

### 26. Chart Area Container
**Location:** Lines 269-270

```html
<div class="col tw:relative">
  <div :class="chartAreaClass">
```

**chartAreaClass:**
| Page Type | Classes |
|-----------|---------|
| **Dashboard** | `tw:h-[calc(100vh-500px)] tw:min-h-[140px] tw:mt-[40px]` [ ] |
| **Metrics** | `tw:h-[calc(100vh-500px)] tw:min-h-[140px] tw:mt-[40px]` [ ] |
| **Logs** | `tw:h-[calc(100%-36px)] tw:min-h-[140px]` (NO mt) [ ] |

| Property | Dashboard/Metrics | Logs |
|----------|-------------------|------|
| height | `calc(100vh - 500px)` [ ] | `calc(100% - 36px)` [ ] |
| min-height | `140px` [ ] | `140px` [ ] |
| margin-top | `40px` [ ] | `0` [ ] |

---

### 27. Add To Dashboard Button Container
**Location:** Lines 305-321

```html
<div v-if="resolvedConfig.showAddToDashboardButton"
     class="flex justify-end q-pr-sm q-mb-md q-pt-xs"
     style="position: absolute; top: 4px; right: 0px">
```

| Property | Value | Metrics/Logs |
|----------|-------|--------------|
| position | `absolute` | [ ] |
| top | `4px` | [ ] |
| right | `0px` | [ ] |
| padding-right | `sm` (~8px) | [ ] |
| margin-bottom | `md` (~16px) | [ ] |
| padding-top | `xs` (~4px) | [ ] |

**Visibility:**
| Page Type | Visible |
|-----------|---------|
| **Dashboard** | NO [ ] |
| **Metrics** | YES [ ] |
| **Logs** | YES [ ] |

---

### 28. Add To Dashboard Button
**Location:** Lines 310-320

```html
<q-btn size="md" class="q-pa-none o2-primary-button tw:h-[30px] element-box-shadow"
       no-caps dense style="padding: 2px 4px">
```

| Property | Value | Metrics/Logs |
|----------|-------|--------------|
| height | `30px` | [ ] |
| padding | `2px 4px` | [ ] |
| box-shadow | element-box-shadow class | [ ] |

---

### 29. Errors Component Container
**Location:** Lines 324-329

```html
<DashboardErrorsComponent :errors="errorData" class="col-auto" style="flex-shrink: 0" />
```

| Property | Value | All Pages |
|----------|-------|-----------|
| flex-shrink | `0` | [ ] |

---

### 30. Query Editor Container
**Location:** Lines 333-338

```html
<div v-if="resolvedConfig.showQueryEditor"
     class="row column tw:h-[calc(100vh-180px)]">
  <DashboardQueryEditor />
</div>
```

| Property | Value | Dashboard/Metrics |
|----------|-------|-------------------|
| height | `calc(100vh - 180px)` | [ ] |

**Visibility:**
| Page Type | Visible |
|-----------|---------|
| **Dashboard** | YES [ ] |
| **Metrics** | YES [ ] |
| **Logs** | NO [ ] |

---

### 31. Config Panel Sidebar Container
**Location:** Lines 344-355

```html
<div class="col-auto">
  <PanelSidebar :title="t('dashboard.configLabel')" v-model="isConfigPanelOpen">
    <ConfigPanel ... />
  </PanelSidebar>
</div>
```

| Property | Value | All Pages |
|----------|-------|-----------|
| flex | auto-sized | [ ] |

---

### 32. HTML Editor Section
**Location:** Lines 362-394

```html
<div v-if="dashboardPanelData.data.type === 'html'"
     class="col column tw:mr-[0.625rem]"
     :style="{ height: contentHeight, flex: 1 }">
  <div class="card-container tw:h-full tw:flex tw:flex-col">
```

| Property | Value | Dashboard (HTML type) |
|----------|-------|----------------------|
| margin-right | `0.625rem` (10px) | [ ] |
| height | contentHeight | [ ] |
| flex | `1` | [ ] |
| inner display | `flex` | [ ] |
| inner flex-direction | `column` | [ ] |

---

### 33. Markdown Editor Section
**Location:** Lines 396-429

```html
<div v-if="dashboardPanelData.data.type === 'markdown'"
     class="col column tw:mr-[0.625rem]"
     :style="{ height: contentHeight, flex: 1 }">
```

(Same CSS as HTML Editor Section)

---

### 34. Custom Chart Editor Section
**Location:** Lines 431-441

```html
<div v-if="dashboardPanelData.data.type === 'custom_chart'"
     class="col tw:mr-[0.625rem]"
     style="overflow-y: auto; display: flex; flex-direction: row; overflow-x: hidden;">
```

| Property | Value | Dashboard (custom_chart) |
|----------|-------|--------------------------|
| overflow-y | `auto` | [ ] |
| display | `flex` | [ ] |
| flex-direction | `row` | [ ] |
| overflow-x | `hidden` | [ ] |
| margin-right | `0.625rem` (10px) | [ ] |

---

### 35. Custom Chart Field List Collapsed Sidebar
**Location:** Lines 443-457

```html
<div v-if="!showFieldList"
     class="field-list-sidebar-header-collapsed card-container"
     style="width: 50px; height: 100%; flex-shrink: 0">
```

(Same CSS as main collapsed sidebar - Section 8)

---

### 36. Custom Chart Splitter
**Location:** Lines 460-468

```html
<q-splitter v-model="splitter" :limits="[0, 20]"
            :style="{ width: showFieldList ? '100%' : 'calc(100% - 50px)', height: '100%' }">
```

| Property | Value (showFieldList=true) | Value (showFieldList=false) |
|----------|---------------------------|----------------------------|
| limits | `[0, 20]` | `[0, 20]` |
| width | `100%` [ ] | `calc(100% - 50px)` [ ] |
| height | `100%` [ ] | `100%` [ ] |

---

### 37. Custom Chart Field List Before Slot
**Location:** Lines 471-492

```html
<div class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem]">
  <div class="col scroll card-container" :style="{ height: contentHeight, overflowY: 'auto' }">
```

| Property | Value | Dashboard (custom_chart) |
|----------|-------|--------------------------|
| padding-right | `0.625rem` (10px) | [ ] |
| padding-bottom | `0.625rem` (10px) | [ ] |
| height | contentHeight | [ ] |
| overflowY | `auto` | [ ] |

---

### 38. Custom Chart Editor/Preview Container
**Location:** Line 524

```html
<div style="height: 500px; flex-shrink: 0; overflow: hidden">
```

| Property | Value | Dashboard (custom_chart) |
|----------|-------|--------------------------|
| height | `500px` | [ ] |
| flex-shrink | `0` | [ ] |
| overflow | `hidden` | [ ] |

---

### 39. Custom Chart Example Button Container
**Location:** Lines 541-548

```html
<div style="position: absolute; bottom: 10px; right: 10px; z-index: 10;">
```

| Property | Value | Dashboard (custom_chart) |
|----------|-------|--------------------------|
| position | `absolute` | [ ] |
| bottom | `10px` | [ ] |
| right | `10px` | [ ] |
| z-index | `10` | [ ] |

---

## FILE: visualizelogs-query.scss (Imported by VisualizeLogsQuery.vue)

### 40. Layout Panel Container
```scss
.layout-panel-container {
  display: flex;
  flex-direction: column;
}
```

| Property | Value | Logs |
|----------|-------|------|
| display | `flex` | [ ] |
| flex-direction | `column` | [ ] |

---

### 41. Splitter Horizontal
```scss
.splitter {
  height: 4px;
  width: 100%;
}
```

| Property | Value | All Pages |
|----------|-------|-----------|
| height | `4px` | [ ] |
| width | `100%` | [ ] |

---

### 42. Splitter Vertical
```scss
.splitter-vertical {
  width: 4px;
  height: 100%;
}
```

| Property | Value | All Pages |
|----------|-------|-----------|
| width | `4px` | [ ] |
| height | `100%` | [ ] |

---

### 43. Splitter Enabled Hover Effect
```scss
.splitter-enabled {
  background-color: #ffffff00;
  transition: 0.3s;
  transition-delay: 0.2s;
}
.splitter-enabled:hover {
  background-color: orange;
}
```

| Property | Value | All Pages |
|----------|-------|-----------|
| background-color (normal) | `transparent` (#ffffff00) | [ ] |
| background-color (hover) | `orange` | [ ] |
| transition | `0.3s` | [ ] |
| transition-delay | `0.2s` | [ ] |

---

### 44. Query Editor Splitter Separator Override
```scss
:deep(.query-editor-splitter .q-splitter__separator) {
  background-color: transparent !important;
}
```

| Property | Value | All Pages |
|----------|-------|-----------|
| background-color | `transparent !important` | [ ] |

---

### 45. Field List Sidebar Header Collapsed
```scss
.field-list-sidebar-header-collapsed {
  cursor: pointer;
  width: 50px;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
}
```

| Property | Value | All Pages |
|----------|-------|-----------|
| cursor | `pointer` | [ ] |
| width | `50px` | [ ] |
| height | `100%` | [ ] |
| overflow-y | `auto` | [ ] |
| display | `flex` | [ ] |
| flex-direction | `column` | [ ] |
| align-items | `center` | [ ] |
| justify-content | `flex-start` | [ ] |

---

### 46. Field List Collapsed Icon
```scss
.field-list-collapsed-icon {
  margin-top: 10px;
  font-size: 20px;
}
```

| Property | Value | All Pages |
|----------|-------|-----------|
| margin-top | `10px` | [ ] |
| font-size | `20px` | [ ] |

---

### 47. Field List Collapsed Title
```scss
.field-list-collapsed-title {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-weight: bold;
}
```

| Property | Value | All Pages |
|----------|-------|-----------|
| writing-mode | `vertical-rl` | [ ] |
| text-orientation | `mixed` | [ ] |
| font-weight | `bold` | [ ] |

---

### 48. Warning Color
```scss
.warning {
  color: var(--q-warning);
}
```

| Property | Value | All Pages |
|----------|-------|-----------|
| color | `var(--q-warning)` | [ ] |

---

## FILE: PanelEditor.vue (Scoped Styles)

### 49. Splitter Icon Expand
```scss
.splitter-icon-expand {
  position: absolute;
  left: -12px;
}
```

| Property | Value | All Pages |
|----------|-------|-----------|
| position | `absolute` | [ ] |
| left | `-12px` | [ ] |

---

### 50. Splitter Icon Collapse
```scss
.splitter-icon-collapse {
  position: absolute;
  left: -12px;
}
```

| Property | Value | All Pages |
|----------|-------|-----------|
| position | `absolute` | [ ] |
| left | `-12px` | [ ] |

---

### 51. Last Refreshed At
```scss
.lastRefreshedAt {
  font-size: 12px;
  color: var(--q-secondary);
}
.lastRefreshedAtIcon {
  margin-right: 4px;
}
```

| Property | Value | Dashboard/Metrics |
|----------|-------|-------------------|
| font-size | `12px` | [ ] |
| color | `var(--q-secondary)` | [ ] |
| icon margin-right | `4px` | [ ] |

---

## FILE: AddPanel.vue (Wrapper - Remaining Styles)

### 52. Root Container
**Location:** Line 19

```html
<div style="overflow-y: auto" class="scroll">
```

| Property | Value | Dashboard |
|----------|-------|-----------|
| overflow-y | `auto` | [ ] |

---

### 53. Header Section Container
**Location:** Line 21

```html
<div class="tw:px-[0.625rem] tw:mb-[0.625rem] q-pt-xs">
```

| Property | Value | Dashboard |
|----------|-------|-----------|
| padding-x | `0.625rem` (10px) | [ ] |
| margin-bottom | `0.625rem` (10px) | [ ] |
| padding-top | `xs` (~4px) | [ ] |

---

### 54. Header Card Container
**Location:** Lines 22-25

```html
<div class="flex items-center q-pa-sm card-container">
```

| Property | Value | Dashboard |
|----------|-------|-----------|
| display | `flex` | [ ] |
| align-items | `center` | [ ] |
| padding | `sm` (~8px) | [ ] |

---

### 55. Panel Name Input
**Location:** Lines 34-42

```html
<q-input class="q-ml-xl dynamic-input" dense borderless :style="inputStyle" />
```

| Property | Value | Dashboard |
|----------|-------|-----------|
| margin-left | `xl` (~24px) | [ ] |
| min-width | `200px` | [ ] |
| max-width | `500px` | [ ] |
| transition | `width 0.2s ease` | [ ] |

---

### 56. Header Buttons
**Location:** Lines 46-130

```html
<q-btn class="q-mr-sm tw:h-[36px] el-border" />
```

| Property | Value | Dashboard |
|----------|-------|-----------|
| height | `36px` | [ ] |
| margin-right | `sm` (~8px) | [ ] |

---

### 57. Apply Button Group (Enterprise)
**Location:** Lines 131-147

```html
<q-btn-group class="tw:h-[36px] q-ml-md o2-primary-button"
             style="padding-left: 0px !important; padding-right: 0px !important; display: inline-flex;">
```

| Property | Value | Dashboard (Enterprise) |
|----------|-------|------------------------|
| height | `36px` | [ ] |
| margin-left | `md` (~16px) | [ ] |
| padding-left | `0px !important` | [ ] |
| padding-right | `0px !important` | [ ] |
| display | `inline-flex` | [ ] |

---

## FILE: Metrics/Index.vue (Wrapper - Remaining Styles)

### 58. Root Container
**Location:** Line 18

```html
<div style="overflow-y: auto" class="scroll">
```

| Property | Value | Metrics |
|----------|-------|---------|
| overflow-y | `auto` | [ ] |

---

### 59. Header Section
**Location:** Lines 20-23

```html
<div class="row tw:px-[0.625rem] tw:mb-[0.625rem] q-pt-xs"
     style="height: 48px; overflow-y: auto">
```

| Property | Value | Metrics |
|----------|-------|---------|
| height | `48px` | [ ] |
| overflow-y | `auto` | [ ] |
| padding-x | `0.625rem` (10px) | [ ] |
| margin-bottom | `0.625rem` (10px) | [ ] |

---

### 60. Header Card Container
**Location:** Line 24

```html
<div class="card-container tw:w-full tw:h-full tw:flex">
```

| Property | Value | Metrics |
|----------|-------|---------|
| width | `100%` | [ ] |
| height | `100%` | [ ] |
| display | `flex` | [ ] |

---

### 61. Dashboard Icons Class
**Location:** Lines 551-553

```scss
.dashboard-icons {
  height: 32px;
}
```

| Property | Value | Metrics |
|----------|-------|---------|
| height | `32px` | [ ] |

---

### 62. Auto Refresh Interval Styles
**Location:** Lines 556-573

```scss
.dashboards-auto-refresh-interval {
  .q-btn {
    min-height: 2rem; // 30px
    max-height: 2rem; // 30px
    padding: 0 0.25rem; // 4px
    border-radius: 0.375rem; // 6px
  }
}
```

| Property | Value | Metrics |
|----------|-------|---------|
| min-height | `30px` (2rem) | [ ] |
| max-height | `30px` (2rem) | [ ] |
| padding | `0 4px` | [ ] |
| border-radius | `6px` (0.375rem) | [ ] |

---

## FILE: VisualizeLogsQuery.vue (Wrapper)

### 63. Root Container
**Location:** Line 19

```html
<div style="height: 100%; width: 100%">
```

| Property | Value | Logs |
|----------|-------|------|
| height | `100%` | [ ] |
| width | `100%` | [ ] |

---

## NESTED COMPONENT: PanelSidebar.vue

### 64. Sidebar Container
**Location:** Lines 84-95

```css
.sidebar {
  position: relative;
  width: 50px;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.sidebar.open {
  width: 300px;
}
```

| Property | Value (closed) | Value (open) |
|----------|----------------|--------------|
| position | `relative` [ ] | `relative` [ ] |
| width | `50px` [ ] | `300px` [ ] |
| height | `100%` [ ] | `100%` [ ] |
| min-height | `0` [ ] | `0` [ ] |
| display | `flex` [ ] | `flex` [ ] |
| flex-direction | `column` [ ] | `column` [ ] |

---

### 65. Sidebar Header Collapsed
**Location:** Lines 97-106

```css
.sidebar-header-collapsed {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  width: 50px;
  height: 100%;
  overflow-y: auto;
  cursor: pointer;
}
```

| Property | Value | All Pages |
|----------|-------|-----------|
| display | `flex` | [ ] |
| flex-direction | `column` | [ ] |
| align-items | `center` | [ ] |
| justify-content | `flex-start` | [ ] |
| width | `50px` | [ ] |
| height | `100%` | [ ] |
| overflow-y | `auto` | [ ] |
| cursor | `pointer` | [ ] |

---

### 66. Sidebar Header Expanded
**Location:** Lines 108-115

```css
.sidebar-header-expanded {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
  padding: 0 10px;
  flex-shrink: 0;
}
```

| Property | Value | All Pages |
|----------|-------|-----------|
| display | `flex` | [ ] |
| align-items | `center` | [ ] |
| justify-content | `space-between` | [ ] |
| height | `60px` | [ ] |
| padding | `0 10px` | [ ] |
| flex-shrink | `0` | [ ] |

---

### 67. Collapsed Icon
**Location:** Lines 117-120

```css
.collapsed-icon {
  margin-top: 10px;
  font-size: 20px;
}
```

| Property | Value | All Pages |
|----------|-------|-----------|
| margin-top | `10px` | [ ] |
| font-size | `20px` | [ ] |

---

### 68. Collapsed Title
**Location:** Lines 122-126

```css
.collapsed-title {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-weight: bold;
}
```

| Property | Value | All Pages |
|----------|-------|-----------|
| writing-mode | `vertical-rl` | [ ] |
| text-orientation | `mixed` | [ ] |
| font-weight | `bold` | [ ] |

---

## VERIFICATION SUMMARY

### Total CSS Properties to Verify: 200+

**CODE VERIFICATION STATUS: ALL VERIFIED**

All 68 sections have been verified against source code. The computed properties and scoped styles match the expected values.

### By Page Type:
- [x] Dashboard: ALL verified
- [x] Metrics: ALL verified
- [x] Logs: ALL verified

### By Component:
- [x] PanelEditor.vue: ALL verified (Sections 1-51)
- [x] AddPanel.vue (wrapper): ALL verified (Sections 52-57)
- [x] Metrics/Index.vue (wrapper): ALL verified (Sections 58-62)
- [x] VisualizeLogsQuery.vue (wrapper): ALL verified (Section 63)
- [x] PanelSidebar.vue: ALL verified (Sections 64-68)

### Critical Areas:
- [x] Height calculations (vh vs %) - Verified in contentHeight computed
- [x] Flex layouts (row vs column) - Verified in mainContentContainerClass/Style
- [x] Splitter behavior and limits - Verified in splitterLimits/Style computed
- [x] Collapsed sidebar positioning - Verified in splitter-icon-expand/collapse classes
- [x] Chart area sizing and margins - Verified in chartAreaClass computed
- [x] Scroll behavior - Verified in afterSlotInnerClass/Style computed

### Key Differences Confirmed:
| Property | Dashboard/Metrics | Logs |
|----------|-------------------|------|
| rowStyle | `overflow-y: auto` | `height: 100%` |
| contentHeight | `calc(100vh - 110/106px)` | `calc(100% - 36px)` |
| mainContentContainerClass | `col tw:mr-[0.625rem]` | `col flex column` |
| mainContentContainerStyle | `display: flex; flexDirection: row` | `width: 100%; height: 100%` |
| splitterLimits | `[0, 20]` | `[0, 100]` |
| chartAreaClass | includes `tw:mt-[40px]` | NO margin-top |
| afterSlotInnerClass | `col scroll` | `col` (no scroll) |
| fieldListWrapperClass | includes `tw:pb-[0.625rem]` | NO padding-bottom |

---

## How to Verify

1. Open browser DevTools (F12)
2. Select the element
3. Check "Computed" tab for final CSS values
4. Compare with expected values in this document
5. Mark [ ] as [x] when verified
6. Note any discrepancies in comments
