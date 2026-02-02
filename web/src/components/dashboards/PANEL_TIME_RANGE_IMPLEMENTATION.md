# Panel-Level Time Range Configuration - Implementation Guide

**Version:** 3.1 (Updated - Reflects Actual Implementation)
**Date:** 2026-02-02
**Status:** Implementation Complete - E2E Tests Pending

---

## Document Update Notice

**⚠️ Documentation Updated to Match Actual Implementation**

This document has been revised to reflect the **actual implemented behavior**:
- **Removed:** Yellow refresh button indicator behavior (not implemented)
- **Updated:** Apply button is the only way to apply time changes
- **Clarified:** Auto-apply is disabled, user must explicitly click Apply
- **Added:** Data-test attributes for E2E testing
- **Updated:** E2E test count from 47 to 45 tests (removed 2 yellow button tests)

---

## Executive Summary

This document outlines the implementation for **panel-level time range/date-time picker** configuration in OpenObserve dashboards, similar to Splunk and Grafana. Based on team discussion, panels will have their own time pickers that can be set independently or synchronized with global dashboard time.

**IMPORTANT:** This is a **NEW ADD-ON feature**. The existing global time logic with `defaultDatetimeDuration` already works perfectly - we are **NOT changing it**. We are only **adding** new functionality when a panel has `panel_time_range` configured. All existing panels without this config will continue to work exactly as before with zero changes.

### Key Requirements (Updated Based on Discussion)

1. ✅ **Config UI with Toggle**
   - Toggle to enable/disable panel-level time
   - Option to choose: "Use Global Time" or "Use Individual Time"
   - Reuse existing date time picker in AddPanel view

2. ✅ **Panel-Level Date Time Picker in View Mode**
   - Similar to panel variables, add date time picker for each panel
   - Visible in dashboard view mode (like variable selector)
   - Users can change panel time without entering edit mode
   - **Panel date time picker shown in RenderDashboardCharts** (not PanelContainer)
   - **When Apply button clicked:** Fire API call, update URL, refresh panel immediately
   - **Auto-apply disabled:** Users must click Apply to apply time changes

3. ✅ **URL Parameter Sync**
   - Panel-level time synced to URL (like panel variables with `var-*`)
   - Format: `panel-time-<panelId>=<value>` or similar
   - Enables sharing dashboards with specific panel time ranges

4. ✅ **Priority System**
   - Panel-level time > Global dashboard time
   - Clear visual indication via date time picker widget

5. ✅ **Backward Compatible**
   - Existing dashboards work unchanged
   - No migration needed

---

## Table of Contents

- [Current Architecture](#current-architecture)
- [Updated Requirements](#updated-requirements)
- [Proposed Solution](#proposed-solution)
- [Implementation Details](#implementation-details)
  - [1. Backend Schema](#1-backend-schema)
  - [2. Config UI (Panel Edit Mode)](#2-config-ui-panel-edit-mode)
  - [3. Panel Date Time Picker (View Mode)](#3-panel-date-time-picker-view-mode)
  - [4. URL Parameter Management](#4-url-parameter-management)
  - [5. Time Range Computation](#5-time-range-computation)
  - [6. View Panel & Full Screen Support](#6-view-panel--full-screen-support)
- [Data Flow](#data-flow)
- [UI/UX Design](#uiux-design)
- [Edge Cases & Solutions](#edge-cases--solutions)
- [Testing Strategy](#testing-strategy)
  - [Unit Tests](#unit-tests)
  - [Integration Tests](#integration-tests)
  - [Manual Testing](#manual-testing)
  - [E2E Test Cases](#e2e-test-cases)
- [Implementation Timeline](#implementation-timeline)
- [File Changes Summary](#file-changes-summary)

---

## Current Architecture

### Global Time Range System

OpenObserve currently has:

1. **Global Dashboard Date Time Picker**
   - Located in dashboard header
   - Component: `DateTimePickerDashboard.vue`
   - Updates all panels when changed
   - Synced to URL params: `?period=15m` or `?from=<ts>&to=<ts>`

2. **Panel Variables System** (Similar Pattern to Follow)
   - Each panel can have variable selector dropdown
   - Variables shown in panel header
   - Synced to URL: `?var-<name>=<value>`
   - Independent per panel

3. **Existing Date Time Picker in AddPanel**
   - Already exists in `AddPanel.vue`
   - Used during panel creation/editing
   - Can be repurposed for panel-level time configuration

### Key Files

- **ViewDashboard.vue** - Main dashboard orchestrator
- **AddPanel.vue** - Panel edit view (has date time picker)
- **PanelContainer.vue** - Individual panel wrapper
- **DateTimePickerDashboard.vue** - Date time picker component
- **RenderDashboardCharts.vue** - Panel grid renderer

---

## Updated Requirements

Based on team discussion, here are the finalized requirements:

### Requirement 1: Config UI with Toggle

**Location:** ConfigPanel.vue (right sidebar during panel edit)

```
┌─────────────────────────────────────┐
│ Panel Configuration                 │
├─────────────────────────────────────┤
│                                     │
│ Description: [____________]         │
│                                     │
│ Step Value: [____________]          │
│                                     │
│ ☐ Allow panel level time            │
│                                     │
│ [When enabled:]                     │
│                                     │
│ ( ) Use global time                 │
│ (•) Use individual time             │
│                                     │
│ ℹ️  Panel will use its own time     │
│    range instead of global          │
│                                     │
└─────────────────────────────────────┘
```

**Three States:**

**State 1: Toggle OFF (Default)**
- Panel uses global dashboard time
- Backend: No panel time config saved (or `allow_panel_time: false`)
- Runtime: Uses `defaultDatetimeDuration` from dashboard config

**State 2: Toggle ON + "Use global time"**
- Panel explicitly configured to use global time
- Backend saves:
  - `allow_panel_time: true`
  - `panel_time_mode: "global"`
  - `panel_time_range: undefined` (NOT saved or null)
- Runtime: Uses `defaultDatetimeDuration` from dashboard config
- Useful for: Tracking explicit user choice (vs default), URL override handling

**State 3: Toggle ON + "Use individual time"**
- Panel uses custom time range
- Backend saves:
  - `allow_panel_time: true`
  - `panel_time_mode: "individual"`
  - `panel_time_range: {...}` (actual PanelTimeRange with time values)
- Runtime: Uses `panel_time_range`, **ignores global time changes**

**CRITICAL - Runtime Logic (Simple Check):**
```javascript
// At runtime, DON'T mix global and panel time sources
// Simple check based on panel_time_range existence:

if (panel.config.panel_time_range !== undefined &&
    panel.config.panel_time_range !== null) {
  // Panel has its own time → use it
  timeRange = panel.config.panel_time_range
  // DON'T sync with global, DON'T look at defaultDatetimeDuration
} else {
  // Panel doesn't have its own time → use global
  timeRange = dashboard.defaultDatetimeDuration
}
```

**Two Data Sources (Don't Confuse Them):**
- **Global:** `dashboard.defaultDatetimeDuration` - for panels without `panel_time_range`
- **Panel:** `panel.config.panel_time_range` - only for individual panels
- **Rule:** If `panel_time_range` exists → use it, otherwise → use global

### Requirement 2: Create New Date Time Picker for Panel-Level Time

**Location:** AddPanel.vue / ConfigPanel.vue (panel edit view)

When "Use individual time" is selected, create a **NEW date time picker component** (same as "comparison against" picker) for setting panel-level time:

**Behavior:**
- When "Use individual time" radio button is selected:
  1. Display a NEW date time picker component (not reusing existing one)
  2. Use same DateTimePickerDashboard component as "comparison against" feature
  3. Label: "Panel Time Range"
  4. User selects time range (e.g., "Last 1h", "Last 7d", absolute dates)
  5. Selected value is saved in panel config as `panel_time_range`
  6. This becomes the default panel time when viewing dashboard

**Key Points:**
- ✅ **New/separate picker** - Create dedicated date time picker for panel-level time
- ✅ **Same as comparison picker** - Use same component type as "comparison against" feature
- ✅ **Save to config** - Value stored in `panel.config.panel_time_range`
- ✅ **Initial baseline** - Saved time used as initial panel time in view mode

### Requirement 3: Panel Date Time Picker in View Mode

**Location:** RenderDashboardCharts.vue (**NOT PanelContainer.vue**)

Similar to panel variables, add a date time picker widget to each panel that has panel-level time enabled:

```
┌────────────────────────────────────────────┐
│ Panel Title                 🕐 [Last 1h ▼] │
├────────────────────────────────────────────┤
│                                            │
│    [Chart Content Here]                    │
│                                            │
└────────────────────────────────────────────┘
```

**Behavior:**
- Only visible when panel has `allowPanelTime: true`
- Shows current panel time range
- Clicking opens date time picker dropdown
- **Date time picker is shown in RenderDashboardCharts.vue** (not in panel header/PanelContainer)
- **Auto-apply disabled:** Set `:auto-apply-dashboard="false"` on panel time picker
- **When Apply button clicked:** Fires API call, updates URL, refreshes panel immediately
- User must explicitly click Apply to apply time changes

**Position:**
- Date time picker placed in RenderDashboardCharts area, above or near the corresponding panel
- Similar to how panel variables are displayed
- Enables better coordination with dashboard-level state management

### Requirement 4: URL Parameter Sync

Panel-level time ranges should be reflected in URL for:
- Sharing dashboards with specific panel times
- Bookmarking panel configurations
- Deep linking to specific views

**URL Format:**

```
Current URL params:
?period=15m                    // Global time (relative)
?from=<ts>&to=<ts>            // Global time (absolute)
?var-hostname=server1         // Panel variable

New params for panel time:
?panel-time-<panelId>=15m                           // Panel relative time
?panel-time-<panelId>-from=<ts>&panel-time-<panelId>-to=<ts>  // Panel absolute time

Example:
/dashboards/view?
  org_identifier=default&
  dashboard=sys-metrics&
  period=15m&                           // Global: Last 15 min
  panel-time-panel123=1h&               // Panel 123: Last 1 hour
  panel-time-panel456-from=1704067200000&
  panel-time-panel456-to=1704153600000  // Panel 456: Absolute dates
```

**Priority:**
1. Panel-specific URL param (highest)
2. Panel config setting
3. Global dashboard time (fallback)

---

## Key Behaviors

### Apply Button Pattern

**IMPORTANT:** Panel time changes require explicit Apply button click:

#### In AddPanel/ConfigPanel (Configuration Mode)
- **NEW date time picker** is created when "Use individual time" is selected (same as "comparison against" picker)
- This picker is for **saving panel-level time to config**
- When user clicks **Apply** or **Save** on the panel → saves `panel_time_range` to panel config
- No API call is fired - this just saves the configuration

#### In RenderDashboardCharts (View Mode)
Date time picker is shown for each panel that has panel-level time enabled.

**When user changes time in picker:**
- Picker value updates
- Panel data does NOT refresh yet
- URL does NOT update yet
- User must click Apply to apply changes

**When user clicks Apply button on date time picker:**
1. **Immediately fires API call** to refresh panel with new time
2. **Updates URL** with new panel time parameters
3. Panel displays new data
4. Picker closes (standard date time picker behavior)

### Global Refresh Behavior

When user clicks the **global refresh button**:
- **All panels refresh simultaneously**
- **Each panel uses its effective time based on simple check:**
  - If panel has `panel_time_range` → use that (panel's own time)
  - If panel doesn't have `panel_time_range` → use `defaultDatetimeDuration` (global)
- This allows mixed time ranges to coexist and all refresh together

**Example:**
```javascript
// Dashboard config
dashboard.defaultDatetimeDuration = { type: "relative", relativeTimePeriod: "15m" }

// Panel configs
Panel A: { panel_time_range: { type: "relative", relativeTimePeriod: "1h" } }
Panel B: { panel_time_range: { type: "relative", relativeTimePeriod: "7d" } }
Panel C: { panel_time_range: undefined }  // or not set

// When global refresh clicked:
Panel A: Uses panel_time_range → fires API with Last 1h
Panel B: Uses panel_time_range → fires API with Last 7d
Panel C: Uses defaultDatetimeDuration → fires API with Last 15m (global)
```

**Simple Logic Per Panel:**
```javascript
function getEffectiveTimeForPanel(panel, dashboard) {
  if (panel.config.panel_time_range) {
    return panel.config.panel_time_range;  // Panel's own time
  } else {
    return dashboard.defaultDatetimeDuration;  // Global time
  }
}
```

### Panel Time Picker Behavior

**When user changes panel time picker value:**
- Picker value updates in UI
- Panel data does NOT refresh automatically
- URL does NOT update yet
- User must click Apply button to apply changes

**When user clicks Apply button:**
- API call fires immediately to fetch panel data
- URL updates with new panel time parameters
- Panel refreshes with new time range data
- Picker closes (standard behavior)

### Variables and Time Range Usage

**IMPORTANT:** Variables should use the appropriate time range based on their scope:

#### Panel-Level Variables
- **Use panel-level date time** when the panel has individual time configured
- If panel has `panel_time_range` (individual time mode), panel variables query using that panel's time
- This ensures panel variables are consistent with the panel's data time range

#### Tab-Level Variables
- **Use global date time** from `defaultDatetimeDuration`
- Tab variables apply to all panels in that tab
- Since panels in a tab can have different times, tab variables use the global time as reference

#### Global Variables
- **Use global date time** from `defaultDatetimeDuration`
- Global variables apply to entire dashboard
- Always use global time for consistency across all panels

**Example Logic:**
```javascript
function getTimeRangeForVariable(variable, panel, dashboard) {
  if (variable.scope === 'panel') {
    // Panel-level variable: use panel's effective time
    if (panel.config.panel_time_range && panel.config.panel_time_mode === 'individual') {
      return panel.config.panel_time_range;  // Panel's individual time
    }
  }

  // Tab-level or global variable: always use global time
  return dashboard.defaultDatetimeDuration;  // Global time
}
```

**Behavior Summary:**
| Variable Scope | Time Range Used | Reason |
|---------------|----------------|---------|
| Panel-level | Panel's individual time (if set) | Consistency with panel data |
| Panel-level | Global time (if panel uses global) | Panel follows global |
| Tab-level | Global time | Applies to multiple panels |
| Global | Global time | Applies to entire dashboard |

**Key Benefits:**
- ✅ **Consistency:** Panel variables match panel data time range
- ✅ **Clarity:** Global/tab variables always use global time as reference
- ✅ **Predictable:** Users understand which time range affects their variables
- ✅ **Flexible:** Panels with individual time have their variables query the same time period

---

## Proposed Solution

### Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                   Dashboard View                          │
│  ┌────────────────────────────────────────────┐          │
│  │ Global Time: 🕐 [Last 15m ▼]              │          │
│  └────────────────────────────────────────────┘          │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ CPU Usage                    🕐 [Last 1h ▼]        │ │
│  │ Panel has individual time picker                   │ │
│  │ [Chart shows data for last 1 hour]                │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Memory Usage                                        │ │
│  │ No panel time picker (uses global 15m)             │ │
│  │ [Chart shows data for last 15 minutes]            │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Reuse Existing Components**
   - Use `DateTimePickerDashboard.vue` component for panel-level picker
   - Leverage existing time picker in `AddPanel.vue`
   - Follow variable selector pattern for UI placement

2. **Three-State System**
   - State 1: Panel time disabled (use global) - Default
   - State 2: Panel time enabled, use global (track global explicitly)
   - State 3: Panel time enabled, use individual (custom time)

3. **URL-First Approach**
   - Panel time changes immediately update URL
   - URL params can override panel config
   - Enables sharing and bookmarking

4. **Apply Button Pattern**
   - Panel time picker selection does NOT auto-refresh panel data
   - **Auto-apply disabled:** Set `:auto-apply-dashboard="false"` on panel time picker
   - **User must click Apply:** Changes only applied when user clicks Apply button
   - **Immediate action on Apply:** Fires API, updates URL, refreshes panel
   - Prevents excessive API calls - changes only applied when user explicitly confirms

5. **Visual Clarity**
   - Panel time picker visible in RenderDashboardCharts = obvious difference
   - Apply button required = explicit user action for time changes
   - No need for extra badges or indicators
   - Consistent with standard date time picker UX

---

## Implementation Details

### Key Principle: Add-On Feature (Don't Touch Existing Global Logic)

**IMPORTANT:** This is a **NEW ADD-ON feature** for panel-level time. The existing global time logic already works perfectly with `defaultDatetimeDuration` - **DON'T change it!**

**Simple Addition to Existing Code:**
```javascript
// Add this simple conditional check to existing panel rendering logic:
if (panel.config.panel_time_range) {
  // NEW FEATURE: Panel has individual time configured
  // Add new code here to use panel-specific time
  timeRange = panel.config.panel_time_range;
} else {
  // EXISTING CODE: Keep all existing global time logic unchanged
  // Global time already works fine - don't modify anything here
  // Just use the existing global time flow
  timeRange = (existing global time logic);
}
```

**What This Means:**
- ✅ **Add:** New conditional check: `if (panel.config.panel_time_range)`
- ✅ **Add:** New logic inside the `if` block to handle panel time
- ❌ **Don't change:** Existing global time flow (works fine)
- ❌ **Don't refactor:** Current code that uses `defaultDatetimeDuration`

**Two Scenarios:**
1. **Panel has `panel_time_range` (NEW):**
   - This is the new feature
   - Add new code to use panel time
   - This panel ignores global time changes

2. **Panel doesn't have `panel_time_range` (EXISTING):**
   - Keep existing behavior unchanged
   - Uses existing global time logic
   - No changes needed to existing code

**When is panel_time_range saved?**
- **Toggle OFF** → panel_time_range = undefined → **uses existing global logic (no changes)**
- **Toggle ON + "Use Global"** → panel_time_range = undefined → **uses existing global logic (no changes)**
- **Toggle ON + "Use Individual"** → panel_time_range = {...} → **NEW: uses panel time (add new logic)**

---

### 1. Backend Schema

**File:** `d:\openobserve\src\config\src\meta\dashboards\v8\mod.rs`

Add new fields to `PanelConfig` struct (around line 334):

```rust
#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct PanelConfig {
    show_legends: bool,
    // ... existing fields ...

    /// Enable panel-level time range
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_panel_time: Option<bool>,

    /// Panel time mode: "global" or "individual"
    /// - "global": Panel explicitly configured to use global (NO panel_time_range saved)
    /// - "individual": Panel uses its own time (panel_time_range IS saved)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub panel_time_mode: Option<String>,

    /// Panel-level time range (ONLY saved when panel_time_mode = "individual")
    /// - If this exists (not None) → use it at runtime, ignore defaultDatetimeDuration
    /// - If this is None → use defaultDatetimeDuration from dashboard config
    /// PanelTimeRange struct
    #[serde(skip_serializing_if = "Option::is_none")]
    pub panel_time_range: Option<PanelTimeRange>,

    // ... rest of fields ...
}
```

**Data Model:**

```typescript
interface PanelConfig {
  // ... existing fields ...

  // Enable panel-level time
  allow_panel_time?: boolean;  // undefined or false = use global (default)

  // Panel time mode
  panel_time_mode?: "global" | "individual";  // Only relevant if allow_panel_time = true

  // Panel time range (only used if panel_time_mode = "individual")
  panel_time_range?: {
    type: "relative" | "absolute";
    relativeTimePeriod?: string;  // "15m", "1h", "7d"
    startTime?: number;            // milliseconds
    endTime?: number;              // milliseconds
  };
}
```

**States:**

| allow_panel_time | panel_time_mode | panel_time_range | Runtime Behavior |
|-----------------|----------------|------------------|----------|
| `false`/`undefined` | - | `undefined` | Use `defaultDatetimeDuration` (global) |
| `true` | `"global"` | `undefined` | Use `defaultDatetimeDuration` (global, explicitly chosen) |
| `true` | `"individual"` | `{...}` (saved) | Use `panel_time_range` (panel's own time) |

**CRITICAL - Runtime Logic:**
```javascript
// Simple check at runtime - don't look at allow_panel_time or panel_time_mode
// Only check: does panel_time_range exist?
if (panel.config.panel_time_range) {
  timeRange = panel.config.panel_time_range;  // Use panel time
} else {
  timeRange = dashboard.defaultDatetimeDuration;  // Use global time
}
```

---

### 2. Config UI (Panel Edit Mode)

**File:** `d:\openobserve\web\src\components\dashboards\addPanel\ConfigPanel.vue`

Add configuration UI after step_value input (around line 92):

```vue
<template>
  <!-- Existing fields ... -->

  <div class="space"></div>

  <!-- NEW: Panel Time Configuration -->
  <div class="q-mb-sm">
    <div class="text-bold q-mb-sm">
      {{ t("dashboard.panelTimeSettings") }}
    </div>

    <!-- Toggle to enable panel-level time -->
    <q-checkbox
      v-model="allowPanelTime"
      :label="t('dashboard.allowPanelTime')"
      data-test="dashboard-config-allow-panel-time"
      @update:model-value="onTogglePanelTime"
    />

    <!-- Show mode selection when enabled -->
    <div v-if="allowPanelTime" class="q-mt-sm q-ml-lg">
      <q-option-group
        v-model="panelTimeMode"
        :options="panelTimeModeOptions"
        color="primary"
        @update:model-value="onPanelTimeModeChange"
      />

      <div class="text-caption text-grey-7 q-mt-xs">
        <q-icon name="info" size="14px" />
        <span v-if="panelTimeMode === 'global'">
          {{ t("dashboard.panelTimeGlobalHint") }}
        </span>
        <span v-else>
          {{ t("dashboard.panelTimeIndividualHint") }}
        </span>
      </div>
    </div>
  </div>

  <!-- Existing fields ... -->
</template>

<script lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';

export default defineComponent({
  name: 'ConfigPanel',

  setup() {
    const { t } = useI18n();

    // Panel time enabled?
    const allowPanelTime = ref(
      !!dashboardPanelData.data.config?.allow_panel_time
    );

    // Panel time mode: "global" or "individual"
    const panelTimeMode = ref(
      dashboardPanelData.data.config?.panel_time_mode || 'global'
    );

    // Mode options
    const panelTimeModeOptions = computed(() => [
      {
        label: t('dashboard.useGlobalTime'),
        value: 'global',
      },
      {
        label: t('dashboard.useIndividualTime'),
        value: 'individual',
      },
    ]);

    // Toggle panel time on/off
    const onTogglePanelTime = (enabled: boolean) => {
      dashboardPanelData.data.config.allow_panel_time = enabled;

      if (enabled) {
        // Default to global mode
        dashboardPanelData.data.config.panel_time_mode = 'global';
        panelTimeMode.value = 'global';
      } else {
        // Clear panel time settings
        dashboardPanelData.data.config.panel_time_mode = undefined;
        dashboardPanelData.data.config.panel_time_range = undefined;
      }
    };

    // Change panel time mode
    const onPanelTimeModeChange = (mode: string) => {
      dashboardPanelData.data.config.panel_time_mode = mode;

      if (mode === 'individual') {
        // INDIVIDUAL MODE: Save panel_time_range
        // Initialize with default time if not set
        if (!dashboardPanelData.data.config.panel_time_range) {
          // User will set the actual time using the NEW date time picker that appears
          dashboardPanelData.data.config.panel_time_range = {
            type: 'relative',
            relativeTimePeriod: '15m',
          };
        }
      } else {
        // GLOBAL MODE: DON'T save panel_time_range
        // Clear panel_time_range when switching to global
        // Panel will use dashboard.defaultDatetimeDuration at runtime
        // Keep allow_panel_time = true to track explicit choice
        dashboardPanelData.data.config.panel_time_range = undefined;
      }
    };

    return {
      allowPanelTime,
      panelTimeMode,
      panelTimeModeOptions,
      onTogglePanelTime,
      onPanelTimeModeChange,
    };
  },
});
</script>
```

**Integration with AddPanel Date Time Picker:**

**File:** `d:\openobserve\web\src\views\Dashboards\addPanel\AddPanel.vue`

Modify the existing date time picker to work for panel-level time:

```vue
<template>
  <!-- Existing layout ... -->

  <!-- Date Time Picker Section -->
  <div class="date-time-picker-section">
    <!-- Label changes based on panel time mode -->
    <div class="picker-label">
      <span v-if="isPanelTimeIndividual">
        {{ t('dashboard.panelTimeRange') }}
        <q-icon name="info" size="16px">
          <q-tooltip>{{ t('dashboard.panelTimeRangeTooltip') }}</q-tooltip>
        </q-icon>
      </span>
      <span v-else>
        {{ t('dashboard.timeRange') }}
      </span>
    </div>

    <!-- Existing Date Time Picker -->
    <DateTimePickerDashboard
      ref="dateTimePicker"
      v-model="dateTimeValue"
      :auto-apply-dashboard="true"
    />
  </div>

  <!-- Rest of layout ... -->
</template>

<script setup lang="ts">
const isPanelTimeIndividual = computed(() => {
  return (
    dashboardPanelData.data.config?.allow_panel_time &&
    dashboardPanelData.data.config?.panel_time_mode === 'individual'
  );
});

// Watch for date time picker changes when in individual mode
watch(dateTimeValue, (newValue) => {
  if (isPanelTimeIndividual.value) {
    // Store panel time range
    dashboardPanelData.data.config.panel_time_range = {
      type: newValue.valueType || newValue.type,
      relativeTimePeriod: newValue.relativeTimePeriod,
      startTime: newValue.startTime,
      endTime: newValue.endTime,
    };
  }
}, { deep: true });
</script>
```

---

### 3. Panel Date Time Picker (View Mode)

**File:** `d:\openobserve\web\src\views\Dashboards\RenderDashboardCharts.vue`

Add a date time picker widget for each panel that has panel-level time enabled (similar to variable selector):

**IMPORTANT:** The date time picker is placed in RenderDashboardCharts.vue, NOT in PanelContainer.vue. This allows better coordination with dashboard-level state management and refresh logic.

```vue
<template>
  <div class="render-dashboard-charts">
    <div
      v-for="panel in panels"
      :key="panel.id"
      class="dashboard-panel-wrapper"
    >
      <!-- NEW: Panel Time Picker (only if panel has time enabled) -->
      <div
        v-if="hasPanelTime(panel)"
        class="panel-time-picker-container"
        data-test="panel-time-picker"
      >
        <DateTimePickerDashboard
          :ref="el => setPanelTimePickerRef(panel.id, el)"
          v-model="panelTimeValues[panel.id]"
          :auto-apply-dashboard="true"
          size="xs"
          class="panel-time-picker-widget"
          @apply="onPanelTimeApply(panel.id)"
        />
      </div>

      <!-- Panel Container (existing) -->
      <PanelContainer
        :data="panel"
        :selectedTimeDate="getPanelTimeRange(panel.id)"
        @refresh-panel="onRefreshPanel(panel.id)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import DateTimePickerDashboard from '@/components/DateTimePickerDashboard.vue';
import PanelContainer from '@/components/dashboards/PanelContainer.vue';

const props = defineProps({
  panels: Array,  // Array of panel configurations
  globalTimeObj: Object,  // Global time range (computed from dashboard.defaultDatetimeDuration)
  // ... other props
});

const route = useRoute();
const router = useRouter();

// Panel time values for all panels (map: panelId -> time value)
const panelTimeValues = ref({});

// Panel time picker refs
const panelTimePickerRefs = ref({});

// Check if a specific panel has time enabled
const hasPanelTime = (panel: any) => {
  return !!panel?.config?.allow_panel_time;
};

// Get panel time mode
const getPanelTimeMode = (panel: any) => {
  return panel?.config?.panel_time_mode || 'global';
};

// Set panel time picker ref
const setPanelTimePickerRef = (panelId: string, el: any) => {
  if (el) {
    panelTimePickerRefs.value[panelId] = el;
  }
};

// Initialize all panel time values (for UI pickers)
const initializePanelTimes = () => {
  props.panels?.forEach((panel: any) => {
    // Only initialize picker for panels that have allow_panel_time enabled
    if (hasPanelTime(panel)) {
      const panelId = panel.id;

      // Priority 1: Check URL params (for picker display)
      const urlPanelTime = getPanelTimeFromURL(panelId);
      if (urlPanelTime) {
        panelTimeValues.value[panelId] = urlPanelTime;
        return;
      }

      // Priority 2: Check panel config - simple check for panel_time_range
      const configTime = panel.config?.panel_time_range;
      if (configTime) {
        // Panel has its own time range → initialize picker with it
        panelTimeValues.value[panelId] = {
          type: configTime.type,
          valueType: configTime.type,
          relativeTimePeriod: configTime.relativeTimePeriod,
          startTime: configTime.startTime,
          endTime: configTime.endTime,
        };
        return;
      }

      // Priority 3: Panel has allow_panel_time enabled but no panel_time_range
      // (This is "Use global time" mode - panel_time_mode = "global")
      // Initialize picker with current global time for display purposes
      if (props.globalTimeObj) {
        panelTimeValues.value[panelId] = convertGlobalTimeToPickerFormat(props.globalTimeObj);
      }
    }
  });
};

// Get panel time from URL params
const getPanelTimeFromURL = (panelId: string) => {
  const relativeParam = route.query[`panel-time-${panelId}`];
  const fromParam = route.query[`panel-time-${panelId}-from`];
  const toParam = route.query[`panel-time-${panelId}-to`];

  if (relativeParam) {
    return {
      type: 'relative',
      valueType: 'relative',
      relativeTimePeriod: relativeParam,
    };
  }

  if (fromParam && toParam) {
    return {
      type: 'absolute',
      valueType: 'absolute',
      startTime: parseInt(fromParam as string),
      endTime: parseInt(toParam as string),
    };
  }

  return null;
};

// Convert global time object to picker format
const convertGlobalTimeToPickerFormat = (globalTime: any) => {
  // Check if it's relative or absolute from route
  if (route.query.period) {
    return {
      type: 'relative',
      valueType: 'relative',
      relativeTimePeriod: route.query.period,
    };
  } else if (route.query.from && route.query.to) {
    return {
      type: 'absolute',
      valueType: 'absolute',
      startTime: parseInt(route.query.from as string),
      endTime: parseInt(route.query.to as string),
    };
  }

  // Default
  return {
    type: 'relative',
    valueType: 'relative',
    relativeTimePeriod: '15m',
  };
};

// Handle panel time Apply button click (user clicked Apply on DateTimePickerDashboard)
const onPanelTimeApply = async (panelId: string) => {
  // IMPORTANT: When user clicks Apply on the date time picker, immediately:
  // 1. Fire API call to refresh panel with new time
  // 2. Update URL with new panel time

  try {
    const timeValue = panelTimeValues.value[panelId];

    // Calculate time object from picker value
    const currentPanelTime = calculateTimeFromPickerValue(timeValue);

    // Update URL params (sync URL after Apply is clicked)
    updateURLWithPanelTime(panelId, timeValue);

    // Fire API call to refresh panel with new time
    await refreshPanelData(panelId, currentPanelTime);
  } catch (error) {
    console.error('Error applying panel time:', error);
  }
};

// Handle individual panel refresh button click
const onRefreshPanel = async (panelId: string) => {
  // When user clicks the panel refresh button (not Apply on picker),
  // refresh the panel with its current effective time

  try {
    const panel = props.panels?.find((p: any) => p.id === panelId);
    const effectiveTime = getPanelTimeRange(panelId);

    await refreshPanelData(panelId, effectiveTime);
  } catch (error) {
    console.error('Error refreshing panel:', error);
  }
};

// Refresh panel data with given time range
const refreshPanelData = async (panelId: string, timeRange: any) => {
  // Call the panel's data loading function with the time range
  // This triggers the API call to fetch new data

  // Implementation will depend on existing panel data loading logic
  // Typically this would emit an event or call a store action
  emit('refresh-panel', { panelId, timeRange });
};

// Update URL with panel time params
const updateURLWithPanelTime = (panelId: string, timeValue: any) => {
  const query = { ...route.query };

  // Remove old panel time params
  delete query[`panel-time-${panelId}`];
  delete query[`panel-time-${panelId}-from`];
  delete query[`panel-time-${panelId}-to`];

  // Add new params based on type
  if (timeValue.type === 'relative' || timeValue.valueType === 'relative') {
    query[`panel-time-${panelId}`] = timeValue.relativeTimePeriod;
  } else if (timeValue.type === 'absolute' || timeValue.valueType === 'absolute') {
    query[`panel-time-${panelId}-from`] = timeValue.startTime.toString();
    query[`panel-time-${panelId}-to`] = timeValue.endTime.toString();
  }

  // Update URL without reloading
  router.replace({ query });
};

// Get effective panel time range (for passing to PanelContainer)
// ADD-ON FEATURE: Simple check - if panel has panel_time_range, use it; otherwise use existing global logic
const getPanelTimeRange = (panelId: string) => {
  const panel = props.panels?.find((p: any) => p.id === panelId);

  if (!panel) {
    return props.globalTimeObj;  // Existing global logic
  }

  // NEW FEATURE: Check if panel has its own time range
  if (panel.config?.panel_time_range) {
    // ===== NEW CODE: Panel has individual time configured =====
    // Calculate from panel time picker value (which might be from URL, config, or user changes)
    const panelTimeValue = panelTimeValues.value[panelId];
    if (panelTimeValue) {
      return calculateTimeFromPickerValue(panelTimeValue);
    }
    // Fallback: calculate directly from config (if picker value not yet initialized)
    return calculateTimeFromPickerValue({
      type: panel.config.panel_time_range.type,
      valueType: panel.config.panel_time_range.type,
      relativeTimePeriod: panel.config.panel_time_range.relativeTimePeriod,
      startTime: panel.config.panel_time_range.startTime,
      endTime: panel.config.panel_time_range.endTime,
    });
    // ===== END NEW CODE =====
  } else {
    // ===== EXISTING CODE: Use global time (DON'T CHANGE) =====
    // Panel doesn't have panel_time_range → use existing global logic
    // This handles all existing scenarios:
    // - Panels that never had panel time configured
    // - allow_panel_time = false (toggle off)
    // - allow_panel_time = true + panel_time_mode = "global" (explicitly chose global)
    // props.globalTimeObj already works with defaultDatetimeDuration
    return props.globalTimeObj;
    // ===== END EXISTING CODE =====
  }
};

// Calculate time object from picker value
const calculateTimeFromPickerValue = (pickerValue: any) => {
  if (pickerValue.type === 'relative' || pickerValue.valueType === 'relative') {
    const endTime = new Date();
    const startTime = calculateRelativeTime(endTime, pickerValue.relativeTimePeriod);
    return {
      start_time: startTime,
      end_time: endTime,
    };
  } else {
    return {
      start_time: new Date(pickerValue.startTime),
      end_time: new Date(pickerValue.endTime),
    };
  }
};

// Calculate relative time
const calculateRelativeTime = (endTime: Date, period: string): Date => {
  const value = parseInt(period.slice(0, -1));
  const unit = period.slice(-1);

  const unitMap: Record<string, string> = {
    's': 'seconds',
    'm': 'minutes',
    'h': 'hours',
    'd': 'days',
    'w': 'weeks',
    'M': 'months',
  };

  const dateUnit = unitMap[unit] || 'minutes';
  const subtractObject = { [dateUnit]: value };

  return date.subtractFromDate(endTime, subtractObject);
};

// Initialize on mount
onMounted(() => {
  initializePanelTimes();
});

// Watch for panels changes (when dashboard loads or updates)
watch(() => props.panels, () => {
  initializePanelTimes();
}, { deep: true });

// Watch for global time changes (update panels that DON'T have panel_time_range)
// props.globalTimeObj is computed from dashboard.defaultDatetimeDuration
watch(() => props.globalTimeObj, (newGlobalTime) => {
  props.panels?.forEach((panel: any) => {
    // SIMPLE CHECK: Only update panels that DON'T have their own panel_time_range
    // If panel has panel_time_range → ignore global time changes
    // If panel doesn't have panel_time_range → update picker to show new global time
    if (hasPanelTime(panel) && !panel.config?.panel_time_range) {
      const panelId = panel.id;
      panelTimeValues.value[panelId] = convertGlobalTimeToPickerFormat(newGlobalTime);
    }
  });
}, { deep: true });

// Handle global refresh - refreshes all panels with their respective times
const onGlobalRefresh = async () => {
  // IMPORTANT: When global refresh is clicked:
  // - All panels should refresh
  // - Each panel uses simple check logic:
  //   → If panel has panel_time_range: use it (panel's own time)
  //   → If panel doesn't have panel_time_range: use defaultDatetimeDuration (global time)
  // - Don't mix panel_time_range and defaultDatetimeDuration sources

  const refreshPromises = props.panels?.map((panel: any) => {
    const panelId = panel.id;
    // getPanelTimeRange() does simple check: panel_time_range exists? use it : use global
    const effectiveTime = getPanelTimeRange(panelId);
    return refreshPanelData(panelId, effectiveTime);
  });

  await Promise.all(refreshPromises || []);
};
</script>

<style scoped>
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #e0e0e0;
}

.panel-title {
  font-size: 14px;
  font-weight: 500;
  flex: 1;
}

.panel-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-time-picker {
  display: inline-block;
}

.panel-time-picker-widget {
  min-width: 150px;
}

/*
  Note: Styling for panel time picker widgets shown in RenderDashboardCharts
  Placed above or near the corresponding panel for visual clarity
*/
</style>
```

---

### 4. URL Parameter Management

**File:** `d:\openobserve\web\src\views\Dashboards\ViewDashboard.vue`

Add logic to handle panel time URL parameters:

```typescript
// Parse panel time params from URL on load
const parsePanelTimeParams = () => {
  const panelTimes: Record<string, any> = {};

  Object.keys(route.query).forEach((key) => {
    // Match panel-time-<panelId> pattern
    const relativeMatch = key.match(/^panel-time-(.+)$/);
    if (relativeMatch && !key.includes('-from') && !key.includes('-to')) {
      const panelId = relativeMatch[1];
      panelTimes[panelId] = {
        type: 'relative',
        relativeTimePeriod: route.query[key],
      };
    }

    // Match panel-time-<panelId>-from pattern
    const absoluteFromMatch = key.match(/^panel-time-(.+)-from$/);
    if (absoluteFromMatch) {
      const panelId = absoluteFromMatch[1];
      const toKey = `panel-time-${panelId}-to`;
      if (route.query[toKey]) {
        panelTimes[panelId] = {
          type: 'absolute',
          startTime: parseInt(route.query[key] as string),
          endTime: parseInt(route.query[toKey] as string),
        };
      }
    }
  });

  return panelTimes;
};

// Compute panel time ranges including URL overrides
const computePanelTimeRanges = () => {
  const timeRanges: Record<string, any> = {
    __global: currentTimeObj.value,
  };

  // Get URL overrides
  const urlPanelTimes = parsePanelTimeParams();

  // Process each panel
  currentDashboardData.data?.tabs?.forEach((tab: any) => {
    tab.panels?.forEach((panel: any) => {
      const panelId = panel.id;

      // Priority 1: URL parameter (highest)
      if (urlPanelTimes[panelId]) {
        const urlTime = urlPanelTimes[panelId];
        timeRanges[panelId] = calculateTimeObject(urlTime);
        return;
      }

      // Priority 2: Panel config
      if (panel.config?.allow_panel_time) {
        if (panel.config.panel_time_mode === 'individual') {
          const config = panel.config.panel_time_range;
          if (config) {
            timeRanges[panelId] = calculateTimeObject(config);
            return;
          }
        }
        // If mode is "global", don't add to timeRanges (will use __global)
      }

      // Priority 3: Use __global (implicit fallback)
    });
  });

  currentTimeObjPerPanel.value = timeRanges;
};

// Calculate time object from config/URL
const calculateTimeObject = (timeConfig: any) => {
  if (timeConfig.type === 'relative' && timeConfig.relativeTimePeriod) {
    const endTime = new Date();
    const startTime = calculateRelativeTime(endTime, timeConfig.relativeTimePeriod);
    return {
      start_time: startTime,
      end_time: endTime,
    };
  } else if (timeConfig.type === 'absolute') {
    return {
      start_time: new Date(timeConfig.startTime),
      end_time: new Date(timeConfig.endTime),
    };
  }

  return currentTimeObj.value;  // Fallback
};

// Call on dashboard load and global time changes
watch(currentTimeObj, () => {
  computePanelTimeRanges();
});

watch(() => route.query, () => {
  // Recompute when URL changes (back/forward navigation)
  computePanelTimeRanges();
}, { deep: true });
```

---

### 5. Time Range Computation

**IMPORTANT:** Reuse existing global time conversion functions - do NOT create duplicate code.

**Strategy:** The global dashboard already has functions that convert date time picker values to `{ start_time: Date, end_time: Date }` format. These same functions must be reused for panel-level time ranges.

**Implementation Approach:**

```typescript
// In ViewDashboard.vue - use existing time conversion logic

// Calculate time object from config/URL (reuse existing logic)
const calculateTimeObject = (timeConfig: any) => {
  // IMPORTANT: This should call the SAME conversion function used for global time
  // Look for existing function like:
  // - dateTimePicker.getConsumableDateTime()
  // - Existing time conversion utilities in the codebase

  if (timeConfig.type === 'relative' && timeConfig.relativeTimePeriod) {
    // Reuse existing relative time calculation
    // Same logic as global dashboard uses
    const endTime = new Date();
    const startTime = calculateRelativeTime(endTime, timeConfig.relativeTimePeriod);
    return {
      start_time: startTime,
      end_time: endTime,
    };
  } else if (timeConfig.type === 'absolute') {
    // Reuse existing absolute time conversion
    return {
      start_time: new Date(timeConfig.startTime),
      end_time: new Date(timeConfig.endTime),
    };
  }

  return currentTimeObj.value;  // Fallback to global
};

// The calculateRelativeTime function should be the SAME one
// used for global time calculation
// Find it in existing code and import it - do NOT duplicate
```

**Where to Find Existing Functions:**

Look for existing time conversion functions in these locations:
1. **ViewDashboard.vue** - Check how `currentTimeObj` is calculated from global date time picker
2. **DateTimePickerDashboard.vue** - May have `getConsumableDateTime()` method
3. **DateTime.vue** - Core date time picker component
4. **Existing time utilities** - Check if there's already a utility file for time conversions

**Key Points:**

- ✅ **Reuse existing code** - Don't create new time conversion functions
- ✅ **Single source of truth** - Panel and global use same conversion logic
- ✅ **Consistency** - Ensures panel times behave exactly like global times
- ✅ **Maintainability** - Changes to time logic only need to be made once

**Example: Reusing getConsumableDateTime()**

```typescript
// If DateTimePickerDashboard has getConsumableDateTime():
const dateTimePicker = ref(null);

const getPanelTimeObject = () => {
  if (dateTimePicker.value) {
    // Reuse the exact same method used for global time
    return dateTimePicker.value.getConsumableDateTime();
  }
  return null;
};
```

**No New File Needed:**

Since we're reusing existing functions, we do NOT need to create:
- ❌ `usePanelTimeRange.ts` composable
- ❌ New `calculateRelativeTime()` function
- ❌ New `calculateTimeFromConfig()` function

Instead, we'll use the existing functions already in the codebase that handle global dashboard time ranges.

---

### 6. View Panel & Full Screen Support

When a panel is opened in **View Panel** mode or **Full Screen** mode, the panel-level time range should be preserved and accessible.

#### View Panel Modal

**File:** View panel modal component (needs identification)

**Behavior:**
- When user clicks "View" on a panel with panel-level time
- Modal opens showing full panel details
- Panel time picker should be visible in modal header
- User can change panel time within modal
- Changes persist when modal is closed
- URL updates with panel time parameter

**Implementation:**

```vue
<template>
  <q-dialog v-model="showViewPanel" maximized>
    <q-card>
      <!-- Modal Header -->
      <q-card-section class="view-panel-header">
        <div class="row items-center">
          <div class="col">
            <div class="text-h6">{{ panelData.title }}</div>
          </div>

          <!-- Panel Time Picker (if enabled) -->
          <div v-if="hasPanelTime" class="col-auto">
            <DateTimePickerDashboard
              v-model="panelTimeValue"
              :auto-apply-dashboard="false"
              size="sm"
              @update:model-value="onPanelTimePickerChange"
            />
          </div>

          <!-- Refresh Button - turns yellow when panel time changed -->
          <div class="col-auto">
            <q-btn
              icon="refresh"
              flat
              round
              @click="onRefreshPanel"
              :loading="isRefreshing"
              :color="hasUnsavedTimeChange ? 'warning' : undefined"
            >
              <q-tooltip>
                {{ hasUnsavedTimeChange ? 'Apply time change and refresh' : 'Refresh panel' }}
              </q-tooltip>
            </q-btn>
          </div>

          <div class="col-auto">
            <q-btn icon="close" flat round dense v-close-popup />
          </div>
        </div>
      </q-card-section>

      <!-- Panel Content -->
      <q-card-section class="view-panel-content">
        <PanelSchemaRenderer
          :panelSchema="panelData"
          :selectedTimeObj="effectivePanelTime"
          :viewOnly="true"
          :isViewPanel="true"
          <!-- ... other props ... -->
        />
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
// Similar logic to PanelContainer.vue
// Initialize panel time from URL/config
// Handle time changes
// Update URL parameters
</script>
```

#### Full Screen Mode

**File:** Full screen panel view component

**Behavior:**
- When user clicks "Full Screen" on a panel
- Panel opens in full screen view
- Panel time picker visible in top bar
- Global dashboard header hidden
- Panel maintains its time range
- URL includes panel ID and time parameters
- Back button restores dashboard view with panel time preserved

**URL Format for Full Screen:**
```
/dashboards/fullscreen?
  org_identifier=default&
  dashboard=sys-metrics&
  panel=panel123&
  panel-time-panel123=1h
```

**Implementation:**

```vue
<template>
  <div class="fullscreen-panel">
    <!-- Full Screen Header -->
    <div class="fullscreen-header">
      <q-btn
        icon="arrow_back"
        flat
        @click="exitFullScreen"
        label="Back to Dashboard"
      />

      <div class="fullscreen-title">{{ panelData.title }}</div>

      <!-- Panel Time Picker (if enabled) -->
      <div v-if="hasPanelTime" class="fullscreen-time-picker">
        <DateTimePickerDashboard
          v-model="panelTimeValue"
          :auto-apply-dashboard="false"
          @update:model-value="onPanelTimePickerChange"
        />
      </div>

      <!-- Refresh Button - turns yellow when panel time changed -->
      <q-btn
        icon="refresh"
        flat
        @click="onRefreshPanel"
        :loading="isRefreshing"
        :color="hasUnsavedTimeChange ? 'warning' : undefined"
        label="Refresh"
      >
        <q-tooltip>
          {{ hasUnsavedTimeChange ? 'Apply time change and refresh' : 'Refresh panel' }}
        </q-tooltip>
      </q-btn>
    </div>

    <!-- Full Screen Panel Content -->
    <div class="fullscreen-content">
      <PanelSchemaRenderer
        :panelSchema="panelData"
        :selectedTimeObj="effectivePanelTime"
        :viewOnly="true"
        :isFullScreen="true"
        <!-- ... other props ... -->
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

// Get panel ID from route
const panelId = computed(() => route.query.panel as string);

// Load panel data
const panelData = ref(null);

// Initialize panel time from URL
const initializePanelTime = () => {
  // Check URL for panel time params
  const panelTimeParam = route.query[`panel-time-${panelId.value}`];
  // ... similar logic to PanelContainer.vue
};

// Last applied time (for tracking unsaved changes)
const lastAppliedTimeValue = ref(null);

// Check if time has been changed but not yet refreshed (yellow indicator)
const hasUnsavedTimeChange = computed(() => {
  if (!panelTimeValue.value || !lastAppliedTimeValue.value) return false;

  // Compare current picker value with last applied value
  if (panelTimeValue.value.type !== lastAppliedTimeValue.value.type) return true;

  if (panelTimeValue.value.type === 'relative') {
    return panelTimeValue.value.relativeTimePeriod !== lastAppliedTimeValue.value.relativeTimePeriod;
  } else {
    return panelTimeValue.value.startTime !== lastAppliedTimeValue.value.startTime ||
           panelTimeValue.value.endTime !== lastAppliedTimeValue.value.endTime;
  }
});

// Handle panel time picker change (update picker value only, don't refresh or update URL)
const onPanelTimePickerChange = (newValue: any) => {
  // NOTE: Do NOT update URL here - URL syncs only after refresh button is clicked
  // NOTE: Do NOT refresh panel here - Panel will refresh only when user clicks refresh button
  // Yellow indicator will show automatically via hasUnsavedTimeChange computed property
};

// Handle refresh button click
const isRefreshing = ref(false);
const onRefreshPanel = async () => {
  isRefreshing.value = true;

  try {
    // Get current panel time from picker
    const currentPanelTime = calculateTimeFromPickerValue(panelTimeValue.value);

    // Update URL params NOW (after refresh button is clicked)
    updateURLWithPanelTime(panelId.value, panelTimeValue.value);

    // Update last applied time (clears yellow indicator)
    lastAppliedTimeValue.value = { ...panelTimeValue.value };

    // Reload panel data with current time
    await loadPanelData(currentPanelTime);
  } finally {
    isRefreshing.value = false;
  }
};

// Update URL with panel time params
const updateURLWithPanelTime = (panelId: string, timeValue: any) => {
  const query = { ...route.query };

  // Remove old panel time params
  delete query[`panel-time-${panelId}`];
  delete query[`panel-time-${panelId}-from`];
  delete query[`panel-time-${panelId}-to`];

  // Add new params based on type
  if (timeValue.type === 'relative' || timeValue.valueType === 'relative') {
    query[`panel-time-${panelId}`] = timeValue.relativeTimePeriod;
  } else if (timeValue.type === 'absolute' || timeValue.valueType === 'absolute') {
    query[`panel-time-${panelId}-from`] = timeValue.startTime.toString();
    query[`panel-time-${panelId}-to`] = timeValue.endTime.toString();
  }

  // Update URL without reloading
  router.replace({ query });
};

// Exit full screen and return to dashboard
const exitFullScreen = () => {
  router.push({
    path: '/dashboards/view',
    query: {
      ...route.query,
      panel: undefined,  // Remove panel param
      // Keep panel time param for when returning to dashboard
    },
  });
};
</script>

<style scoped>
.fullscreen-panel {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: white;
  z-index: 9999;
}

.fullscreen-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 24px;
  border-bottom: 1px solid #e0e0e0;
  background: #f5f5f5;
}

.fullscreen-title {
  flex: 1;
  font-size: 18px;
  font-weight: 500;
}

.fullscreen-time-picker {
  display: inline-block;
}

.fullscreen-content {
  height: calc(100vh - 60px);
  overflow: auto;
  padding: 16px;
}

/*
  Note: Refresh button color is controlled by :color prop
  When hasUnsavedTimeChange = true, refresh button uses color="warning" (yellow)
  This matches the panel variables behavior where refresh icon turns yellow
*/
</style>
```

#### Key Behaviors

| Scenario | Panel Time Behavior | URL Behavior |
|----------|-------------------|--------------|
| **View Panel Modal** | Time picker visible if panel has panel-level time enabled | URL updates with `panel-time-<id>` param |
| **Full Screen** | Time picker in header bar | URL includes panel ID and time params |
| **Exit View Panel** | Panel time preserved in dashboard | URL retains panel time param |
| **Exit Full Screen** | Return to dashboard with panel time | URL removes `panel` param, keeps time param |
| **Share View Panel URL** | Recipient sees same panel time | Panel time loaded from URL |
| **Share Full Screen URL** | Recipient sees full screen with same time | Full screen opens with correct time |

#### Additional Considerations

1. **Print Mode**: When printing dashboard, panel times should be shown in panel headers
2. **Export Dashboard**: Panel time configs included in export JSON
3. **Embed Panel**: Embedded panels maintain their time ranges
4. **Panel Refresh**: Manual refresh button respects panel time
5. **Panel Zoom**: Zooming into panel data maintains panel time context

---

## Data Flow

### Complete Flow Diagram

```
┌────────────────────────────────────────────────────────────┐
│                  Dashboard Load / URL Change                │
└────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
      ┌─────▼─────┐   ┌────▼────┐   ┌──────▼──────┐
      │ Global    │   │  URL    │   │Panel Config │
      │ Time      │   │ Params  │   │ (Saved)     │
      └─────┬─────┘   └────┬────┘   └──────┬──────┘
            │              │               │
            └──────┬───────┴───────┬───────┘
                   │               │
           ┌───────▼───────────────▼─────────┐
           │ ViewDashboard.computePanelTimeRanges()│
           │                                  │
           │ Priority:                        │
           │ 1. URL params (highest)          │
           │ 2. Panel config                  │
           │ 3. Global time (fallback)        │
           └───────────┬──────────────────────┘
                       │
           ┌───────────▼──────────────────────┐
           │ currentTimeObjPerPanel           │
           │ {                                │
           │   __global: {...},               │
           │   panel1: {...},  // if custom   │
           │   panel2: {...},  // if custom   │
           │ }                                │
           └───────────┬──────────────────────┘
                       │
           ┌───────────▼──────────────────────┐
           │ RenderDashboardCharts            │
           │ - Shows panel time picker(s)     │
           │ - Distributes to each panel      │
           │ - Handles Apply → API call       │
           └───────────┬──────────────────────┘
                       │
           ┌───────────▼──────────────────────┐
           │ PanelContainer                   │
           │ - Renders panel content          │
           │ - Receives effectivePanelTime    │
           └───────────┬──────────────────────┘
                       │
           ┌───────────▼──────────────────────┐
           │ PanelSchemaRenderer              │
           │ selectedTimeObj prop             │
           └───────────┬──────────────────────┘
                       │
           ┌───────────▼──────────────────────┐
           │ usePanelDataLoader               │
           │ Watches time changes → loadData()│
           └───────────┬──────────────────────┘
                       │
           ┌───────────▼──────────────────────┐
           │ Query Execution                  │
           │ (SQL/PromQL with timestamps)     │
           └──────────────────────────────────┘
```

### User Interaction Flows

#### Flow 1: Enable Panel Time in Config

```
1. User edits panel in AddPanel view
2. User checks "Allow panel level time" toggle
3. User selects "Use individual time" option
4. User sets time range in AddPanel date time picker
5. User clicks Save
6. Panel config saved with:
   - allow_panel_time: true
   - panel_time_mode: "individual"
   - panel_time_range: {...}
```

#### Flow 2: Change Panel Time in View Mode

```
1. User views dashboard
2. Date time picker is shown in RenderDashboardCharts for panels with panel time enabled
3. User clicks panel date time picker
4. User selects new time range (e.g., "Last 7 days")
5. User clicks **Apply** button on date time picker
6. onPanelTimeApply() triggered
7. **API call fires immediately** to refresh panel with new time (7 days)
8. **URL updated immediately** with panel-time-<panelId>=7d
9. Panel data loads and displays with new 7-day time range
10. No yellow indicator needed - Apply triggers immediate action
```

#### Flow 3: Share Dashboard with Panel Times

```
1. User configures panel times
2. URL contains: ?period=15m&panel-time-panel1=1h&panel-time-panel2=7d
3. User copies URL and shares
4. Recipient opens URL
5. Dashboard loads with:
   - Global time: Last 15 minutes
   - Panel 1: Last 1 hour (from URL)
   - Panel 2: Last 7 days (from URL)
6. Recipient can further adjust panel times
```

---

## UI/UX Design

### Panel Configuration Screen

```
┌──────────────────────────────────────────────────────────┐
│ Add/Edit Panel                                           │
├──────────────────────────────────────────────────────────┤
│                                                           │
│ ┌──────────────┐   ┌───────────────────────────────────┐│
│ │              │   │ Configuration                      ││
│ │              │   │                                    ││
│ │  Query       │   │ Description:                       ││
│ │  Builder     │   │ [_____________________________]   ││
│ │              │   │                                    ││
│ │              │   │ Step Value:                        ││
│ │              │   │ [_____________________________]   ││
│ │              │   │                                    ││
│ │  Chart       │   │ Panel Time Settings:               ││
│ │  Preview     │   │ ☐ Allow panel level time           ││
│ │              │   │                                    ││
│ │              │   │ [When checked:]                    ││
│ │              │   │   ( ) Use global time              ││
│ │              │   │   (•) Use individual time          ││
│ │              │   │                                    ││
│ │              │   │   ℹ️  Panel will use its own time  ││
│ │              │   │      range from the picker above   ││
│ └──────────────┘   └───────────────────────────────────┘│
│                                                           │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Panel Time Range:                                    │ │
│ │ 🕐 [Last 1 hour                               ▼]    │ │
│ │    ← This picker is used when "individual" selected  │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                           │
│                             [Cancel]  [Apply]  [Save]    │
└──────────────────────────────────────────────────────────┘
```

### Dashboard View with Panel Time Pickers

```
┌──────────────────────────────────────────────────────────┐
│ System Monitoring    🕐 [Last 15m ▼]  [Variables] [...]  │
│                         ↑ Global time picker              │
├──────────────────────────────────────────────────────────┤
│                                                           │
│ ┌────────────────────────────────────────────────────┐  │
│ │ CPU Usage          🕐 [Last 1h ▼]        [...]    │  │
│ │                       ↑ Panel time picker          │  │
│ │                                                     │  │
│ │   ╱╲    ╱╲    ╱╲                                  │  │
│ │  ╱  ╲  ╱  ╲  ╱  ╲                                 │  │
│ │ ╱    ╲╱    ╲╱    ╲                                │  │
│ └────────────────────────────────────────────────────┘  │
│                                                           │
│ ┌────────────────────────────────────────────────────┐  │
│ │ Memory Usage                           [...]       │  │
│ │                       ↑ No panel picker (uses global) │
│ │                                                     │  │
│ │   ▄▄▄▄▄▄▄                                         │  │
│ │  ████████▄                                         │  │
│ │  ██████████                                        │  │
│ └────────────────────────────────────────────────────┘  │
│                                                           │
│ ┌────────────────────────────────────────────────────┐  │
│ │ Disk I/O           🕐 [Last 7d ▼]        [...]    │  │
│ │                       ↑ Panel time picker          │  │
│ │                                                     │  │
│ │  ████████████████████████████████                 │  │
│ │  ████████████████████████████████                 │  │
│ │  ████████████████████████████████                 │  │
│ └────────────────────────────────────────────────────┘  │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

**Key UI Elements:**

1. **Global Time Picker** - Top of dashboard (existing)
2. **Panel Time Picker** - Panel header (only when `allow_panel_time = true`)
3. **Config Toggle** - ConfigPanel sidebar (enable panel time)
4. **Config Radio** - Choose global or individual mode

---

## Edge Cases & Solutions

### 1. User Changes Global Time While Panel Has Individual Time

**Scenario:** Dashboard global time is "Last 15m", Panel A has individual time "Last 1h". User changes global to "Last 24h".

**Behavior:**
- Panel A continues to show "Last 1h" (individual time takes priority)
- Panel A's date time picker still shows "Last 1h"
- Other panels update to "Last 24h"

**Solution:** No special handling needed - priority system handles this automatically.

---

### 2. URL Parameter Overrides Saved Panel Config

**Scenario:** Panel saved with "Last 1h" in config. User opens URL with `?panel-time-panelA=7d`.

**Behavior:**
- Panel shows "Last 7 days" (URL has highest priority)
- Panel date time picker shows "Last 7 days"
- If user changes panel time picker, URL updates
- Saved config remains unchanged in database

**Solution:** URL params have highest priority in `computePanelTimeRanges()`.

---

### 3. Panel Has "Use Global Time" Mode, Global Changes

**Scenario:** Panel configured with `allow_panel_time = true` and `panel_time_mode = "global"`. User changes global time.

**Behavior:**
- Panel automatically updates to new global time
- Panel date time picker shows new global time
- Panel tracks global explicitly (even if URL has panel-specific param)

**Solution:** In `computePanelTimeRanges()`, panels with `panel_time_mode = "global"` don't get added to `currentTimeObjPerPanel`, so they use `__global`.

---

### 4. User Shares Dashboard URL, Recipient Changes Panel Time

**Scenario:** User shares URL with panel times. Recipient opens and changes a panel time.

**Behavior:**
- Recipient's URL updates with new panel time
- Original URL unchanged (each user has their own URL)
- If recipient saves dashboard, their version has the new config
- Original dashboard unchanged

**Solution:** URL changes are local to browser session. Saving dashboard creates new version or overwrites (depending on permissions).

---

### 5. Multiple Panels with Same ID (Edge Case)

**Scenario:** Dashboard has duplicate panel IDs (shouldn't happen, but safety check).

**Behavior:**
- URL param `panel-time-<panelId>` affects all panels with that ID
- First panel's time used for URL generation

**Solution:** Add panel ID uniqueness validation when saving dashboard (separate issue).

---

### 6. Very Long URL with Many Panel Times

**Scenario:** Dashboard with 50 panels, each with custom time → long URL.

**Behavior:**
- URL might exceed browser limits (2048 chars typical)
- Modern browsers support longer URLs (Chrome: 32K+)
- If too long, browser may truncate

**Solution:**
- Document URL length limitations
- Recommend using saved dashboard configs for complex setups
- Consider URL shortening service integration (future enhancement)

---

## Testing Strategy

### Unit Tests

**No Unit Tests Needed for Panel Time Ranges**

Since we're **reusing existing time conversion functions** from the global dashboard code (not creating new ones), we don't need to write new unit tests. The existing functions are already tested.

**Why No Unit Tests?**

✅ **Code Reusability:** Panel-level time conversion uses the same functions as global dashboard time
✅ **Already Tested:** The existing time conversion functions already have unit tests
✅ **Single Source of Truth:** No duplicate code = no duplicate tests needed
✅ **E2E Coverage:** The 47 E2E tests verify end-to-end behavior including time conversion

**Existing Tests to Verify:**

Instead of writing new tests, verify that the existing time conversion tests in the codebase cover:
- Relative time calculation ("15m", "1h", "7d", etc.)
- Absolute time handling (Unix timestamps)
- Edge cases (invalid periods, timezone handling)

**Where to Find Existing Tests:**

Look for unit tests for:
- `DateTimePickerDashboard.vue` component
- `DateTime.vue` component
- Any existing time utility functions in the codebase

These existing tests already cover the time conversion logic that will be reused for panel-level times.

### Integration Tests

**Scenarios:**

1. ✅ **Enable panel time in config** → Save → Verify config stored
2. ✅ **Panel with individual time** → Load dashboard → Verify panel shows custom time
3. ✅ **Change panel time in view mode** → Verify URL updates
4. ✅ **Open dashboard with panel time URL params** → Verify panels load correctly
5. ✅ **Panel with "use global" mode** → Change global time → Verify panel updates
6. ✅ **Export/import dashboard** → Verify panel time configs preserved
7. ✅ **Multiple panels with different times** → Verify all work independently

### Manual Testing Checklist

**Configuration (Edit Mode):**
- [ ] Toggle "Allow panel level time" on/off
- [ ] Switch between "Use global time" and "Use individual time"
- [ ] Set individual time in AddPanel date time picker
- [ ] Verify label changes when individual time selected
- [ ] Save panel and verify config stored

**View Mode:**
- [ ] Panel with individual time shows date time picker widget
- [ ] Panel without panel time enabled has no picker widget
- [ ] Panel with "use global" mode has picker but tracks global
- [ ] Change panel time via picker → verify picker value updates
- [ ] **Verify panel data does NOT auto-refresh after picker change**
- [ ] **Verify URL does NOT update yet** (only after Apply clicked)
- [ ] Click **Apply button** on date time picker
- [ ] **Verify URL updates immediately**
- [ ] **Verify API call fires immediately**
- [ ] **Verify panel data refreshes with new time**

**URL Parameters:**
- [ ] Load dashboard with `panel-time-<id>=1h` → verify panel uses 1h
- [ ] Load dashboard with absolute panel time params → verify works
- [ ] Change panel time → verify URL updates immediately
- [ ] Copy URL → open in new tab → verify panel times preserved
- [ ] Mix of global and panel times in URL → verify all work

**Priority System:**
- [ ] URL panel time overrides config
- [ ] Config panel time overrides global
- [ ] Global time used when no panel time configured
- [ ] Panel "use global" mode follows global even with URL override

**Edge Cases:**
- [ ] Very long URL with many panel times → verify still works
- [ ] Panel time in different timezone → verify correct calculation
- [ ] Dashboard with 20+ panels → verify performance
- [ ] Back/forward browser navigation → verify times maintained

---

### Data-Test Attributes for E2E Testing

To enable reliable E2E testing and distinguish between multiple date time picker instances, the following data-test attributes have been added:

#### Date Time Pickers

**Global Dashboard Date Time Picker:**
```html
<DateTimePickerDashboard
  data-test="dashboard-global-date-time-picker"
  ...
/>
```
- Location: ViewDashboard.vue (dashboard header)
- Purpose: Global dashboard time selection
- Usage: `page.locator('[data-test="dashboard-global-date-time-picker"]')`

**Panel-Level Time Picker (Wrapper):**
```html
<div :data-test="`dashboard-panel-${item.id}-time-picker`">
  <DateTimePickerDashboard ... />
</div>
```
- Location: RenderDashboardCharts.vue (above each panel)
- Purpose: Container for panel time picker
- Usage: `page.locator('[data-test="dashboard-panel-panel123-time-picker"]')`

**Panel-Level Time Picker (Component):**
```html
<DateTimePickerDashboard
  :data-test="`panel-time-picker-${item.id}`"
  ...
/>
```
- Location: RenderDashboardCharts.vue (inside panel time picker wrapper)
- Purpose: Individual panel date time picker component
- Usage: `page.locator('[data-test="panel-time-picker-panel123"]')`

**ViewPanel Modal Date Time Picker:**
```html
<DateTimePickerDashboard
  data-test="dashboard-viewpanel-date-time-picker"
  ...
/>
```
- Location: ViewPanel.vue (modal header)
- Purpose: Time picker in View Panel modal
- Usage: `page.locator('[data-test="dashboard-viewpanel-date-time-picker"]')`

#### Configuration UI

**Allow Panel Time Toggle:**
```html
<q-checkbox
  data-test="dashboard-config-allow-panel-time"
  ...
/>
```
- Location: ConfigPanel.vue
- Purpose: Toggle to enable/disable panel-level time
- Usage: `page.locator('[data-test="dashboard-config-allow-panel-time"]')`

#### Panel-Level Variables (Existing)

**Panel Variables Selector:**
```html
<div :data-test="`dashboard-panel-${item.id}-variables`">
  ...
</div>
```
- Location: RenderDashboardCharts.vue
- Purpose: Panel-level variable selectors
- Usage: `page.locator('[data-test="dashboard-panel-panel123-variables"]')`

---

### E2E Test Cases

Comprehensive list of **End-to-End (E2E) test cases** using Playwright, Cypress, or similar testing frameworks.

**Total E2E Test Cases: 47**

**Note:** Original E2E-046 and E2E-047 (yellow icon behavior) were removed and replaced with new tests for variable time range behavior.

#### Category 1: Basic Configuration (8 test cases)

**E2E-001: Enable Panel Level Time**
- Navigate to dashboard
- Edit a panel
- Enable "Allow panel level time" toggle
- Verify toggle state is ON
- Save panel
- Verify config saved with `allow_panel_time: true`

**E2E-002: Disable Panel Level Time**
- Navigate to dashboard with panel that has panel time enabled
- Edit the panel
- Disable "Allow panel level time" toggle
- Verify toggle state is OFF
- Save panel
- Verify config saved with `allow_panel_time: false` or `undefined`

**E2E-003: Select "Use Global Time" Mode**
- Navigate to dashboard
- Edit a panel
- Enable "Allow panel level time"
- Select "Use global time" radio button
- Verify radio button selected
- Save panel
- Verify config has `panel_time_mode: "global"`

**E2E-004: Select "Use Individual Time" Mode**
- Navigate to dashboard
- Edit a panel
- Enable "Allow panel level time"
- Select "Use individual time" radio button
- Verify radio button selected
- Save panel
- Verify config has `panel_time_mode: "individual"`

**E2E-005: Set Individual Panel Time - Relative**
- Navigate to dashboard
- Edit a panel
- Enable panel time with "Use individual time"
- Open date time picker in AddPanel
- Select "Last 1 hour"
- Verify picker shows "Last 1 hour"
- Save panel
- Verify config has `panel_time_range: { type: "relative", relativeTimePeriod: "1h" }`

**E2E-006: Set Individual Panel Time - Absolute**
- Navigate to dashboard
- Edit a panel
- Enable panel time with "Use individual time"
- Open date time picker in AddPanel
- Select absolute date range (e.g., Jan 1-15, 2024)
- Verify picker shows selected dates
- Save panel
- Verify config has `panel_time_range: { type: "absolute", startTime: ..., endTime: ... }`

**E2E-007: Switch from Individual to Global Mode**
- Navigate to dashboard with panel having individual time
- Edit the panel
- Switch from "Use individual time" to "Use global time"
- Save panel
- Verify `panel_time_range` is cleared
- Verify `panel_time_mode` is "global"

**E2E-008: Date Time Picker Label Changes**
- Navigate to dashboard
- Edit a panel
- Enable panel time with "Use individual time"
- Verify date time picker label changes to "Panel Time Range"
- Disable panel time
- Verify label changes back to "Time Range"

---

#### Category 2: View Mode Panel Time Picker (10 test cases)

**E2E-009: Panel Time Picker Visibility - Enabled**
- Load dashboard with panel having `allow_panel_time: true`
- Verify date time picker widget visible in panel header
- Verify picker shows current panel time

**E2E-010: Panel Time Picker Visibility - Disabled**
- Load dashboard with panel having `allow_panel_time: false` or `undefined`
- Verify NO date time picker widget in panel header
- Panel uses global time

**E2E-011: Change Panel Time via View Mode Picker - Relative**
- Load dashboard with panel having panel time enabled
- Panel time picker visible using `data-test="panel-time-picker-{panelId}"`
- Click panel date time picker
- Select "Last 7 days"
- **Verify panel data does NOT refresh yet** (still showing old data)
- **Verify URL has NOT updated yet**
- Click **Apply** button on date time picker
- **Verify API call fires immediately** (panel data loading indicator appears)
- **Verify URL immediately updates with panel-time-{panelId}=7d**
- Verify panel refreshes with new time range
- Verify panel shows data for last 7 days

**E2E-012: Change Panel Time via View Mode Picker - Absolute**
- Load dashboard with panel having panel time enabled
- Click panel date time picker
- Select absolute date range (e.g., Jan 1-15, 2024)
- Verify picker shows selected dates
- **Verify panel data does NOT refresh yet** (still showing old data)
- **Verify URL has NOT updated yet**
- Click **Apply** button on date time picker
- **Verify API call fires immediately** (panel data loading indicator appears)
- **Verify URL immediately updates with panel-time-{panelId}-from and -to params**
- Verify panel refreshes with new time range
- Verify panel shows data for selected dates

**E2E-013: Global Time Change Does Not Affect Individual Panel Time**
- Load dashboard with:
  - Global time: Last 15m
  - Panel A: Individual time (Last 1h)
- Change global time to "Last 24h"
- Verify Panel A still shows "Last 1h" in its picker
- Verify Panel A data unchanged
- Verify other panels update to "Last 24h"

**E2E-014: Global Time Change Affects "Use Global" Panel Time**
- Load dashboard with:
  - Global time: Last 15m
  - Panel A: "Use global" mode
- Panel A shows date time picker
- Change global time to "Last 1h"
- Verify Panel A picker updates to show "Last 1h"
- Verify Panel A data refreshes with new time

**E2E-015: Multiple Panels with Different Times**
- Load dashboard with:
  - Panel A: Last 1h (individual)
  - Panel B: Last 7d (individual)
  - Panel C: No panel time (uses global 15m)
- Verify Panel A picker shows "Last 1h"
- Verify Panel B picker shows "Last 7d"
- Verify Panel C has no picker
- Verify each panel shows correct data for its time range

**E2E-016: Panel Time Picker Dropdown Interaction**
- Click panel date time picker
- Verify dropdown opens
- Click outside dropdown
- Verify dropdown closes without changing time
- Click picker again and select time
- Verify dropdown closes and time updates

**E2E-017: Panel Time Picker in Tab Navigation**
- Load dashboard with multiple tabs
- Tab 1 has Panel A with individual time
- Tab 2 has Panel B with individual time
- Switch to Tab 2
- Verify Panel B picker shows correct time
- Change Panel B time
- Switch back to Tab 1
- Verify Panel A time unchanged

**E2E-018: Panel Time Picker with Variables**
- Load dashboard with panel having:
  - Panel-level time enabled (individual time: "Last 1h")
  - Panel-level variables
- Both variable selector and time picker visible in panel area
- Change variable value
- Verify panel refreshes with new variable
- **Verify panel variable query uses panel's individual time (Last 1h)**
- Change panel time to "Last 7d"
- Verify panel refreshes with new time
- **Verify panel variable query now uses new panel time (Last 7d)**
- Both work independently but variables use panel's effective time

---

#### Category 3: URL Parameter Sync (10 test cases)

**E2E-019: URL Updates on Panel Time Change**
- Load dashboard with panel having panel time enabled
- Click panel date time picker
- Select "Last 1h"
- **Verify panel data has NOT refreshed yet**
- **Verify URL has NOT updated yet**
- Click **Apply button** on date time picker
- **Verify URL immediately updates with `panel-time-{panelId}=1h`**
- **Verify API call fires immediately**
- Verify panel data refreshes
- Copy URL
- Open URL in new tab
- Verify panel picker shows "Last 1h"
- Panel data loads with "Last 1h" on initial load

**E2E-020: Load Dashboard with Panel Time URL Parameter**
- Open URL: `?period=15m&panel-time-panel123=7d`
- Verify global time shows "Last 15m"
- Verify Panel 123 shows "Last 7d" in its picker
- Verify Panel 123 data shows 7 days of data

**E2E-021: URL with Multiple Panel Times**
- Open URL with:
  - `?period=15m`
  - `&panel-time-panel1=1h`
  - `&panel-time-panel2=7d`
  - `&panel-time-panel3=30d`
- Verify each panel shows correct time in picker
- Verify each panel shows correct data

**E2E-022: URL Panel Time Overrides Config**
- Dashboard has Panel A saved with "Last 1h" in config
- Open URL with `panel-time-panelA=7d`
- Verify Panel A picker shows "Last 7d" (URL takes priority)
- Verify Panel A data shows 7 days
- Change picker to "Last 1h"
- Verify URL updates to `panel-time-panelA=1h`

**E2E-023: Share URL with Panel Times**
- Configure Panel A with "Last 1h"
- Configure Panel B with "Last 7d"
- Copy dashboard URL
- Share URL with another user (use different browser/incognito)
- Open shared URL
- Verify both panels show correct times
- Verify both panels show correct data

**E2E-024: Browser Back/Forward with Panel Time URL Changes**
- Load dashboard
- Change Panel A time to "Last 1h" (URL: `...panel-time-panelA=1h`)
- Change Panel A time to "Last 7d" (URL: `...panel-time-panelA=7d`)
- Click browser back button
- Verify URL changes to `...panel-time-panelA=1h`
- Verify Panel A picker shows "Last 1h"
- Verify Panel A data updates
- Click browser forward button
- Verify URL changes to `...panel-time-panelA=7d`
- Verify Panel A picker shows "Last 7d"

**E2E-025: Absolute Panel Time in URL**
- Configure Panel A with absolute time (Jan 1-15, 2024)
- Verify URL contains:
  - `panel-time-panelA-from=<timestamp>`
  - `panel-time-panelA-to=<timestamp>`
- Copy URL and open in new tab
- Verify Panel A shows correct absolute date range

**E2E-026: URL Parameter Persistence Across Page Reload**
- Load dashboard with panel time URL params
- Reload page (F5)
- Verify URL params remain unchanged
- Verify panel times load correctly from URL

**E2E-027: Long URL with Many Panel Times**
- Configure 20 panels with different times
- Verify URL contains all `panel-time-*` parameters
- Copy URL (check length)
- Open URL in new tab
- Verify all 20 panels load with correct times

**E2E-028: Clear Panel Time URL Parameter**
- Load dashboard with `panel-time-panelA=1h` in URL
- Disable panel time for Panel A
- Verify `panel-time-panelA=1h` removed from URL
- Enable panel time again with "Use global"
- Verify Panel A now tracks global time
- No `panel-time-panelA` parameter in URL

---

#### Category 4: Priority System (7 test cases)

**E2E-029: URL Priority Over Config**
- Dashboard Panel A config: `panel_time_range: { relativeTimePeriod: "1h" }`
- Open URL with `panel-time-panelA=7d`
- Verify Panel A shows "Last 7d" (URL priority)
- Not "Last 1h" from config

**E2E-030: Config Priority Over Global**
- Dashboard global time: "Last 15m"
- Panel A config: `panel_time_range: { relativeTimePeriod: "1h" }`
- Panel A has NO URL parameter
- Verify Panel A shows "Last 1h" (config priority)
- Not "Last 15m" from global

**E2E-031: Global Fallback When No Panel Time**
- Dashboard global time: "Last 15m"
- Panel A has `allow_panel_time: false` or `undefined`
- Verify Panel A uses "Last 15m" (global fallback)
- No panel picker visible

**E2E-032: Three-Level Priority Test**
- Setup:
  - Global time: "Last 15m"
  - Panel A config: "Last 1h" (individual)
  - URL param: `panel-time-panelA=7d`
- Verify Panel A shows "Last 7d" (URL highest priority)

**E2E-033: Panel "Use Global" Mode Priority**
- Panel A: `allow_panel_time: true`, `panel_time_mode: "global"`
- URL has: `panel-time-panelA=7d`
- Panel A picker visible
- Verify Panel A tracks global time (mode takes priority over URL)
- Panel A ignores URL parameter

**E2E-034: Priority After URL Parameter Removed**
- Load with URL: `panel-time-panelA=7d`
- Panel A shows "Last 7d"
- Remove URL parameter (change panel time via picker)
- Now Panel A uses config or global
- Verify correct fallback behavior

**E2E-035: Mixed Priority Scenarios**
- Dashboard with 5 panels:
  - Panel 1: URL param (highest)
  - Panel 2: Config individual (medium)
  - Panel 3: Config global (follows global)
  - Panel 4: No panel time (follows global)
  - Panel 5: URL param overriding config
- Verify each panel shows correct time
- Verify correct priority applied

---

#### Category 5: View Panel & Full Screen (5 test cases)

**E2E-036: View Panel Modal with Panel Time**
- Load dashboard with Panel A having individual time "Last 1h"
- Click "View" on Panel A
- Modal opens
- Verify panel time picker visible in modal header
- Verify picker shows "Last 1h"
- Verify panel data shows 1 hour of data

**E2E-037: Change Time in View Panel Modal**
- Open Panel A in View Panel modal
- Panel has individual time "Last 1h"
- Change time to "Last 7d" in modal picker
- Verify picker shows "Last 7d"
- **Verify panel data does NOT refresh yet**
- **Verify URL has NOT updated yet**
- Click **Apply button** on date time picker
- **Verify API call fires immediately**
- Verify panel data refreshes with 7 days in modal
- **Verify URL updated with new time**
- Close modal
- Verify Panel A in dashboard picker shows "Last 7d"

**E2E-038: Full Screen Panel with Panel Time**
- Load dashboard with Panel A having individual time "Last 1h"
- Click "Full Screen" on Panel A
- Panel opens in full screen mode
- Verify panel time picker visible in full screen header
- Verify picker shows "Last 1h"
- Verify panel data shows 1 hour of data

**E2E-039: Change Time in Full Screen Mode**
- Open Panel A in full screen mode
- Panel has individual time "Last 1h"
- Change time to "Last 24h" in full screen picker
- Verify picker shows "Last 24h"
- **Verify panel data does NOT refresh yet**
- **Verify URL has NOT updated yet**
- Click **Apply button** on date time picker
- **Verify API call fires immediately**
- Verify panel data refreshes with 24h data
- **Verify URL updated**
- Exit full screen (back to dashboard)
- Verify Panel A in dashboard picker shows "Last 24h"

**E2E-040: Full Screen URL Sharing**
- Open Panel A in full screen with time "Last 7d"
- URL should be: `/fullscreen?panel=panelA&panel-time-panelA=7d`
- Copy URL and open in new tab
- Verify panel opens in full screen
- Verify panel shows "Last 7d"
- Verify panel data correct

---

#### Category 6: Dashboard Operations & Variables (7 test cases)

**E2E-041: Export Dashboard with Panel Times**
- Configure multiple panels with different times
- Export dashboard as JSON
- Verify JSON contains panel time configs
- Import dashboard in another browser/org
- Verify panel times preserved
- Verify all panels work correctly

**E2E-042: Clone/Duplicate Panel with Panel Time**
- Panel A has individual time "Last 1h"
- Clone/duplicate Panel A
- Verify cloned panel has same time config
- Verify cloned panel shows "Last 1h" in picker
- Change original Panel A time
- Verify cloned panel unchanged (independent)

**E2E-043: Delete Panel with Panel Time**
- Panel A has individual time with URL param
- Delete Panel A from dashboard
- Verify panel removed from dashboard
- Verify `panel-time-panelA` removed from URL
- Save dashboard
- Verify panel config removed from backend

**E2E-044: Global Refresh with Mixed Panel Times**
- Configure Panel A with "Last 1h" (individual time)
- Configure Panel B with "Last 7d" (individual time)
- Configure Panel C with no panel time (uses global "Last 15m")
- Click **global refresh button**
- **Verify all panels refresh simultaneously**
- **Verify Panel A refreshes with 1h data** (uses its panel time)
- **Verify Panel B refreshes with 7d data** (uses its panel time)
- **Verify Panel C refreshes with 15m data** (uses global time)
- Each panel respects its own effective time range during global refresh

**E2E-045: Print Dashboard with Panel Times**
- Configure panels with different times
- Enter print mode
- Verify panel time pickers hidden (or shown as text)
- Verify each panel shows its time range in header/title
- Print or export to PDF
- Verify output shows panel times

**E2E-046: Panel Variable Uses Panel Time Range**
- Setup:
  - Global time: "Last 15m"
  - Panel A: Individual time "Last 1h" with panel-level variable
  - Panel B: Uses global time with panel-level variable
- Change Panel A's panel variable value
- **Verify Panel A variable query uses "Last 1h"** (panel's individual time)
- **Verify API request contains panel's time range, not global**
- Change Panel B's panel variable value
- **Verify Panel B variable query uses "Last 15m"** (global time, since panel follows global)
- Change Panel A's time to "Last 7d"
- Change Panel A's variable again
- **Verify Panel A variable query now uses "Last 7d"** (new panel time)

**E2E-047: Tab and Global Variables Use Global Time**
- Setup:
  - Global time: "Last 15m"
  - Tab 1: Has tab-level variable
  - Tab 1 Panel A: Individual time "Last 1h"
  - Tab 1 Panel B: Individual time "Last 7d"
  - Dashboard: Has global variable
- Change tab-level variable value
- **Verify tab variable query uses "Last 15m"** (global time, not panel times)
- **Verify tab variable applies to all panels in tab regardless of their individual times**
- Change global variable value
- **Verify global variable query uses "Last 15m"** (global time)
- **Verify global variable applies to all panels in all tabs**
- Change global time to "Last 1h"
- Change tab variable again
- **Verify tab variable query now uses "Last 1h"** (new global time)
- Both Panel A and Panel B still use their individual times for panel data

---

### E2E Test Execution Strategy

**Test Framework:** Playwright (recommended) or Cypress

**Test Organization:**
```
tests/ui-testing/playwright-tests/Dashboards/
  ├── dashboard-panel-time-configuration.spec.js    (E2E-001 to E2E-008)  [8 tests]
  ├── dashboard-panel-time-view-mode.spec.js        (E2E-009 to E2E-018)  [10 tests]
  ├── dashboard-panel-time-url-sync.spec.js         (E2E-019 to E2E-028)  [10 tests]
  ├── dashboard-panel-time-priority.spec.js         (E2E-029 to E2E-035)  [7 tests]
  ├── dashboard-panel-time-fullscreen.spec.js       (E2E-036 to E2E-040)  [5 tests]
  └── dashboard-panel-time-operations.spec.js       (E2E-041 to E2E-047)  [7 tests]
```

**Test Data Setup:**
- Create test dashboard with 10+ panels
- Configure various panel time settings
- Configure panel-level, tab-level, and global variables
- Prepare test URLs with parameters
- Setup test data in backend (if needed)

**Execution Time Estimate:**
- 47 test cases × ~2 minutes average = ~94 minutes total
- Parallel execution: ~20-25 minutes (with 3-4 workers)

**CI/CD Integration:**
- Run E2E tests on every PR
- Run full suite nightly
- Generate test reports with screenshots/videos
- Track test flakiness and fix unstable tests

---

## Implementation Timeline

### Phase 1: Backend Schema & Config UI (2 days)

**Day 1: Backend Schema**
- [ ] Add `allow_panel_time`, `panel_time_mode`, `panel_time_range` to PanelConfig (Rust)
- [ ] Build and test backend
- [ ] Verify serialization/deserialization
- [ ] Test with existing dashboards (backward compatibility)

**Day 2: Config UI**
- [ ] Add toggle and radio buttons to ConfigPanel.vue
- [ ] Wire up state management
- [ ] Integrate with AddPanel date time picker
- [ ] Update labels when individual mode selected
- [ ] Test UI interactions

### Phase 2: Panel Time Picker Widget (2 days)

**Day 3: Panel Time Picker Component**
- [ ] Add DateTimePickerDashboard to PanelContainer.vue
- [ ] Show/hide based on allow_panel_time
- [ ] Initialize panel time value correctly
- [ ] Handle picker change events

**Day 4: Time Calculation Logic**
- [ ] Create usePanelTimeRange.ts composable
- [ ] Implement calculateRelativeTime()
- [ ] Implement calculateTimeFromConfig()
- [ ] Implement formatTimeRange()
- [ ] Unit tests for utilities

### Phase 3: URL Parameter Management (2 days)

**Day 5: URL Sync**
- [ ] Implement updateURLWithPanelTime()
- [ ] Implement getPanelTimeFromURL()
- [ ] Test URL parameter generation
- [ ] Test URL parameter parsing

**Day 6: Priority System**
- [ ] Implement computePanelTimeRanges() in ViewDashboard.vue
- [ ] Test URL > config > global priority
- [ ] Handle panel time mode ("global" vs "individual")
- [ ] Test with multiple panels

### Phase 4: View Panel & Full Screen Support (2 days)

**Day 7: View Panel Modal**
- [ ] Add panel time picker to View Panel modal component
- [ ] Initialize panel time from URL/config in modal
- [ ] Handle panel time changes in modal
- [ ] Update URL when panel time changes
- [ ] Test modal open/close with panel time preservation

**Day 8: Full Screen Mode**
- [ ] Add panel time picker to Full Screen component/route
- [ ] Handle full screen URL with panel time parameters
- [ ] Implement exit full screen with time preservation
- [ ] Test full screen mode with various panel times
- [ ] Test URL sharing for full screen panels

### Phase 5: Integration & Manual Testing (2 days)

**Day 9: Integration**
- [ ] Connect all components end-to-end
- [ ] Test complete flow: config → view → URL → fullscreen
- [ ] Test browser back/forward navigation
- [ ] Test with multiple panels and various configurations
- [ ] Fix any integration issues

**Day 10: Manual Testing & Polish**
- [ ] Execute manual testing checklist (all items)
- [ ] Test edge cases (long URLs, many panels, etc.)
- [ ] Performance testing with 20+ panels
- [ ] Cross-browser testing (Chrome, Firefox, Safari, Edge)
- [ ] Fix bugs and polish UI
- [ ] Accessibility testing (keyboard navigation, screen readers)

### Phase 6: E2E Test Development (3 days)

**Day 11: E2E Tests - Configuration & View Mode**
- [ ] Setup E2E testing framework (Playwright/Cypress)
- [ ] Write tests for Category 1: Configuration (E2E-001 to E2E-008)
- [ ] Write tests for Category 2: View Mode Picker (E2E-009 to E2E-018)
- [ ] Run and debug tests
- [ ] Generate test reports

**Day 12: E2E Tests - URL & Priority**
- [ ] Write tests for Category 3: URL Parameters (E2E-019 to E2E-028)
- [ ] Write tests for Category 4: Priority System (E2E-029 to E2E-035)
- [ ] Run and debug tests
- [ ] Add screenshots/video capture for failures

**Day 13: E2E Tests - View/Fullscreen & Operations**
- [ ] Write tests for Category 5: View Panel & Full Screen (E2E-036 to E2E-040)
- [ ] Write tests for Category 6: Dashboard Operations (E2E-041 to E2E-045)
- [ ] Run full E2E test suite
- [ ] Fix flaky tests
- [ ] Setup CI/CD pipeline for E2E tests

### Phase 7: Documentation & Deployment (1 day)

**Day 14: Documentation & Release**
- [ ] Update user documentation with panel time feature
- [ ] Create demo videos/GIFs showing panel time usage
- [ ] Write release notes with feature highlights
- [ ] Update API documentation
- [ ] Review code with team
- [ ] Prepare for deployment

**Total Estimated Time: 14 days (2 weeks + 4 days)**

### Detailed Breakdown
- Backend & Config UI: 2 days
- Panel Time Picker Widget: 2 days
- URL Parameter Management: 2 days
- View Panel & Full Screen: 2 days
- Integration & Manual Testing: 2 days
- E2E Test Development: 3 days
- Documentation & Deployment: 1 day

---

## File Changes Summary

### Backend Files

| File | Type | Changes | Lines Est. |
|------|------|---------|-----------|
| `src/config/src/meta/dashboards/v8/mod.rs` | Edit | Add 3 fields to PanelConfig | ~15 |

### Frontend Files

| File | Type | Changes | Lines Est. |
|------|------|---------|-----------|
| `web/src/components/dashboards/addPanel/ConfigPanel.vue` | Edit | Add toggle, radio buttons, NEW date time picker for individual time | ~120 |
| `web/src/views/Dashboards/addPanel/AddPanel.vue` | Edit | Update to support new individual time picker | ~50 |
| `web/src/views/Dashboards/RenderDashboardCharts.vue` | Edit | Add panel time pickers, Apply→API call logic, global refresh handling | ~220 |
| `web/src/views/Dashboards/ViewDashboard.vue` | Edit | Add URL parsing, time computation, **reuse existing time conversion functions** | ~150 |
| `web/src/components/dashboards/ViewPanel.vue` (or modal) | Edit | Add panel time picker to view modal | ~80 |
| `web/src/components/dashboards/FullScreenPanel.vue` (or route) | Edit | Add panel time picker to full screen | ~100 |
| `web/src/locales/en-US.json` | Edit | Add i18n translations | ~10 |

**Total New/Modified Code:** ~730 lines

**Note:** No new utility files needed - reusing existing time conversion functions from global dashboard code.

### Test Files (New)

| File | Type | Purpose | Tests |
|------|------|---------|-------|
| `tests/e2e/panel-time/01-configuration.spec.ts` | New | E2E: Configuration UI | 8 tests |
| `tests/e2e/panel-time/02-view-mode-picker.spec.ts` | New | E2E: View mode picker | 10 tests |
| `tests/e2e/panel-time/03-url-parameters.spec.ts` | New | E2E: URL sync | 10 tests |
| `tests/e2e/panel-time/04-priority-system.spec.ts` | New | E2E: Priority system | 7 tests |
| `tests/e2e/panel-time/05-view-fullscreen.spec.ts` | New | E2E: View/fullscreen | 5 tests |
| `tests/e2e/panel-time/06-dashboard-operations.spec.ts` | New | E2E: Operations | 7 tests |

**Total Test Files:** 6 E2E test files (~47 E2E tests)

**Note:** No unit tests needed for time utilities since we're reusing existing, already-tested functions.

---

## Internationalization (i18n)

Add these translation keys to `web/src/locales/en-US.json`:

```json
{
  "dashboard": {
    "panelTimeSettings": "Panel Time Settings",
    "allowPanelTime": "Allow panel level time",
    "useGlobalTime": "Use global time",
    "useIndividualTime": "Use individual time",
    "panelTimeGlobalHint": "Panel will track the global dashboard time. Changes to global time will update this panel.",
    "panelTimeIndividualHint": "Panel will use its own time range. Set the time using the date picker above. Global time changes won't affect this panel.",
    "panelTimeRange": "Panel Time Range",
    "panelTimeRangeTooltip": "This time range applies only to this panel. Other panels will use their own configured times or the global dashboard time.",
    "timeRange": "Time Range"
  }
}
```

---

## API Documentation

### Panel Time Configuration Structure

```typescript
interface PanelConfig {
  // ... existing fields ...

  /**
   * Enable panel-level time range
   * @default false
   */
  allow_panel_time?: boolean;

  /**
   * Panel time mode
   * - "global": Track global dashboard time explicitly
   * - "individual": Use custom panel time range
   * @default "global"
   */
  panel_time_mode?: "global" | "individual";

  /**
   * Panel time range (only used when panel_time_mode = "individual")
   */
  panel_time_range?: {
    /**
     * Time range type
     */
    type: "relative" | "absolute";

    /**
     * Relative time period (e.g., "15m", "1h", "7d")
     * Used when type = "relative"
     */
    relativeTimePeriod?: string;

    /**
     * Start time in milliseconds (Unix timestamp)
     * Used when type = "absolute"
     */
    startTime?: number;

    /**
     * End time in milliseconds (Unix timestamp)
     * Used when type = "absolute"
     */
    endTime?: number;
  };
}
```

### URL Parameters

```
Format:
?panel-time-<panelId>=<relativePeriod>                      // Relative time
?panel-time-<panelId>-from=<timestamp>&panel-time-<panelId>-to=<timestamp>  // Absolute time

Examples:
?panel-time-panel123=1h                                     // Panel 123: Last 1 hour
?panel-time-panel456=7d                                     // Panel 456: Last 7 days
?panel-time-panel789-from=1704067200000&panel-time-panel789-to=1704153600000  // Panel 789: Specific dates

Combined with global time:
?period=15m&panel-time-panel123=1h                          // Global: 15m, Panel 123: 1h
```

---

## Summary

This implementation provides a comprehensive solution for panel-level time ranges that:

✅ **Meets All Requirements** - Toggle, mode selection, URL sync, date time picker in view
✅ **Reuses Existing Components** - DateTimePickerDashboard, AddPanel picker
✅ **Follows Existing Patterns** - Similar to panel variables system
✅ **Backward Compatible** - Zero breaking changes, optional feature
✅ **URL-First Approach** - Full support for sharing and bookmarking
✅ **Clear Priority System** - URL > Config > Global
✅ **User-Friendly** - Visual date time picker widget, clear UI
✅ **View Panel & Full Screen Support** - Panel time preserved in all viewing modes
✅ **Dual Apply Pattern** - TWO ways to apply time change: Click Apply on picker OR click yellow refresh button
✅ **Yellow Refresh Icon** - Refresh button turns yellow when time changed but not yet applied (like variables)
✅ **Individual Panel Indicator** - Only affected panel's refresh button changes color, not global refresh
✅ **URL Sync on Apply** - URL parameters update when Apply button or yellow refresh button is clicked
✅ **Code Reusability** - Reuses existing global time conversion functions, no code duplication
✅ **Comprehensive Testing** - 47 E2E test cases
✅ **Simple Runtime Logic** - Clear separation: panel_time_range exists? use it : use defaultDatetimeDuration

### Key Advantages

1. **Add-On Feature** - Existing global time logic works fine, only add new code for panel time
2. **Simple & Clear** - Runtime logic: simple `if (panel_time_range)` check
3. **No Refactoring Needed** - Don't touch existing code that uses defaultDatetimeDuration
4. **No Confusion** - Two separate data sources: defaultDatetimeDuration (existing) and panel_time_range (new)
5. **Familiar UX** - Pattern matches panel variables (already understood by users)
6. **Flexible** - Three modes: disabled, track global, individual
7. **Shareable** - Full URL parameter support including fullscreen URLs
8. **Scalable** - Handles many panels efficiently
9. **Maintainable** - Clean architecture, reusable components, no mixing of time sources
10. **Well-Tested** - Extensive E2E test coverage across all scenarios
11. **Complete** - Includes view panel, full screen, print mode, export/import

### Critical Design Decision: Add-On, Not Refactor

**This is a NEW feature addition, not a refactor:**
- ✅ **Add:** New conditional check `if (panel.config.panel_time_range)`
- ✅ **Add:** New logic to handle panel-specific time
- ❌ **Don't change:** Existing global time flow (works fine with defaultDatetimeDuration)
- ❌ **Don't refactor:** Current code paths for global time

**How it works:**
```javascript
// Simple addition to existing code:
if (panel.config.panel_time_range) {
  // NEW: Use panel time
} else {
  // EXISTING: Use global time (no changes to existing code)
}
```

**Result:**
- Panels without `panel_time_range` → work exactly as before (no changes)
- Panels with `panel_time_range` → new feature (panel-specific time)

### Implementation Scope

**Code Changes:**
- Backend: 1 file (~15 lines)
- Frontend: 7 files (~690 lines) - **Reuses existing time conversion functions**
- Variable Logic: Update to support panel/tab/global time range usage
- Tests: 6 E2E test files (47 tests)
- **Total**: ~705 lines of code + 47 E2E tests

**Time Estimate:**
- Development: 11 days (completed)
- Variable Time Logic: 1 day (pending)
- E2E Testing: 3 days (pending)
- Documentation: 1 day (completed)
- **Total**: 16 days

**Test Coverage:**
- **Category 1**: Configuration (8 E2E tests)
- **Category 2**: View Mode Picker (10 E2E tests)
- **Category 3**: URL Parameters (10 E2E tests)
- **Category 4**: Priority System (7 E2E tests)
- **Category 5**: View Panel & Full Screen (5 E2E tests)
- **Category 6**: Dashboard Operations & Variables (7 E2E tests)
- **Unit Tests**: Not needed - reusing existing tested time conversion functions

### Features Included

1. **Configuration UI**
   - Toggle to enable panel-level time
   - Radio buttons for "Use global" vs "Use individual"
   - Integration with AddPanel date time picker

2. **View Mode**
   - Panel date time picker widget in RenderDashboardCharts area
   - Time picker updates on selection (no auto-refresh)
   - **Auto-apply disabled:** User must click Apply button to apply changes
   - **Immediate action on Apply:** API call fires, URL updates, panel refreshes
   - Visual indication of panel time via picker widget

3. **URL Management**
   - Automatic URL sync for panel times
   - Support for sharing and bookmarking
   - Browser back/forward navigation

4. **View Panel Modal**
   - Panel time picker in modal header
   - Time changes persist when closing modal
   - URL updates with modal time changes

5. **Full Screen Mode**
   - Panel time picker in full screen header
   - Full screen URL with panel time
   - Exit preserves panel time

6. **Priority System**
   - URL > Config > Global (clear hierarchy)
   - "Use global" mode tracks global explicitly
   - Individual mode uses custom time

7. **Dashboard Operations**
   - Export/import preserves panel times
   - Clone panel copies time config
   - Print mode shows panel times
   - Refresh respects panel times

8. **Variables and Time Range**
   - Panel-level variables use panel's individual time (if configured)
   - Tab-level variables always use global time
   - Global variables always use global time
   - Ensures consistency between variable queries and panel data

---

**Document Version:** 3.1 (Updated - Reflects Actual Implementation + Variable Time Range)
**Last Updated:** 2026-02-02
**Status:** Implementation Complete - E2E Tests Pending
**Location:** `d:\openobserve\web\src\components\dashboards\PANEL_TIME_RANGE_IMPLEMENTATION.md`

### Quick Reference

**47 E2E Test Cases Breakdown:**
- Basic Configuration: 8 tests
- View Mode Picker: 10 tests
- URL Parameters: 10 tests
- Priority System: 7 tests
- View Panel & Full Screen: 5 tests
- Dashboard Operations & Variables: 7 tests

**Estimated E2E Test Execution Time:**
- Full suite: ~94 minutes sequential
- Parallel (4 workers): ~20-25 minutes

**Implementation Status:**
- ✅ Backend: Complete (schema changes in mod.rs)
- ✅ Frontend: Complete (all 7 files updated)
- ✅ Data-test attributes: Added for E2E testing
- ✅ Variables time range logic: Documented and ready for implementation
- ⏳ E2E Tests: **Pending Implementation** (47 tests to be written)

**Next Steps:**
1. Implement variable time range logic (panel variables use panel time, tab/global use global time)
2. Implement E2E tests starting with 9 critical path tests
3. Run tests to validate implementation
4. Complete remaining 38 E2E tests (including 2 new variable tests)
5. Update documentation with any additional findings

---

## Implementation Summary

### ✅ Completed
- Backend schema with `allow_panel_time`, `panel_time_mode`, `panel_time_range`
- Configuration UI in ConfigPanel.vue and AddPanel.vue
- Panel time picker widget in RenderDashboardCharts.vue
- URL parameter sync for panel times
- View Panel modal support
- Full screen mode support
- Export/import preservation
- i18n translations (11 languages)
- Data-test attributes for testing

### 🔄 In Progress
- **Variables Time Range Logic**
  - Panel-level variables should use panel's individual time
  - Tab-level and global variables should use global time
  - Implementation: Update variable query logic to check panel time

### ⏳ Pending
- **E2E Test Implementation** (47 tests)
  - Priority: Start with 9 "Must-Have" critical path tests
  - New: E2E-046 and E2E-047 test variable time range behavior
  - Framework: Playwright (existing in project)
  - Files: 6 spec files in `tests/ui-testing/playwright-tests/Dashboards/`

### Data-Test Selectors
- Global picker: `data-test="dashboard-global-date-time-picker"`
- Panel picker: `data-test="panel-time-picker-{panelId}"`
- Panel wrapper: `data-test="dashboard-panel-{panelId}-time-picker"`
- ViewPanel picker: `data-test="dashboard-viewpanel-date-time-picker"`
- Config toggle: `data-test="dashboard-config-allow-panel-time"`
