# Dashboard Variables - Scoped Implementation Design Specification

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Current State vs New State](#current-state-vs-new-state)
3. [Architecture Overview](#architecture-overview)
4. [Scope Levels](#scope-levels)
5. [Data Structures](#data-structures)
6. [Dependency Management](#dependency-management)
7. [Loading Behavior](#loading-behavior)
8. [Composable Architecture](#composable-architecture)
9. [URL Synchronization](#url-synchronization)
10. [Component Integration](#component-integration)
11. [Variable Visibility & Access](#variable-visibility--access)
12. [Migration Strategy](#migration-strategy)
13. [Implementation Plan](#implementation-plan)
14. [Edge Cases & Considerations](#edge-cases--considerations)
15. [Testing Strategy](#testing-strategy)

---

## Executive Summary

### What's Changing

The dashboard variables system is evolving from a **global-only** architecture to a **multi-scoped** architecture supporting three distinct levels:

- **Global Variables**: Visible across the entire dashboard
- **Tab Variables**: Scoped to specific tabs, each tab instance maintains independent values
- **Panel Variables**: Scoped to specific panels, each panel maintains independent values

### Key Benefits

1. **Isolation**: Variables in different tabs/panels can have different values
2. **Performance**: Lazy loading prevents unnecessary API calls for hidden content
3. **Flexibility**: More granular control over variable scope and dependencies
4. **Maintainability**: Clear boundaries between variable contexts

### Breaking Changes

- Variables now require explicit `scope` configuration
- URL parameter format changes for tab/panel-scoped variables
- New dependency validation rules based on scope hierarchy
- `VariablesValueSelector` transitions from single instance to multi-instance pattern

---

## Current State vs New State

### Current Implementation (Global Only)

```typescript
// Single global state
{
  variables: [
    { name: "country", value: "USA", ... },
    { name: "region", value: ["CA", "NY"], ... }
  ]
}

// All panels see the same values
Panel A: country = "USA", region = ["CA", "NY"]
Panel B: country = "USA", region = ["CA", "NY"]
Panel C: country = "USA", region = ["CA", "NY"]
```

**Characteristics**:
- One `VariablesValueSelector` component manages all variables
- All variables load on dashboard mount
- All panels share the same variable values
- URL format: `var-country=USA&var-region=CA,NY`

### New Implementation (Multi-Scoped)

```typescript
// Multi-scoped state
{
  global: [
    { name: "country", value: "USA", scope: "global", ... }
  ],
  tabs: {
    "tab-1": [
      { name: "region", value: ["CA"], scope: "tab", tabId: "tab-1", ... }
    ],
    "tab-2": [
      { name: "region", value: ["NY"], scope: "tab", tabId: "tab-2", ... }
    ]
  },
  panels: {
    "panel-1": [
      { name: "city", value: "LA", scope: "panel", panelId: "panel-1", ... }
    ],
    "panel-2": [
      { name: "city", value: "NYC", scope: "panel", panelId: "panel-2", ... }
    ]
  }
}

// Different scopes see different values
Tab 1: country = "USA", region = ["CA"]
  Panel A: country = "USA", region = ["CA"], city = "LA"

Tab 2: country = "USA", region = ["NY"]
  Panel B: country = "USA", region = ["NY"], city = "NYC"
```

**Characteristics**:
- Multiple `VariablesValueSelector` instances (global, per-tab, per-panel)
- Centralized composable manages all variable state
- Variables load lazily based on visibility
- Different tabs/panels can have independent values for same variable name
- URL format: `var-country=USA&var-region.t.tab-1=CA&var-region.t.tab-2=NY`

---

## Architecture Overview

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          ViewDashboard.vue                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │          useVariablesManager() Composable                     │   │
│  │  • Centralized state for all variables (global/tab/panel)    │   │
│  │  • Dependency graph management                                │   │
│  │  • Loading orchestration                                      │   │
│  │  • Lazy loading coordination                                  │   │
│  │  • URL synchronization                                        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │   Global VariablesValueSelector                               │   │
│  │   scope: "global"                                             │   │
│  │   • Loads immediately on mount                                │   │
│  │   • Displays global variables                                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Tab Container                               │   │
│  │  ┌────────────────────────────────────────────────────────┐  │   │
│  │  │  Tab 1 VariablesValueSelector                          │  │   │
│  │  │  scope: "tab", tabId: "tab-1"                          │  │   │
│  │  │  • Loads when tab becomes active                       │  │   │
│  │  │  • Displays tab-1 scoped variables                     │  │   │
│  │  └────────────────────────────────────────────────────────┘  │   │
│  │                                                                │   │
│  │  ┌────────────────────────────────────────────────────────┐  │   │
│  │  │  Panel A Container                                      │  │   │
│  │  │  ┌──────────────────────────────────────────────────┐  │  │   │
│  │  │  │  Panel VariablesValueSelector                    │  │  │   │
│  │  │  │  scope: "panel", panelId: "panel-a"              │  │  │   │
│  │  │  │  • Loads when panel visible                      │  │  │   │
│  │  │  │  • Displays panel-a scoped variables             │  │  │   │
│  │  │  └──────────────────────────────────────────────────┘  │  │   │
│  │  │                                                          │  │   │
│  │  │  ┌──────────────────────────────────────────────────┐  │  │   │
│  │  │  │  PanelSchemaRenderer                             │  │  │   │
│  │  │  │  • Receives merged variables (global+tab+panel)  │  │  │   │
│  │  │  │  • Replaces variables in queries                 │  │  │   │
│  │  │  └──────────────────────────────────────────────────┘  │  │   │
│  │  └────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Current | New |
|-----------|---------|-----|
| **ViewDashboard** | Pass config to VariablesValueSelector | Host `useVariablesManager()` composable, coordinate multiple selectors |
| **VariablesValueSelector** | Single instance, manages all loading | Multiple instances, each manages its scope, uses composable for state |
| **RenderDashboardCharts** | Distribute variables to panels | Same, but now merges variables from multiple scopes |
| **PanelContainer** | Receive variables, detect changes | Same, but receives merged variables from global+tab+panel |
| **useVariablesManager()** | N/A (new) | Centralized state management, loading orchestration, dependency resolution |

---

## Scope Levels

### 1. Global Scope

**Definition**: Variables visible and shared across the entire dashboard.

**Characteristics**:
- Loaded immediately when dashboard mounts
- All tabs and panels can access global variables
- Single instance with one value
- Highest priority in visibility hierarchy

**Configuration**:
```typescript
{
  name: "country",
  type: "query_values",
  scope: "global",
  // ... other config
}
```

**Use Cases**:
- Organization/tenant filters
- Date range filters shared across all views
- Environment selection (prod/staging/dev)

### 2. Tab Scope

**Definition**: Variables scoped to specific tabs, each tab maintains independent values.

**Characteristics**:
- Each tab has its own instance of the variable
- Loaded when tab becomes active (lazy loading)
- Independent values per tab
- Can depend on global variables
- All panels within the tab see the tab's variable value

**Configuration**:
```typescript
{
  name: "region",
  type: "query_values",
  scope: "tab",
  tabs: ["tab-1", "tab-2"], // Which tabs this variable appears in
  query_data: {
    filter: [
      { filter: "country='$country'" } // Can depend on global variable
    ]
  }
}
```

**Internal Representation** (after expansion):
```typescript
// Creates separate instances for each tab
[
  {
    name: "region",
    scope: "tab",
    tabId: "tab-1",
    value: ["CA", "OR"],
    // ... other state
  },
  {
    name: "region",
    scope: "tab",
    tabId: "tab-2",
    value: ["NY", "NJ"],
    // ... other state
  }
]
```

**Use Cases**:
- Different service filters per monitoring tab
- Different customer segments per analytics tab
- Independent query contexts per tab

### 3. Panel Scope

**Definition**: Variables scoped to specific panels, each panel maintains independent values.

**Characteristics**:
- Each panel has its own instance of the variable
- Loaded when panel becomes visible (lazy loading + intersection observer)
- Independent values per panel
- Can depend on global and tab variables
- Only the specific panel sees this variable

**Configuration**:
```typescript
{
  name: "status",
  type: "custom",
  scope: "panel",
  panels: ["panel-1", "panel-2"], // Which panels this variable appears in
  value: ["200", "404", "500"]
}
```

**Internal Representation** (after expansion):
```typescript
[
  {
    name: "status",
    scope: "panel",
    panelId: "panel-1",
    value: ["200"],
    // ... other state
  },
  {
    name: "status",
    scope: "panel",
    panelId: "panel-2",
    value: ["404", "500"],
    // ... other state
  }
]
```

**Use Cases**:
- Panel-specific filters for detailed drill-downs
- Independent metric thresholds per panel
- Panel-specific time windows

### Scope Migration for Existing Dashboards

**Rule**: All variables without explicit scope are treated as **global**.

```typescript
// Old format (no scope)
{
  name: "country",
  type: "query_values",
  // ... config
}

// Auto-migrated to
{
  name: "country",
  type: "query_values",
  scope: "global", // Added during load
  // ... config
}
```

---

## Data Structures

### Variable Configuration (Dashboard Definition)

```typescript
interface VariableConfig {
  name: string;
  label?: string;
  type: "query_values" | "custom" | "constant" | "textbox" | "dynamic_filters";

  // NEW: Scope configuration
  scope: "global" | "tab" | "panel";
  tabs?: string[];   // Only if scope === "tab"
  panels?: string[]; // Only if scope === "panel"

  // Existing fields
  value: any;
  multiSelect?: boolean;
  query_data?: QueryDataConfig;
  // ... other existing fields
}
```

### Variable Runtime State (Expanded for Internal Use)

```typescript
interface VariableRuntimeState {
  // Identity
  name: string;
  scope: "global" | "tab" | "panel";
  tabId?: string;   // Only if scope === "tab"
  panelId?: string; // Only if scope === "panel"

  // Configuration
  type: "query_values" | "custom" | "constant" | "textbox" | "dynamic_filters";
  multiSelect: boolean;
  query_data?: QueryDataConfig;

  // Runtime state
  value: any;
  options: any[];

  // Loading state flags
  isLoading: boolean;
  isVariableLoadingPending: boolean;
  isVariablePartialLoaded: boolean;

  // Error state
  error?: string;
}
```

### Composable State Structure

Following the pattern from `usePanelDataLoader`, the composable maintains a simpler flat structure:

```typescript
// Main variables storage - indexed by scope
const variablesData = reactive({
  global: [] as VariableRuntimeState[],
  tabs: {} as Record<string, VariableRuntimeState[]>,
  panels: {} as Record<string, VariableRuntimeState[]>
});

// Dependency graph
const dependencyGraph = ref<{
  [variableKey: string]: {
    parents: string[];
    children: string[];
  };
}>({});

// Visibility tracking (similar to isVisible in usePanelDataLoader)
const tabsVisibility = ref<Record<string, boolean>>({});
const panelsVisibility = ref<Record<string, boolean>>({});

// Promise tracking for cancellation (similar to usePanelDataLoader)
const currentlyExecutingPromises = new Map<string, { reject: Function }>();
```

**Note**: Unlike a separate `VariablesManagerState` interface, we keep state as individual reactive refs/objects similar to `usePanelDataLoader.ts` pattern. This makes the code simpler and easier to track.

### Variable Key Format

To uniquely identify variables across scopes, use a composite key:

```typescript
function getVariableKey(
  name: string,
  scope: "global" | "tab" | "panel",
  tabId?: string,
  panelId?: string
): string {
  if (scope === "global") {
    return `${name}@global`;
  } else if (scope === "tab") {
    return `${name}@tab@${tabId}`;
  } else {
    return `${name}@panel@${panelId}`;
  }
}

// Examples:
// Global: "country@global"
// Tab: "region@tab@tab-1"
// Panel: "status@panel@panel-123"
```

---

## Dependency Management

### Allowed Dependency Hierarchies

```
✅ ALLOWED:
global → global       (global var depends on another global var)
global → tab          (tab var depends on global var)
global → panel        (panel var depends on global var)
global → tab → panel  (panel var depends on tab var, which depends on global)
tab → same tab        (tab var depends on another var in same tab)
tab → panel           (panel var in that tab depends on tab var)
panel → panel         (panel var depends on another var in same panel)

❌ NOT ALLOWED:
tab → global          (global cannot depend on tab-scoped)
panel → global        (global cannot depend on panel-scoped)
panel → tab           (tab cannot depend on panel-scoped)
tab1 → tab2           (tab var cannot depend on var from different tab)
panel1 → panel2       (panel var cannot depend on var from different panel)
```

### Dependency Graph Building Algorithm

**Enhanced from current implementation** to support scope validation.

```typescript
interface ScopedDependencyGraph {
  [variableKey: string]: {
    parents: string[];
    children: string[];
    scope: "global" | "tab" | "panel";
    tabId?: string;
    panelId?: string;
  };
}

function buildScopedDependencyGraph(
  variables: VariableConfig[]
): ScopedDependencyGraph {
  const graph: ScopedDependencyGraph = {};

  // Step 1: Expand variables with multiple assignments
  const expandedVariables = expandVariablesForScopes(variables);

  // Step 2: Initialize nodes
  expandedVariables.forEach(variable => {
    const key = getVariableKey(variable.name, variable.scope, variable.tabId, variable.panelId);
    graph[key] = {
      parents: [],
      children: [],
      scope: variable.scope,
      tabId: variable.tabId,
      panelId: variable.panelId
    };
  });

  // Step 3: Build edges
  expandedVariables.forEach(variable => {
    const childKey = getVariableKey(variable.name, variable.scope, variable.tabId, variable.panelId);

    if (variable.type === "query_values") {
      const filters = variable.query_data?.filter || [];

      filters.forEach(filter => {
        // Extract parent variable names from filter (e.g., "$country")
        const parentNames = extractVariableNames(filter.filter || "");

        parentNames.forEach(parentName => {
          // Resolve which parent variable this child should connect to
          const parentKey = resolveParentVariable(
            parentName,
            variable.scope,
            variable.tabId,
            variable.panelId,
            expandedVariables
          );

          if (parentKey) {
            // Validate dependency is allowed
            if (isValidDependency(graph[parentKey], graph[childKey])) {
              graph[childKey].parents.push(parentKey);
              graph[parentKey].children.push(childKey);
            } else {
              throw new Error(
                `Invalid dependency: ${childKey} cannot depend on ${parentKey}`
              );
            }
          }
        });
      });
    }
  });

  return graph;
}

function isValidDependency(
  parent: { scope: string; tabId?: string; panelId?: string },
  child: { scope: string; tabId?: string; panelId?: string }
): boolean {
  // Global can be parent of anything
  if (parent.scope === "global") return true;

  // Tab can be parent of panel or same tab
  if (parent.scope === "tab") {
    if (child.scope === "panel") return true;
    if (child.scope === "tab" && parent.tabId === child.tabId) return true;
    return false;
  }

  // Panel can be parent of same panel only
  if (parent.scope === "panel") {
    return child.scope === "panel" && parent.panelId === child.panelId;
  }

  return false;
}

function resolveParentVariable(
  parentName: string,
  childScope: "global" | "tab" | "panel",
  childTabId: string | undefined,
  childPanelId: string | undefined,
  allVariables: VariableRuntimeState[]
): string | null {
  // Resolution order (child looking for parent):
  // 1. If child is global: Look in global only
  // 2. If child is tab: Look in same tab, then global
  // 3. If child is panel: Look in same panel, then parent tab, then global

  if (childScope === "global") {
    const parent = allVariables.find(
      v => v.name === parentName && v.scope === "global"
    );
    return parent ? getVariableKey(parent.name, parent.scope) : null;
  }

  if (childScope === "tab") {
    // Check same tab first
    let parent = allVariables.find(
      v => v.name === parentName &&
           v.scope === "tab" &&
           v.tabId === childTabId
    );
    if (parent) return getVariableKey(parent.name, parent.scope, parent.tabId);

    // Fall back to global
    parent = allVariables.find(
      v => v.name === parentName && v.scope === "global"
    );
    return parent ? getVariableKey(parent.name, parent.scope) : null;
  }

  if (childScope === "panel") {
    // Check same panel first
    let parent = allVariables.find(
      v => v.name === parentName &&
           v.scope === "panel" &&
           v.panelId === childPanelId
    );
    if (parent) return getVariableKey(parent.name, parent.scope, undefined, parent.panelId);

    // Check parent tab (need to know which tab the panel belongs to)
    const panelTabId = getPanelTabMapping(childPanelId);
    if (panelTabId) {
      parent = allVariables.find(
        v => v.name === parentName &&
             v.scope === "tab" &&
             v.tabId === panelTabId
      );
      if (parent) return getVariableKey(parent.name, parent.scope, parent.tabId);
    }

    // Fall back to global
    parent = allVariables.find(
      v => v.name === parentName && v.scope === "global"
    );
    return parent ? getVariableKey(parent.name, parent.scope) : null;
  }

  return null;
}
```

### Cycle Detection

**Same DFS algorithm** as current implementation, but uses scoped variable keys.

```typescript
function detectCyclesInScopedGraph(
  graph: ScopedDependencyGraph
): string[] | null {
  const visited = new Set<string>();
  const recStack = new Set<string>();

  for (const nodeKey of Object.keys(graph)) {
    if (!visited.has(nodeKey)) {
      const cyclePath = dfsDetectCycle(nodeKey, graph, visited, recStack, []);
      if (cyclePath) {
        return cyclePath; // Return cycle path for error message
      }
    }
  }

  return null; // No cycle
}

// Same DFS implementation as current, just with scoped keys
```

---

## Loading Behavior

### Loading State Flags (Per Variable)

| Flag | Meaning | When Set |
|------|---------|----------|
| `isLoading` | API call in progress | When fetch starts, cleared when response completes |
| `isVariableLoadingPending` | Waiting for dependencies or visibility | Set initially, cleared when loading starts |
| `isVariablePartialLoaded` | Has received at least partial data | Set on first streaming response |

**Note**: Visibility is tracked at composable level (not per-variable) via `tabsVisibility` and `panelsVisibility` refs, similar to `usePanelDataLoader`'s `isVisible` ref.

### Loading State Machine

Using exact variable names from `VariableRuntimeState`:

```
┌──────────────────────────────────┐
│         INITIALIZED              │
│  isVariableLoadingPending=true   │
│  isLoading=false                 │
│  isVariablePartialLoaded=false   │
└────────┬─────────────────────────┘
         │
         │ (Scope visible + Parent dependencies ready)
         │
         ▼
┌──────────────────────────────────┐
│          LOADING                 │
│  isVariableLoadingPending=false  │
│  isLoading=true                  │
│  isVariablePartialLoaded=false   │
└────────┬─────────────────────────┘
         │
         │ (First streaming response received)
         │
         ▼
┌──────────────────────────────────┐
│       PARTIAL_LOADED             │
│  isVariableLoadingPending=false  │◄────┐
│  isLoading=true                  │     │ (More streaming responses)
│  isVariablePartialLoaded=true    │     │
└────────┬─────────────────────────┘     │
         │                                │
         │ (Trigger child variables       │
         │  to start loading)             │
         │                                │
         │ (Final response received)      │
         ▼                                │
┌──────────────────────────────────┐     │
│            LOADED                │─────┘
│  isVariableLoadingPending=false  │
│  isLoading=false                 │
│  isVariablePartialLoaded=true    │
└──────────────────────────────────┘
```

### Lazy Loading Strategy

**Global Variables**: Load immediately on dashboard mount.

**Tab Variables**: Load when tab becomes active (visible).

**Panel Variables**: Load when panel enters viewport (IntersectionObserver).

#### Tab Lazy Loading

```typescript
// In tab component
watch(
  () => props.isActive,
  (isActive) => {
    if (isActive) {
      // Mark tab variables as visible
      variablesManager.setTabVisibility(tabId, true);

      // Trigger loading of tab variables
      variablesManager.loadTabVariables(tabId);
    }
  },
  { immediate: true }
);
```

#### Panel Lazy Loading

```typescript
// In panel component
const { intersectionObserver } = useIntersectionObserver({
  onEnter: () => {
    // Mark panel variables as visible
    variablesManager.setPanelVisibility(panelId, true);

    // Trigger loading of panel variables
    variablesManager.loadPanelVariables(panelId);
  }
});

onMounted(() => {
  intersectionObserver.observe(panelElement.value);
});
```

### Loading Sequence

#### Concurrent Loading Approach

**IMPORTANT**: The loading system uses a **concurrent, dependency-driven** approach. We **DO NOT** wait for all variables in one scope to complete before starting the next scope. Instead:

- **Load whoever is ready and visible** from the entire dependency tree
- As soon as a variable completes (becomes `isVariablePartialLoaded=true`), **immediately trigger its children** if they are visible
- Multiple scopes (global, tab, panel) can have variables loading **simultaneously**

This maximizes parallelization and reduces total loading time.

#### Initial Dashboard Load (Concurrent Flow)

```
1. Dashboard mounts
   ↓
2. Initialize composable: useVariablesManager()
   ↓
3. Expand variables (create separate instances for tabs/panels)
   ↓
4. Build dependency graph
   ↓
5. Detect cycles (error if found)
   ↓
6. Load all independent global variables in parallel
   ↓
7. Immediately as EACH global variable completes:
   → Check if it has dependent global variables → load them
   → Check if it has dependent tab variables AND tab is visible → load them
   → Check if it has dependent panel variables AND panel is visible → load them
   (DO NOT wait for other globals to complete)
   ↓
8. Example concurrent scenario:
   - Global variable A completes → triggers Tab1 variable B (if Tab1 visible)
   - Global variable C is still loading
   - Tab1 variable B completes → triggers Panel1 variable D (if Panel1 visible)
   - Global variable C completes → triggers Tab2 variable E (if Tab2 visible)
   ↓
   All three scopes (global, tab, panel) have variables loading concurrently
   ↓
9. Loading continues until all visible variables complete
```

**Key Principle**: Each variable, upon partial load, triggers ALL its children that are ready and visible - regardless of scope. This creates a cascading, concurrent loading pattern across the entire dependency tree.

#### Loading Trigger Conditions

A variable can start loading when:
1. **Visibility**: Its scope is visible (global always, tab when active, panel when in viewport)
2. **Dependencies**: All parent variables have `isVariablePartialLoaded === true`
3. **Not Already Loading**: `isLoading === false` and `isVariableLoadingPending === true`

```typescript
function canVariableLoad(
  variable: VariableRuntimeState,
  tabsVisibility: Record<string, boolean>,
  panelsVisibility: Record<string, boolean>,
  allVariables: VariableRuntimeState[],
  dependencyGraph: ScopedDependencyGraph
): boolean {
  const key = getVariableKey(variable.name, variable.scope, variable.tabId, variable.panelId);

  // Check 1: Is visible?
  if (!isVariableVisible(variable, tabsVisibility, panelsVisibility)) {
    return false;
  }

  // Check 2: Already loading?
  if (variable.isLoading) {
    return false;
  }

  // Check 3: All parents ready?
  const parents = dependencyGraph[key]?.parents || [];
  const allParentsReady = parents.every(parentKey => {
    const parentVar = findVariableByKey(parentKey, allVariables);
    return parentVar?.isVariablePartialLoaded === true;
  });

  return allParentsReady;
}

function isVariableVisible(
  variable: VariableRuntimeState,
  tabsVisibility: Record<string, boolean>,
  panelsVisibility: Record<string, boolean>
): boolean {
  if (variable.scope === "global") return true;
  if (variable.scope === "tab") {
    return tabsVisibility[variable.tabId!] === true;
  }
  if (variable.scope === "panel") {
    return panelsVisibility[variable.panelId!] === true;
  }
  return false;
}
```

### Handling Null Values

When a variable loads but returns no data:

1. Set `value` to `null` (or `[]` for multi-select)
2. Set `isVariablePartialLoaded = true` (allows children to proceed)
3. Set `isLoading = false`
4. Trigger child variables to load
5. Children will also likely return no data, cascading down
6. When replacing in panel queries, use `_o2_all_` sentinel:

```typescript
function replaceVariableInQuery(
  query: string,
  variable: VariableRuntimeState
): string {
  const isNullValue =
    variable.value === null ||
    (Array.isArray(variable.value) && variable.value.length === 0);

  if (isNullValue) {
    // Replace with sentinel that backend recognizes
    return query.replaceAll(
      new RegExp(`\\$${variable.name}`, "g"),
      "_o2_all_"
    );
  }

  // Normal replacement
  // ...
}
```

Backend should recognize `_o2_all_` and drop that filter entirely.

---

## Composable Architecture

### Composable: `useVariablesManager()`

**Purpose**: Centralized state management for all variables across all scopes.

**Location**: `web/src/composables/dashboard/useVariablesManager.ts`

**Responsibilities**:
1. Maintain centralized state for all variables
2. Build and manage dependency graph
3. Orchestrate loading across scopes
4. Handle visibility tracking
5. Coordinate lazy loading
6. Provide API for components to interact with variables

### Composable API

```typescript
interface UseVariablesManager {
  // State (reactive)
  variables: Ref<VariablesManagerState>;
  dependencyGraph: Ref<ScopedDependencyGraph>;
  isLoading: ComputedRef<boolean>; // True if any variable is loading

  // Initialization
  initialize(config: VariableConfig[]): Promise<void>;

  // Loading
  loadGlobalVariables(): Promise<void>;
  loadTabVariables(tabId: string): Promise<void>;
  loadPanelVariables(panelId: string): Promise<void>;
  loadSingleVariable(variableKey: string): Promise<void>;

  // Visibility
  setTabVisibility(tabId: string, visible: boolean): void;
  setPanelVisibility(panelId: string, visible: boolean): void;

  // Value updates
  updateVariableValue(
    name: string,
    scope: "global" | "tab" | "panel",
    tabId: string | undefined,
    panelId: string | undefined,
    newValue: any
  ): Promise<void>;

  // Queries
  getVariable(
    name: string,
    scope: "global" | "tab" | "panel",
    tabId?: string,
    panelId?: string
  ): VariableRuntimeState | undefined;

  getVariablesForPanel(panelId: string): VariableRuntimeState[];
  getVariablesForTab(tabId: string): VariableRuntimeState[];
  getAllVisibleVariables(tabId?: string, panelId?: string): VariableRuntimeState[];

  // URL sync
  syncToUrl(router: Router, route: Route): void;
  loadFromUrl(route: Route): void;

  // Utilities
  isVariableReady(variableKey: string): boolean;
  getDependentVariables(variableKey: string): string[];
}
```

### Implementation Structure

```typescript
// web/src/composables/dashboard/useVariablesManager.ts

import { ref, computed, reactive } from "vue";
import { buildScopedDependencyGraph, detectCyclesInScopedGraph } from "@/utils/dashboard/variables/variablesDependencyUtils";

export function useVariablesManager() {
  // ========== STATE ==========
  const state = reactive<VariablesManagerState>({
    variables: {
      global: [],
      tabs: {},
      panels: {}
    },
    dependencyGraph: {},
    loadingState: {
      global: false,
      tabs: {},
      panels: {}
    },
    visibilityState: {
      tabs: {},
      panels: {}
    }
  });

  // Promise tracking for cancellation
  const currentlyExecutingPromises = new Map<string, { reject: Function }>();

  // ========== INITIALIZATION ==========
  async function initialize(config: VariableConfig[]) {
    // 1. Expand variables for scopes
    const expandedVars = expandVariablesForScopes(config);

    // 2. Populate state
    expandedVars.forEach(varState => {
      if (varState.scope === "global") {
        state.variables.global.push(varState);
      } else if (varState.scope === "tab") {
        if (!state.variables.tabs[varState.tabId!]) {
          state.variables.tabs[varState.tabId!] = [];
        }
        state.variables.tabs[varState.tabId!].push(varState);
      } else if (varState.scope === "panel") {
        if (!state.variables.panels[varState.panelId!]) {
          state.variables.panels[varState.panelId!] = [];
        }
        state.variables.panels[varState.panelId!].push(varState);
      }
    });

    // 3. Build dependency graph
    state.dependencyGraph = buildScopedDependencyGraph(expandedVars);

    // 4. Detect cycles
    const cycle = detectCyclesInScopedGraph(state.dependencyGraph);
    if (cycle) {
      throw new Error(`Circular dependency detected: ${cycle.join(" → ")}`);
    }

    // 5. Load from URL
    loadFromUrl(/* route */);

    // 6. Start loading global variables
    await loadGlobalVariables();
  }

  // ========== LOADING ==========
  async function loadGlobalVariables() {
    const globalVars = state.variables.global;
    const independentVars = globalVars.filter(v => {
      const key = getVariableKey(v.name, v.scope);
      const parents = state.dependencyGraph[key]?.parents || [];
      return parents.length === 0;
    });

    state.loadingState.global = true;

    const promises = independentVars.map(v =>
      loadSingleVariable(getVariableKey(v.name, v.scope))
    );

    await Promise.all(promises);

    state.loadingState.global = false;
  }

  async function loadTabVariables(tabId: string) {
    const tabVars = state.variables.tabs[tabId] || [];
    const loadableVars = tabVars.filter(v =>
      canVariableLoad(v, state.visibilityState, getAllVariablesFlat(), state.dependencyGraph)
    );

    state.loadingState.tabs[tabId] = true;

    const promises = loadableVars.map(v =>
      loadSingleVariable(getVariableKey(v.name, v.scope, v.tabId, v.panelId))
    );

    await Promise.all(promises);

    state.loadingState.tabs[tabId] = false;
  }

  async function loadPanelVariables(panelId: string) {
    const panelVars = state.variables.panels[panelId] || [];
    const loadableVars = panelVars.filter(v =>
      canVariableLoad(v, state.visibilityState, getAllVariablesFlat(), state.dependencyGraph)
    );

    state.loadingState.panels[panelId] = true;

    const promises = loadableVars.map(v =>
      loadSingleVariable(getVariableKey(v.name, v.scope, v.tabId, v.panelId))
    );

    await Promise.all(promises);

    state.loadingState.panels[panelId] = false;
  }

  async function loadSingleVariable(variableKey: string) {
    return new Promise((resolve, reject) => {
      // Cancel previous request
      if (currentlyExecutingPromises.has(variableKey)) {
        currentlyExecutingPromises.get(variableKey)!.reject();
      }

      currentlyExecutingPromises.set(variableKey, { reject });

      const variable = findVariableByKey(variableKey, getAllVariablesFlat());
      if (!variable) {
        reject("Variable not found");
        return;
      }

      // Check visibility
      if (!isVariableVisible(variable, state.visibilityState)) {
        variable.isVariableLoadingPending = true;
        reject("Not visible");
        return;
      }

      // Check dependencies
      const parents = state.dependencyGraph[variableKey]?.parents || [];
      const allParentsReady = parents.every(parentKey => {
        const parent = findVariableByKey(parentKey, getAllVariablesFlat());
        return parent?.isVariablePartialLoaded === true;
      });

      if (!allParentsReady) {
        variable.isVariableLoadingPending = true;
        reject("Dependencies not ready");
        return;
      }

      // Start loading
      variable.isLoading = true;
      variable.isVariableLoadingPending = false;

      // Handle by type
      if (variable.type === "query_values") {
        loadQueryValuesVariable(variable, variableKey, resolve, reject);
      } else {
        // Immediate types (custom, constant, textbox)
        finalizeVariableLoading(variable, variableKey, true, resolve);
      }
    });
  }

  function loadQueryValuesVariable(
    variable: VariableRuntimeState,
    variableKey: string,
    resolve: Function,
    reject: Function
  ) {
    // Build query with parent substitution
    const queryContext = buildQueryContext(variable, state);

    // Fetch via streaming
    fetchFieldValuesWithWebsocket(variable, queryContext, {
      onPartial: (data: any) => {
        handlePartialResponse(variable, variableKey, data);
      },
      onComplete: () => {
        finalizeVariableLoading(variable, variableKey, true, resolve);
      },
      onError: (error: any) => {
        finalizeVariableLoading(variable, variableKey, false, reject);
      }
    });
  }

  function handlePartialResponse(
    variable: VariableRuntimeState,
    variableKey: string,
    data: any
  ) {
    // Update options
    const newValues = data.hits?.map((hit: any) => hit[variable.query_data!.field]) || [];
    const existingOptions = variable.options || [];
    const allOptions = [...existingOptions, ...newValues];
    variable.options = Array.from(new Set(allOptions)).sort();

    // Mark as partially loaded
    variable.isVariablePartialLoaded = true;

    // Trigger dependent variables
    const children = state.dependencyGraph[variableKey]?.children || [];
    children.forEach(childKey => {
      const childVar = findVariableByKey(childKey, getAllVariablesFlat());
      if (childVar && canVariableLoad(childVar, state.visibilityState, getAllVariablesFlat(), state.dependencyGraph)) {
        loadSingleVariable(childKey);
      }
    });
  }

  function finalizeVariableLoading(
    variable: VariableRuntimeState,
    variableKey: string,
    success: boolean,
    resolve: Function
  ) {
    variable.isLoading = false;
    variable.isVariablePartialLoaded = success;
    variable.hasLoadedOnce = success;

    currentlyExecutingPromises.delete(variableKey);

    // Trigger children
    const children = state.dependencyGraph[variableKey]?.children || [];
    children.forEach(childKey => {
      const childVar = findVariableByKey(childKey, getAllVariablesFlat());
      if (childVar && canVariableLoad(childVar, state.visibilityState, getAllVariablesFlat(), state.dependencyGraph)) {
        loadSingleVariable(childKey);
      }
    });

    resolve(success);
  }

  // ========== VISIBILITY ==========
  function setTabVisibility(tabId: string, visible: boolean) {
    state.visibilityState.tabs[tabId] = visible;

    if (visible) {
      loadTabVariables(tabId);
    }
  }

  function setPanelVisibility(panelId: string, visible: boolean) {
    state.visibilityState.panels[panelId] = visible;

    if (visible) {
      loadPanelVariables(panelId);
    }
  }

  // ========== VALUE UPDATES ==========
  async function updateVariableValue(
    name: string,
    scope: "global" | "tab" | "panel",
    tabId: string | undefined,
    panelId: string | undefined,
    newValue: any
  ) {
    const variable = getVariable(name, scope, tabId, panelId);
    if (!variable) return;

    variable.value = newValue;

    // Trigger dependent variables
    const variableKey = getVariableKey(name, scope, tabId, panelId);
    const children = state.dependencyGraph[variableKey]?.children || [];

    for (const childKey of children) {
      await loadSingleVariable(childKey);
    }

    // Sync to URL
    syncToUrl(/* router, route */);
  }

  // ========== QUERIES ==========
  function getVariable(
    name: string,
    scope: "global" | "tab" | "panel",
    tabId?: string,
    panelId?: string
  ): VariableRuntimeState | undefined {
    if (scope === "global") {
      return state.variables.global.find(v => v.name === name);
    } else if (scope === "tab" && tabId) {
      return state.variables.tabs[tabId]?.find(v => v.name === name);
    } else if (scope === "panel" && panelId) {
      return state.variables.panels[panelId]?.find(v => v.name === name);
    }
    return undefined;
  }

  function getVariablesForPanel(panelId: string): VariableRuntimeState[] {
    // Get panel's tab
    const tabId = getPanelTabMapping(panelId);

    // Merge: global + tab + panel
    const merged = [
      ...state.variables.global,
      ...(tabId ? state.variables.tabs[tabId] || [] : []),
      ...(state.variables.panels[panelId] || [])
    ];

    return merged;
  }

  function getAllVisibleVariables(
    tabId?: string,
    panelId?: string
  ): VariableRuntimeState[] {
    if (panelId) {
      return getVariablesForPanel(panelId);
    } else if (tabId) {
      return [
        ...state.variables.global,
        ...(state.variables.tabs[tabId] || [])
      ];
    } else {
      return state.variables.global;
    }
  }

  // ========== RETURN API ==========
  return {
    // State
    variables: computed(() => state.variables),
    dependencyGraph: computed(() => state.dependencyGraph),
    isLoading: computed(() => {
      return state.loadingState.global ||
             Object.values(state.loadingState.tabs).some(v => v) ||
             Object.values(state.loadingState.panels).some(v => v);
    }),

    // Methods
    initialize,
    loadGlobalVariables,
    loadTabVariables,
    loadPanelVariables,
    loadSingleVariable,
    setTabVisibility,
    setPanelVisibility,
    updateVariableValue,
    getVariable,
    getVariablesForPanel,
    getVariablesForTab,
    getAllVisibleVariables,
    syncToUrl,
    loadFromUrl,
    isVariableReady,
    getDependentVariables
  };
}
```

---

## URL Synchronization

### URL Format

#### Global Variables

**Format**: `var-{name}={value}`

**Examples**:
- Single value: `var-country=USA`
- Multi-select: `var-status=200,404,500`

#### Tab Variables

**Format**: `var-{name}.t.{tabId}={value}`

**Examples**:
- Tab 1: `var-region.t.tab-1=CA,OR`
- Tab 2: `var-region.t.tab-2=NY,NJ`

#### Panel Variables

**Format**: `var-{name}.p.{panelId}={value}`

**Examples**:
- Panel 1: `var-city.p.panel-123=LA`
- Panel 2: `var-city.p.panel-456=NYC`

### Full URL Example

```
/dashboards/view/dashboard-id?
  var-country=USA&
  var-environment=production&
  var-region.t.tab-1=CA,OR&
  var-region.t.tab-2=NY,NJ&
  var-city.p.panel-123=LA&
  var-status.p.panel-456=200,404
```

### URL Generation (Writing)

```typescript
function syncToUrl(router: Router, route: Route) {
  const queryParams: Record<string, string> = {};

  // Global variables
  state.variables.global.forEach(variable => {
    if (variable.type !== "dynamic_filters") {
      const key = `var-${variable.name}`;
      queryParams[key] = formatValueForUrl(variable.value);
    }
  });

  // Tab variables
  Object.entries(state.variables.tabs).forEach(([tabId, variables]) => {
    variables.forEach(variable => {
      if (variable.type !== "dynamic_filters") {
        const key = `var-${variable.name}.t.${tabId}`;
        queryParams[key] = formatValueForUrl(variable.value);
      }
    });
  });

  // Panel variables
  Object.entries(state.variables.panels).forEach(([panelId, variables]) => {
    variables.forEach(variable => {
      if (variable.type !== "dynamic_filters") {
        const key = `var-${variable.name}.p.${panelId}`;
        queryParams[key] = formatValueForUrl(variable.value);
      }
    });
  });

  router.replace({
    query: {
      ...route.query,
      ...queryParams
    }
  });
}

function formatValueForUrl(value: any): string {
  if (Array.isArray(value)) {
    return value.join(",");
  }
  return String(value);
}
```

### URL Parsing (Reading)

```typescript
function loadFromUrl(route: Route) {
  const query = route.query;

  Object.entries(query).forEach(([key, value]) => {
    if (!key.startsWith("var-")) return;

    const parsed = parseVariableUrlKey(key);
    if (!parsed) return;

    const variable = getVariable(parsed.name, parsed.scope, parsed.tabId, parsed.panelId);
    if (!variable) return;

    // Parse value
    const parsedValue = variable.multiSelect
      ? String(value).split(",")
      : value;

    variable.value = parsedValue;
  });
}

interface ParsedUrlKey {
  name: string;
  scope: "global" | "tab" | "panel";
  tabId?: string;
  panelId?: string;
}

function parseVariableUrlKey(key: string): ParsedUrlKey | null {
  // Remove "var-" prefix
  const withoutPrefix = key.replace(/^var-/, "");

  // Check for tab scope: var-region.t.tab-1
  const tabMatch = withoutPrefix.match(/^(.+)\.t\.(.+)$/);
  if (tabMatch) {
    return {
      name: tabMatch[1],
      scope: "tab",
      tabId: tabMatch[2]
    };
  }

  // Check for panel scope: var-city.p.panel-123
  const panelMatch = withoutPrefix.match(/^(.+)\.p\.(.+)$/);
  if (panelMatch) {
    return {
      name: panelMatch[1],
      scope: "panel",
      panelId: panelMatch[2]
    };
  }

  // Global scope (no suffix)
  return {
    name: withoutPrefix,
    scope: "global"
  };
}
```

### Drilldown Compatibility

**Problem**: Drilldown URLs cannot specify tab/panel scope (user isn't selecting those).

**Solution**: Apply simple `var-{name}={value}` to ALL instances of that variable.

```typescript
function loadFromUrl(route: Route) {
  // ... previous code ...

  // Special handling for unscoped variables in URL
  Object.entries(query).forEach(([key, value]) => {
    if (!key.startsWith("var-")) return;

    const parsed = parseVariableUrlKey(key);
    if (!parsed) return;

    if (parsed.scope === "global") {
      const variable = getVariable(parsed.name, "global");
      if (variable) {
        variable.value = parseValue(value, variable.multiSelect);
      }

      // ALSO apply to all tab/panel instances of same name
      Object.values(state.variables.tabs).forEach(tabVars => {
        const tabVar = tabVars.find(v => v.name === parsed.name);
        if (tabVar) {
          tabVar.value = parseValue(value, tabVar.multiSelect);
        }
      });

      Object.values(state.variables.panels).forEach(panelVars => {
        const panelVar = panelVars.find(v => v.name === parsed.name);
        if (panelVar) {
          panelVar.value = parseValue(value, panelVar.multiSelect);
        }
      });
    } else {
      // Scoped variable in URL - apply to that specific instance
      const variable = getVariable(parsed.name, parsed.scope, parsed.tabId, parsed.panelId);
      if (variable) {
        variable.value = parseValue(value, variable.multiSelect);
      }
    }
  });
}
```

---

## Component Integration

### ViewDashboard.vue Changes

**Current**: Renders single `VariablesValueSelector` at top level.

**New**:
1. Initialize `useVariablesManager()` composable
2. Render global `VariablesValueSelector` at top level
3. Pass composable to child components

```vue
<template>
  <div class="view-dashboard">
    <!-- Global Variables -->
    <VariablesValueSelector
      :scope="'global'"
      :variables-config="globalVariablesConfig"
      :variables-manager="variablesManager"
    />

    <!-- Tab Container -->
    <q-tabs v-model="activeTab">
      <q-tab
        v-for="tab in dashboard.tabs"
        :key="tab.id"
        :name="tab.id"
        :label="tab.name"
      />
    </q-tabs>

    <q-tab-panels v-model="activeTab">
      <q-tab-panel
        v-for="tab in dashboard.tabs"
        :key="tab.id"
        :name="tab.id"
      >
        <!-- Tab Variables -->
        <VariablesValueSelector
          v-if="tab.variables?.length"
          :scope="'tab'"
          :scope-id="tab.id"
          :variables-config="tab.variables"
          :variables-manager="variablesManager"
        />

        <!-- Render Panels -->
        <RenderDashboardCharts
          :tab-id="tab.id"
          :panels="tab.panels"
          :variables-manager="variablesManager"
        />
      </q-tab-panel>
    </q-tab-panels>
  </div>
</template>

<script setup lang="ts">
import { useVariablesManager } from "@/composables/dashboard/useVariablesManager";

const props = defineProps<{
  dashboard: Dashboard;
}>();

// Initialize composable
const variablesManager = useVariablesManager();

onMounted(async () => {
  // Initialize with all variables from config
  await variablesManager.initialize(props.dashboard.variables);
});

// Watch for tab activation
watch(activeTab, (newTabId) => {
  if (newTabId) {
    variablesManager.setTabVisibility(newTabId, true);
  }
});
</script>
```

### VariablesValueSelector.vue Changes

**Current**: Single instance, manages all loading.

**New**: Multiple instances, each manages its scope, uses composable for coordination.

**Props**:
```typescript
interface Props {
  scope: "global" | "tab" | "panel";
  tabId?: string;   // Required for tab scope
  panelId?: string; // Required for panel scope
  variablesConfig: VariableConfig[];
  variablesManager: ReturnType<typeof useVariablesManager>;
}
```

**Behavior**:
- Renders only variables for its scope
- Uses composable methods for loading
- Emits value changes to composable
- No longer maintains dependency graph (composable does)

```vue
<script setup lang="ts">
const props = defineProps<Props>();

// Get variables for this scope from composable
const variables = computed(() => {
  if (props.scope === "global") {
    return props.variablesManager.variables.value.global;
  } else if (props.scope === "tab") {
    return props.variablesManager.variables.value.tabs[props.tabId!] || [];
  } else if (props.scope === "panel") {
    return props.variablesManager.variables.value.panels[props.panelId!] || [];
  }
  return [];
});

// When user changes value
function onValueChange(variableName: string, newValue: any) {
  props.variablesManager.updateVariableValue(
    variableName,
    props.scope,
    props.tabId,
    props.panelId,
    newValue
  );
}

// Component no longer directly manages loading
// All loading coordinated through composable
</script>
```

### PanelContainer.vue Changes

**New Prop**: Receives `panelId` to identify which panel variables to use.

```vue
<script setup lang="ts">
const props = defineProps<{
  panelId: string;
  variablesManager: ReturnType<typeof useVariablesManager>;
  // ... other props
}>();

// Get merged variables for this panel (global + tab + panel)
const variables = computed(() => {
  return props.variablesManager.getVariablesForPanel(props.panelId);
});

// Lazy loading trigger
const { intersectionObserver } = useIntersectionObserver({
  onEnter: () => {
    props.variablesManager.setPanelVisibility(props.panelId, true);
  }
});

onMounted(() => {
  intersectionObserver.observe(panelElement.value);
});
</script>
```

### AddPanel / ViewPanel Popups

**Scenario**: Panel shown independently without dashboard context (no tabs, no global vars).

**Solution**: Create temporary local composable instance with only panel-relevant variables.

```vue
<script setup lang="ts">
// In AddPanel.vue or ViewPanel.vue

const props = defineProps<{
  panel: Panel;
}>();

// Create local variables manager for this popup
const localVariablesManager = useVariablesManager();

onMounted(async () => {
  // Get variables applicable to this panel
  const applicableVars = getApplicableVariablesForPanel(props.panel);

  // Initialize local manager
  await localVariablesManager.initialize(applicableVars);

  // All variables are treated as global in this context
  localVariablesManager.setTabVisibility("popup", true);
});
</script>
```

---

## Variable Visibility & Access

### Visibility Rules

**Global Variables**: Visible everywhere (all tabs, all panels).

**Tab Variables**: Visible in:
- The tab's variable selector
- All panels within that tab
- NOT visible in other tabs

**Panel Variables**: Visible only in:
- The panel's variable selector (if shown)
- That specific panel
- NOT visible in other panels or tabs

### Access Resolution for Panel Queries

When a panel executes a query, it needs to resolve variable references.

**Resolution Order** (by scope):

```typescript
function getVariablesForPanel(panelId: string): VariableRuntimeState[] {
  const tabId = getPanelTabMapping(panelId); // Which tab does this panel belong to?

  // Merge in order of precedence (later overrides earlier if same name)
  return [
    ...state.variables.global,          // 1. Global (lowest precedence)
    ...(tabId ? state.variables.tabs[tabId] || [] : []), // 2. Tab
    ...(state.variables.panels[panelId] || [])  // 3. Panel (highest precedence)
  ];
}
```

**Conflict Resolution**: If same variable name exists at multiple scopes, panel-level wins, then tab-level, then global.

```typescript
function resolveVariableForPanel(
  variableName: string,
  panelId: string
): VariableRuntimeState | undefined {
  const allVars = getVariablesForPanel(panelId);

  // Find the most specific scope (panel > tab > global)
  let panelVar = allVars.find(v => v.name === variableName && v.scope === "panel");
  if (panelVar) return panelVar;

  let tabVar = allVars.find(v => v.name === variableName && v.scope === "tab");
  if (tabVar) return tabVar;

  let globalVar = allVars.find(v => v.name === variableName && v.scope === "global");
  return globalVar;
}
```

### Variable Selector in Add Panel UI

**Requirement**: When adding filters to a panel, only show variables that panel can access.

**Implementation**:

```typescript
function getAvailableVariablesForPanel(
  panelId: string,
  dashboard: Dashboard
): VariableConfig[] {
  const tabId = getPanelTabMapping(panelId);

  // Collect accessible variables
  const accessible: VariableConfig[] = [];

  // 1. All global variables
  accessible.push(...dashboard.variables.filter(v => v.scope === "global"));

  // 2. Tab variables from parent tab
  if (tabId) {
    const tabVars = dashboard.variables.filter(
      v => v.scope === "tab" && v.tabs?.includes(tabId)
    );
    accessible.push(...tabVars);
  }

  // 3. Panel variables for this specific panel
  const panelVars = dashboard.variables.filter(
    v => v.scope === "panel" && v.panels?.includes(panelId)
  );
  accessible.push(...panelVars);

  return accessible;
}
```

In the add panel UI:

```vue
<q-select
  v-model="selectedVariable"
  :options="availableVariables"
  label="Select Variable"
/>

<script setup>
const availableVariables = computed(() => {
  return getAvailableVariablesForPanel(props.panelId, props.dashboard);
});
</script>
```

### Drilldown Variable Access

**Requirement**: In drilldown configuration, all variables should be available (user can link to any tab/panel).

**Implementation**: Show all variables regardless of scope, but indicate scope in UI.

```vue
<q-select
  v-model="drilldownVariable"
  :options="allVariablesWithScope"
  label="Select Variable"
>
  <template v-slot:option="{ opt }">
    <q-item>
      <q-item-section>
        <q-item-label>{{ opt.name }}</q-item-label>
        <q-item-label caption>
          Scope: {{ opt.scope }}
          {{ opt.tabId ? `(${opt.tabId})` : opt.panelId ? `(${opt.panelId})` : "" }}
        </q-item-label>
      </q-item-section>
    </q-item>
  </template>
</q-select>
```

---

## Migration Strategy

### Backward Compatibility

**Goal**: Existing dashboards (without scope) should work without modification.

**Approach**: Auto-migration on load.

```typescript
function migrateLegacyDashboard(dashboard: Dashboard): Dashboard {
  if (!dashboard.variables) return dashboard;

  dashboard.variables = dashboard.variables.map(variable => {
    // If no scope specified, treat as global
    if (!variable.scope) {
      return {
        ...variable,
        scope: "global"
      };
    }
    return variable;
  });

  return dashboard;
}

// In dashboard loading
async function loadDashboard(dashboardId: string) {
  let dashboard = await fetchDashboard(dashboardId);

  // Migrate legacy format
  dashboard = migrateLegacyDashboard(dashboard);

  return dashboard;
}
```

### Migration Steps for Users

1. **Phase 1 - No Action Required** (Backward Compatible):
   - Deploy new code
   - Existing dashboards auto-migrate to global scope
   - Everything works as before

2. **Phase 2 - Gradual Adoption** (Optional):
   - Users can start adding tab/panel scoped variables
   - New variable creation UI shows scope selector
   - Existing global variables remain unchanged

3. **Phase 3 - Full Feature Use**:
   - Users refactor dashboards to use scoped variables
   - Improved performance from lazy loading
   - More flexible variable management

### Data Model Changes

**Dashboard Schema Before**:
```typescript
{
  variables: [
    { name: "country", type: "query_values", ... }
  ]
}
```

**Dashboard Schema After**:
```typescript
{
  variables: [
    {
      name: "country",
      type: "query_values",
      scope: "global", // NEW (required)
      tabs: ["tab-1", "tab-2"], // NEW (optional, for scope=tab)
      panels: ["panel-1"], // NEW (optional, for scope=panel)
      ...
    }
  ]
}
```

**No Breaking Changes**: Old schemas work with auto-migration.

---

## Edge Cases & Considerations

### Edge Case 1: Variable Rename with Scoped Dependencies

**Problem**: If user renames a variable, dependencies break.

**Solution**: Validate and update all references.

```typescript
function renameVariable(
  oldName: string,
  newName: string,
  scope: string,
  dashboard: Dashboard
) {
  // 1. Update variable config
  const variable = dashboard.variables.find(
    v => v.name === oldName && v.scope === scope
  );
  if (variable) {
    variable.name = newName;
  }

  // 2. Update all references in other variables' filters
  dashboard.variables.forEach(v => {
    if (v.type === "query_values" && v.query_data?.filter) {
      v.query_data.filter.forEach(f => {
        if (f.filter) {
          f.filter = f.filter.replace(
            new RegExp(`\\$${oldName}\\b`, "g"),
            `$${newName}`
          );
        }
      });
    }
  });

  // 3. Update panel query references
  dashboard.panels?.forEach(panel => {
    panel.queries?.forEach(query => {
      query.query = query.query.replace(
        new RegExp(`\\$${oldName}\\b`, "g"),
        `$${newName}`
      );
    });
  });
}
```

### Edge Case 2: Tab Deletion with Tab-Scoped Variables

**Problem**: If user deletes a tab, what happens to variables scoped to that tab?

**Solution**:
1. Warn user that variables will be deleted
2. Show which panels/variables will be affected
3. Offer to move variables to global scope

```typescript
function validateTabDeletion(tabId: string, dashboard: Dashboard) {
  const affectedVars = dashboard.variables.filter(
    v => v.scope === "tab" && v.tabs?.includes(tabId)
  );

  if (affectedVars.length > 0) {
    return {
      canDelete: false,
      message: `This tab has ${affectedVars.length} variable(s). Delete them or move to global?`,
      affectedVariables: affectedVars
    };
  }

  return { canDelete: true };
}
```

### Edge Case 3: Panel Move Between Tabs

**Problem**: If user moves a panel from Tab A to Tab B, panel might depend on Tab A variables.

**Solution**: Validate dependencies and offer to copy variables or break dependencies.

```typescript
function validatePanelMove(
  panelId: string,
  fromTabId: string,
  toTabId: string,
  dashboard: Dashboard
) {
  const panelVars = dashboard.variables.filter(
    v => v.scope === "panel" && v.panels?.includes(panelId)
  );

  // Check if any panel variables depend on source tab's variables
  const dependsOnSourceTab = panelVars.some(panelVar => {
    const deps = extractDependencies(panelVar);
    return deps.some(depName => {
      const depVar = dashboard.variables.find(v => v.name === depName);
      return depVar?.scope === "tab" && depVar.tabs?.includes(fromTabId);
    });
  });

  if (dependsOnSourceTab) {
    return {
      canMove: false,
      message: "Panel depends on variables from source tab. Copy variables to target tab?",
      requiresAction: true
    };
  }

  return { canMove: true };
}
```

### Edge Case 4: Circular Dependencies Across Scopes

**Problem**: User creates `global → tab → panel → global` cycle.

**Solution**: Already handled by cycle detection algorithm (works with scoped keys).

```typescript
// Example cycle that will be detected:
// global:country → tab:region → panel:city → global:country (INVALID)

const cycle = detectCyclesInScopedGraph(graph);
if (cycle) {
  throw new Error(`Circular dependency: ${cycle.join(" → ")}`);
}
```

### Edge Case 5: Multiple Tabs Active Simultaneously

**Problem**: User has multiple tabs open (e.g., dashboard in multiple browser tabs).

**Solution**: Each browser tab maintains independent state. URL is source of truth.

- When user switches between browser tabs, dashboard reloads from URL
- No synchronization needed across browser tabs
- Each tab independently manages lazy loading

### Edge Case 6: Variable with No Data (Null Case)

**Scenario**: Variable query returns no results.

**Behavior**:
1. Set `value = null` or `[]`
2. Set `isVariablePartialLoaded = true` (allow children to proceed)
3. Children cascade down, likely also returning empty
4. Panel queries replace with `_o2_all_` sentinel
5. Backend drops filter, returns all data

**Example**:
```sql
-- Original query
SELECT * FROM logs WHERE region IN ($region) AND status = $status

-- If region = null
SELECT * FROM logs WHERE region IN (_o2_all_) AND status = $status

-- Backend interprets as
SELECT * FROM logs WHERE status = $status
```

### Edge Case 7: Drilldown URL Without Scope

**Scenario**: User clicks drilldown, URL contains `var-region=CA` (no scope indicator).

**Behavior**: Apply to ALL instances of that variable name.

```typescript
// URL: ?var-region=CA
// Result:
// global:region → "CA" (if exists)
// tab1:region → "CA"
// tab2:region → "CA"
// panel1:region → "CA"
```

This ensures drilldown works intuitively without requiring scope specification.

### Edge Case 8: Panel Variable Dependencies on Hidden Tabs

**Scenario**: Panel in Tab 2 depends on variable in Tab 1, but Tab 1 is not visible.

**Problem**: Tab 1 variable never loads (lazy loading).

**Solution**: Auto-load dependencies even if not visible.

```typescript
function loadPanelVariables(panelId: string) {
  const panelVars = state.variables.panels[panelId] || [];

  // Before loading panel vars, ensure all parents are loaded
  for (const panelVar of panelVars) {
    const parents = getDependencies(panelVar);

    for (const parentKey of parents) {
      const parent = findVariableByKey(parentKey);

      // If parent not loaded and not visible, force load anyway
      if (parent && !parent.isVariablePartialLoaded) {
        await loadSingleVariable(parentKey); // Force load even if hidden
      }
    }
  }

  // Now load panel variables
  // ...
}
```

### Edge Case 9: Rapid Tab Switching

**Scenario**: User rapidly switches between tabs before variables finish loading.

**Solution**: Cancel in-flight requests when tab becomes invisible.

```typescript
function setTabVisibility(tabId: string, visible: boolean) {
  tabsVisibility.value[tabId] = visible;

  if (!visible) {
    // Cancel all in-flight requests for this tab
    const tabVars = variablesData.tabs[tabId] || [];
    tabVars.forEach(variable => {
      const key = getVariableKey(variable.name, variable.scope, variable.tabId, variable.panelId);
      if (currentlyExecutingPromises.has(key)) {
        currentlyExecutingPromises.get(key)!.reject();
        currentlyExecutingPromises.delete(key);
        variable.isLoading = false;
      }
    });
  } else {
    // Start loading
    loadTabVariables(tabId);
  }
}
```

---

## Summary

This specification outlines the complete transformation of the dashboard variables system from a global-only to a multi-scoped architecture. Key takeaways:

### Architecture Changes
- **Centralized Management**: New `useVariablesManager()` composable controls all variable state
- **Multi-Instance Components**: `VariablesValueSelector` transitions from single to multiple instances
- **Lazy Loading**: Variables load only when their scope becomes visible

### Data Model Changes
- **Scoped Variables**: Each variable has explicit `scope` and optional `tabs`/`panels`
- **Expanded State**: Variables with multiple assignments create separate instances internally
- **Scoped Keys**: Unique identification using `name@scope@tabId` or `name@scope@panelId` format

### Behavior Changes
- **Independent Values**: Same variable name can have different values in different tabs/panels
- **Lazy Loading**: Tab variables load on tab activation, panel variables on viewport entry
- **Null Handling**: Empty results cascade down dependency tree, use `_o2_all_` sentinel in queries

### URL Changes
- **Scoped Format**: `var-name.t.tabId` and `var-name.p.panelId` for tab/panel variables
- **Drilldown Compatibility**: Unscoped URLs apply to all instances of variable name

### Implementation Strategy
- **8-Week Phased Rollout**: Foundation → URL/Visibility → Components → UI → Migration → Performance
- **Backward Compatible**: Existing dashboards auto-migrate to global scope
- **Gradual Adoption**: Users can adopt scoped variables incrementally

This design maintains backward compatibility while enabling powerful new capabilities for variable management across complex dashboard layouts.

---

## Testing Strategy

### Overview

**CRITICAL REQUIREMENT**: After completing the implementation of scoped variables, comprehensive Playwright end-to-end tests MUST be run to verify all scenarios, dependencies, and interactions across all variable levels (global, tab, panel).

### Why Playwright Tests Are Essential

1. **Multi-Scope Interactions**: Validates that global, tab, and panel variables work together correctly
2. **Dependency Chains**: Ensures cascading dependencies load in correct order across scopes
3. **Lazy Loading**: Verifies variables only load when their scope becomes visible
4. **URL Synchronization**: Tests that variable state properly persists in URLs
5. **Edge Cases**: Validates behavior in complex scenarios (null values, rapid switching, etc.)
6. **Regression Prevention**: Catches breaking changes in existing global-only behavior

### Test Implementation Location

**Directory**: `tests/ui-testing/playwright-tests/dashboards/`

**Test Files**:
- `dashboard-variables-global.spec.ts` - Global variable tests
- `dashboard-variables-tab-scoped.spec.ts` - Tab-scoped variable tests
- `dashboard-variables-panel-scoped.spec.ts` - Panel-scoped variable tests
- `dashboard-variables-dependencies.spec.ts` - Cross-scope dependency tests
- `dashboard-variables-url-sync.spec.ts` - URL synchronization tests
- `dashboard-variables-edge-cases.spec.ts` - Edge case and error handling tests

---

### Test Suite 1: Global Variables

**File**: `dashboard-variables-global.spec.ts`

#### Test Case 1.1: Global Variable Basic Loading
```typescript
test('should load global variables on dashboard mount', async ({ page }) => {
  // Setup: Create dashboard with global variables
  await createDashboardWithGlobalVariables(page, {
    variables: [
      { name: 'country', type: 'query_values', scope: 'global' },
      { name: 'environment', type: 'custom', scope: 'global', value: ['prod', 'staging'] }
    ]
  });

  // Navigate to dashboard
  await page.goto('/dashboards/view/test-dashboard');

  // Verify: Global variables visible immediately
  await expect(page.locator('[data-test="variable-selector-country"]')).toBeVisible();
  await expect(page.locator('[data-test="variable-selector-environment"]')).toBeVisible();

  // Verify: Variables have loaded data
  await expect(page.locator('[data-test="variable-country-options"]')).not.toBeEmpty();
});
```

#### Test Case 1.2: Global Variable Selection Updates All Panels
```typescript
test('should update all panels when global variable changes', async ({ page }) => {
  // Setup: Dashboard with global variable and multiple panels
  await createDashboardWithGlobalVariables(page, {
    variables: [{ name: 'status', type: 'custom', scope: 'global', value: ['200', '404', '500'] }],
    panels: [
      { id: 'panel-1', query: 'SELECT * WHERE status=$status' },
      { id: 'panel-2', query: 'SELECT count(*) WHERE status=$status' }
    ]
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Select value in global variable
  await page.locator('[data-test="variable-selector-status"]').click();
  await page.locator('[data-test="variable-option-200"]').click();

  // Verify: Both panels updated with new filter
  await expect(page.locator('[data-test="panel-1"]')).toContainText('status=200');
  await expect(page.locator('[data-test="panel-2"]')).toContainText('status=200');
});
```

#### Test Case 1.3: Global Variable Dependencies
```typescript
test('should handle global variable dependencies correctly', async ({ page }) => {
  // Setup: Chain of global variables (country → region → city)
  await createDashboardWithGlobalVariables(page, {
    variables: [
      { name: 'country', type: 'query_values', scope: 'global' },
      { name: 'region', type: 'query_values', scope: 'global',
        dependsOn: 'country', query: 'SELECT region WHERE country=$country' },
      { name: 'city', type: 'query_values', scope: 'global',
        dependsOn: 'region', query: 'SELECT city WHERE region=$region' }
    ]
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Verify: Initial loading sequence
  await expect(page.locator('[data-test="variable-country-loading"]')).toBeVisible();
  await expect(page.locator('[data-test="variable-region-loading"]')).toBeVisible();
  await expect(page.locator('[data-test="variable-city-loading"]')).toBeVisible();

  // Wait for country to load
  await page.waitForSelector('[data-test="variable-country-loaded"]');

  // Change country
  await page.locator('[data-test="variable-selector-country"]').click();
  await page.locator('[data-test="variable-option-USA"]').click();

  // Verify: Dependent variables reload
  await expect(page.locator('[data-test="variable-region-loading"]')).toBeVisible();
  await page.waitForSelector('[data-test="variable-region-loaded"]');

  // Verify: City reloads after region
  await expect(page.locator('[data-test="variable-city-loading"]')).toBeVisible();
});
```

---

### Test Suite 2: Tab-Scoped Variables

**File**: `dashboard-variables-tab-scoped.spec.ts`

#### Test Case 2.1: Tab Variable Lazy Loading
```typescript
test('should only load tab variables when tab becomes active', async ({ page }) => {
  // Setup: Dashboard with 2 tabs, each with tab-scoped variables
  await createDashboardWithTabs(page, {
    tabs: [
      { id: 'tab-1', name: 'Logs', variables: [{ name: 'logLevel', scope: 'tab' }] },
      { id: 'tab-2', name: 'Metrics', variables: [{ name: 'metric', scope: 'tab' }] }
    ]
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Verify: Tab 1 visible by default, variables loading
  await expect(page.locator('[data-test="tab-1"]')).toHaveClass(/active/);
  await expect(page.locator('[data-test="variable-logLevel-loading"]')).toBeVisible();

  // Verify: Tab 2 variables NOT loading yet
  await expect(page.locator('[data-test="variable-metric-loading"]')).not.toBeVisible();

  // Switch to Tab 2
  await page.locator('[data-test="tab-button-tab-2"]').click();

  // Verify: Tab 2 variables now loading
  await expect(page.locator('[data-test="variable-metric-loading"]')).toBeVisible();
  await page.waitForSelector('[data-test="variable-metric-loaded"]');
});
```

#### Test Case 2.2: Tab Variable Independence
```typescript
test('should maintain independent values for same variable in different tabs', async ({ page }) => {
  // Setup: Two tabs with same variable name but independent values
  await createDashboardWithTabs(page, {
    globalVariables: [{ name: 'country', type: 'custom', scope: 'global', value: ['USA'] }],
    tabs: [
      { id: 'tab-1', variables: [{ name: 'region', scope: 'tab', type: 'custom', value: ['CA', 'OR'] }] },
      { id: 'tab-2', variables: [{ name: 'region', scope: 'tab', type: 'custom', value: ['NY', 'NJ'] }] }
    ]
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Tab 1: Select CA
  await page.locator('[data-test="variable-selector-region"]').click();
  await page.locator('[data-test="variable-option-CA"]').click();

  // Verify: Tab 1 region = CA
  await expect(page.locator('[data-test="variable-region-value"]')).toContainText('CA');

  // Switch to Tab 2
  await page.locator('[data-test="tab-button-tab-2"]').click();

  // Verify: Tab 2 region has different options (NY, NJ), NOT CA
  await page.locator('[data-test="variable-selector-region"]').click();
  await expect(page.locator('[data-test="variable-option-NY"]')).toBeVisible();
  await expect(page.locator('[data-test="variable-option-CA"]')).not.toBeVisible();

  // Select NY in Tab 2
  await page.locator('[data-test="variable-option-NY"]').click();

  // Switch back to Tab 1
  await page.locator('[data-test="tab-button-tab-1"]').click();

  // Verify: Tab 1 still has CA selected (not affected by Tab 2)
  await expect(page.locator('[data-test="variable-region-value"]')).toContainText('CA');
});
```

#### Test Case 2.3: Tab Variable Depends on Global Variable
```typescript
test('should allow tab variable to depend on global variable', async ({ page }) => {
  // Setup: Global country, tab-scoped region depending on country
  await createDashboardWithTabs(page, {
    globalVariables: [{ name: 'country', type: 'custom', scope: 'global', value: ['USA', 'Canada'] }],
    tabs: [
      {
        id: 'tab-1',
        variables: [
          { name: 'region', scope: 'tab', type: 'query_values',
            dependsOn: 'country', query: 'SELECT region WHERE country=$country'
          }
        ]
      }
    ]
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Select country
  await page.locator('[data-test="variable-selector-country"]').click();
  await page.locator('[data-test="variable-option-USA"]').click();

  // Verify: Tab variable starts loading after global variable changes
  await expect(page.locator('[data-test="variable-region-loading"]')).toBeVisible();
  await page.waitForSelector('[data-test="variable-region-loaded"]');

  // Change country again
  await page.locator('[data-test="variable-selector-country"]').click();
  await page.locator('[data-test="variable-option-Canada"]').click();

  // Verify: Tab variable reloads with new dependency value
  await expect(page.locator('[data-test="variable-region-loading"]')).toBeVisible();
  await page.waitForSelector('[data-test="variable-region-loaded"]');
});
```

---

### Test Suite 3: Panel-Scoped Variables

**File**: `dashboard-variables-panel-scoped.spec.ts`

#### Test Case 3.1: Panel Variable Lazy Loading with Intersection Observer
```typescript
test('should only load panel variables when panel enters viewport', async ({ page }) => {
  // Setup: Dashboard with panels having panel-scoped variables, some below fold
  await createDashboardWithPanels(page, {
    panels: [
      { id: 'panel-1', position: 'top', variables: [{ name: 'status', scope: 'panel' }] },
      { id: 'panel-2', position: 'middle', variables: [{ name: 'code', scope: 'panel' }] },
      { id: 'panel-3', position: 'bottom', variables: [{ name: 'error', scope: 'panel' }] }
    ]
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Verify: Panel 1 (visible) variables loading
  await expect(page.locator('[data-test="panel-1-variable-status-loading"]')).toBeVisible();

  // Verify: Panel 3 (below fold) variables NOT loading yet
  await expect(page.locator('[data-test="panel-3-variable-error-loading"]')).not.toBeVisible();

  // Scroll to Panel 3
  await page.locator('[data-test="panel-3"]').scrollIntoViewIfNeeded();

  // Verify: Panel 3 variables now loading
  await expect(page.locator('[data-test="panel-3-variable-error-loading"]')).toBeVisible();
  await page.waitForSelector('[data-test="panel-3-variable-error-loaded"]');
});
```

#### Test Case 3.2: Panel Variable Independence
```typescript
test('should maintain independent values for same variable in different panels', async ({ page }) => {
  // Setup: Two panels with same variable name but independent values
  await createDashboardWithPanels(page, {
    panels: [
      { id: 'panel-1', variables: [{ name: 'threshold', scope: 'panel', type: 'textbox', value: '100' }] },
      { id: 'panel-2', variables: [{ name: 'threshold', scope: 'panel', type: 'textbox', value: '500' }] }
    ]
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Verify: Panel 1 threshold = 100
  await expect(page.locator('[data-test="panel-1-variable-threshold-value"]')).toHaveValue('100');

  // Verify: Panel 2 threshold = 500 (different value)
  await expect(page.locator('[data-test="panel-2-variable-threshold-value"]')).toHaveValue('500');

  // Change Panel 1 threshold
  await page.locator('[data-test="panel-1-variable-threshold-input"]').fill('200');

  // Verify: Panel 2 threshold unchanged
  await expect(page.locator('[data-test="panel-2-variable-threshold-value"]')).toHaveValue('500');
});
```

#### Test Case 3.3: Panel Variable Depends on Tab Variable
```typescript
test('should allow panel variable to depend on tab variable', async ({ page }) => {
  // Setup: Tab variable → Panel variable dependency
  await createDashboardWithTabs(page, {
    tabs: [
      {
        id: 'tab-1',
        variables: [{ name: 'service', scope: 'tab', type: 'custom', value: ['api', 'web'] }],
        panels: [
          {
            id: 'panel-1',
            variables: [
              { name: 'endpoint', scope: 'panel', type: 'query_values',
                dependsOn: 'service', query: 'SELECT endpoint WHERE service=$service'
              }
            ]
          }
        ]
      }
    ]
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Select tab variable
  await page.locator('[data-test="variable-selector-service"]').click();
  await page.locator('[data-test="variable-option-api"]').click();

  // Verify: Panel variable starts loading
  await expect(page.locator('[data-test="panel-1-variable-endpoint-loading"]')).toBeVisible();
  await page.waitForSelector('[data-test="panel-1-variable-endpoint-loaded"]');

  // Change tab variable
  await page.locator('[data-test="variable-selector-service"]').click();
  await page.locator('[data-test="variable-option-web"]').click();

  // Verify: Panel variable reloads
  await expect(page.locator('[data-test="panel-1-variable-endpoint-loading"]')).toBeVisible();
});
```

---

### Test Suite 4: Cross-Scope Dependencies

**File**: `dashboard-variables-dependencies.spec.ts`

#### Test Case 4.1: Global → Tab → Panel Dependency Chain
```typescript
test('should handle three-level dependency chain correctly', async ({ page }) => {
  // Setup: Global → Tab → Panel
  await createDashboardWithTabs(page, {
    globalVariables: [
      { name: 'country', type: 'custom', scope: 'global', value: ['USA'] }
    ],
    tabs: [
      {
        id: 'tab-1',
        variables: [
          { name: 'region', scope: 'tab', type: 'query_values',
            dependsOn: 'country', query: 'SELECT region WHERE country=$country'
          }
        ],
        panels: [
          {
            id: 'panel-1',
            variables: [
              { name: 'city', scope: 'panel', type: 'query_values',
                dependsOn: 'region', query: 'SELECT city WHERE region=$region'
              }
            ]
          }
        ]
      }
    ]
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Verify: All three levels load in sequence
  await expect(page.locator('[data-test="variable-country-loading"]')).toBeVisible();
  await page.waitForSelector('[data-test="variable-country-loaded"]');

  await expect(page.locator('[data-test="variable-region-loading"]')).toBeVisible();
  await page.waitForSelector('[data-test="variable-region-loaded"]');

  await expect(page.locator('[data-test="panel-1-variable-city-loading"]')).toBeVisible();
  await page.waitForSelector('[data-test="panel-1-variable-city-loaded"]');

  // Change global variable
  await page.locator('[data-test="variable-selector-country"]').click();
  await page.locator('[data-test="variable-option-Canada"]').click();

  // Verify: Cascade reload through all levels
  await expect(page.locator('[data-test="variable-region-loading"]')).toBeVisible();
  await page.waitForSelector('[data-test="variable-region-loaded"]');

  await expect(page.locator('[data-test="panel-1-variable-city-loading"]')).toBeVisible();
  await page.waitForSelector('[data-test="panel-1-variable-city-loaded"]');
});
```

#### Test Case 4.2: Multiple Dependencies at Same Level
```typescript
test('should handle variable with multiple dependencies at same level', async ({ page }) => {
  // Setup: Variable depending on two parent variables
  await createDashboardWithGlobalVariables(page, {
    variables: [
      { name: 'startDate', type: 'textbox', scope: 'global', value: '2024-01-01' },
      { name: 'endDate', type: 'textbox', scope: 'global', value: '2024-12-31' },
      { name: 'events', type: 'query_values', scope: 'global',
        dependsOn: ['startDate', 'endDate'],
        query: 'SELECT * WHERE date >= $startDate AND date <= $endDate'
      }
    ]
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Verify: Child variable waits for both parents
  await page.waitForSelector('[data-test="variable-startDate-loaded"]');
  await page.waitForSelector('[data-test="variable-endDate-loaded"]');
  await expect(page.locator('[data-test="variable-events-loading"]')).toBeVisible();

  // Change one parent
  await page.locator('[data-test="variable-selector-startDate"]').fill('2024-06-01');

  // Verify: Child reloads
  await expect(page.locator('[data-test="variable-events-loading"]')).toBeVisible();
});
```

#### Test Case 4.3: Circular Dependency Detection
```typescript
test('should detect and prevent circular dependencies', async ({ page }) => {
  // Setup: Attempt to create circular dependency
  await page.goto('/dashboards/edit/test-dashboard');

  // Create variable A
  await addVariable(page, { name: 'varA', type: 'query_values', scope: 'global' });

  // Create variable B depending on A
  await addVariable(page, {
    name: 'varB',
    type: 'query_values',
    scope: 'global',
    dependsOn: 'varA'
  });

  // Attempt to make A depend on B (circular)
  await editVariable(page, 'varA', { dependsOn: 'varB' });

  // Verify: Error message shown
  await expect(page.locator('[data-test="error-circular-dependency"]')).toBeVisible();
  await expect(page.locator('[data-test="error-circular-dependency"]'))
    .toContainText('Circular dependency detected: varA → varB → varA');

  // Verify: Save button disabled
  await expect(page.locator('[data-test="save-dashboard"]')).toBeDisabled();
});
```

---

### Test Suite 5: URL Synchronization

**File**: `dashboard-variables-url-sync.spec.ts`

#### Test Case 5.1: Global Variable in URL
```typescript
test('should sync global variable changes to URL', async ({ page }) => {
  await createDashboardWithGlobalVariables(page, {
    variables: [{ name: 'status', type: 'custom', scope: 'global', value: ['200', '404', '500'] }]
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Select variable value
  await page.locator('[data-test="variable-selector-status"]').click();
  await page.locator('[data-test="variable-option-200"]').click();

  // Verify: URL updated
  await expect(page).toHaveURL(/var-status=200/);

  // Select multiple values
  await page.locator('[data-test="variable-selector-status"]').click();
  await page.locator('[data-test="variable-option-404"]').click();

  // Verify: URL shows comma-separated values
  await expect(page).toHaveURL(/var-status=200,404/);
});
```

#### Test Case 5.2: Tab-Scoped Variable in URL
```typescript
test('should sync tab-scoped variable with correct URL format', async ({ page }) => {
  await createDashboardWithTabs(page, {
    tabs: [
      { id: 'tab-1', variables: [{ name: 'region', scope: 'tab', type: 'custom', value: ['CA', 'OR'] }] },
      { id: 'tab-2', variables: [{ name: 'region', scope: 'tab', type: 'custom', value: ['NY', 'NJ'] }] }
    ]
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Tab 1: Select CA
  await page.locator('[data-test="variable-selector-region"]').click();
  await page.locator('[data-test="variable-option-CA"]').click();

  // Verify: URL has tab-scoped format
  await expect(page).toHaveURL(/var-region\.t\.tab-1=CA/);

  // Switch to Tab 2
  await page.locator('[data-test="tab-button-tab-2"]').click();

  // Tab 2: Select NY
  await page.locator('[data-test="variable-selector-region"]').click();
  await page.locator('[data-test="variable-option-NY"]').click();

  // Verify: URL has both tab scopes
  await expect(page).toHaveURL(/var-region\.t\.tab-1=CA/);
  await expect(page).toHaveURL(/var-region\.t\.tab-2=NY/);
});
```

#### Test Case 5.3: Panel-Scoped Variable in URL
```typescript
test('should sync panel-scoped variable with correct URL format', async ({ page }) => {
  await createDashboardWithPanels(page, {
    panels: [
      { id: 'panel-123', variables: [{ name: 'threshold', scope: 'panel', type: 'textbox', value: '100' }] }
    ]
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Change panel variable
  await page.locator('[data-test="panel-123-variable-threshold-input"]').fill('250');
  await page.keyboard.press('Enter');

  // Verify: URL has panel-scoped format
  await expect(page).toHaveURL(/var-threshold\.p\.panel-123=250/);
});
```

#### Test Case 5.4: Load Variables from URL
```typescript
test('should restore variable state from URL on page load', async ({ page }) => {
  await createDashboardWithGlobalVariables(page, {
    variables: [
      { name: 'country', type: 'custom', scope: 'global', value: ['USA', 'Canada'] },
      { name: 'status', type: 'custom', scope: 'global', value: ['200', '404', '500'] }
    ]
  });

  // Navigate with pre-set URL parameters
  await page.goto('/dashboards/view/test-dashboard?var-country=Canada&var-status=404,500');

  // Verify: Variables restored from URL
  await expect(page.locator('[data-test="variable-country-value"]')).toContainText('Canada');
  await expect(page.locator('[data-test="variable-status-value"]')).toContainText('404, 500');
});
```

#### Test Case 5.5: Drilldown URL Compatibility
```typescript
test('should apply unscoped drilldown URL to all variable instances', async ({ page }) => {
  await createDashboardWithTabs(page, {
    globalVariables: [{ name: 'status', type: 'custom', scope: 'global', value: ['200', '404'] }],
    tabs: [
      { id: 'tab-1', variables: [{ name: 'status', scope: 'tab', type: 'custom', value: ['200', '404'] }] },
      { id: 'tab-2', variables: [{ name: 'status', scope: 'tab', type: 'custom', value: ['200', '404'] }] }
    ]
  });

  // Navigate with drilldown URL (no scope specified)
  await page.goto('/dashboards/view/test-dashboard?var-status=404');

  // Verify: Global variable set to 404
  await expect(page.locator('[data-test="variable-status-value"]')).toContainText('404');

  // Switch to Tab 1
  await page.locator('[data-test="tab-button-tab-1"]').click();

  // Verify: Tab 1 variable also set to 404
  await expect(page.locator('[data-test="tab-1-variable-status-value"]')).toContainText('404');

  // Switch to Tab 2
  await page.locator('[data-test="tab-button-tab-2"]').click();

  // Verify: Tab 2 variable also set to 404
  await expect(page.locator('[data-test="tab-2-variable-status-value"]')).toContainText('404');
});
```

---

### Test Suite 6: Edge Cases and Error Handling

**File**: `dashboard-variables-edge-cases.spec.ts`

#### Test Case 6.1: Variable with No Data (Null Case)
```typescript
test('should handle variable with no query results', async ({ page }) => {
  await createDashboardWithGlobalVariables(page, {
    variables: [
      { name: 'nonexistent', type: 'query_values', scope: 'global',
        query: 'SELECT field FROM nonexistent_table'
      }
    ],
    panels: [
      { id: 'panel-1', query: 'SELECT * WHERE field=$nonexistent' }
    ]
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Verify: Variable shows empty state
  await page.waitForSelector('[data-test="variable-nonexistent-loaded"]');
  await expect(page.locator('[data-test="variable-nonexistent-empty"]')).toBeVisible();

  // Verify: Panel query uses sentinel value
  const panelQuery = await page.locator('[data-test="panel-1-query"]').textContent();
  expect(panelQuery).toContain('field=_o2_all_');
});
```

#### Test Case 6.2: Rapid Tab Switching
```typescript
test('should handle rapid tab switching without errors', async ({ page }) => {
  await createDashboardWithTabs(page, {
    tabs: [
      { id: 'tab-1', variables: [{ name: 'var1', scope: 'tab', type: 'query_values' }] },
      { id: 'tab-2', variables: [{ name: 'var2', scope: 'tab', type: 'query_values' }] },
      { id: 'tab-3', variables: [{ name: 'var3', scope: 'tab', type: 'query_values' }] }
    ]
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Rapidly switch tabs
  for (let i = 0; i < 10; i++) {
    await page.locator('[data-test="tab-button-tab-2"]').click();
    await page.locator('[data-test="tab-button-tab-3"]').click();
    await page.locator('[data-test="tab-button-tab-1"]').click();
  }

  // Verify: No errors, variables in correct state
  await expect(page.locator('[data-test="error-message"]')).not.toBeVisible();
  await expect(page.locator('[data-test="tab-1-variable-var1"]')).toBeVisible();
});
```

#### Test Case 6.3: Panel Scrolling Performance
```typescript
test('should efficiently load panel variables during scrolling', async ({ page }) => {
  // Setup: Many panels with variables
  await createDashboardWithPanels(page, {
    panels: Array.from({ length: 20 }, (_, i) => ({
      id: `panel-${i}`,
      variables: [{ name: `var${i}`, scope: 'panel', type: 'query_values' }]
    }))
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Track network requests
  let loadCount = 0;
  page.on('request', (request) => {
    if (request.url().includes('field_values')) loadCount++;
  });

  // Scroll through entire page
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

  // Wait for loading to stabilize
  await page.waitForTimeout(2000);

  // Verify: Reasonable number of requests (should use lazy loading)
  expect(loadCount).toBeLessThan(25); // Not all 20 at once
});
```

#### Test Case 6.4: Variable Depends on Hidden Tab
```typescript
test('should auto-load dependencies from hidden tabs', async ({ page }) => {
  await createDashboardWithTabs(page, {
    tabs: [
      {
        id: 'tab-1',
        variables: [{ name: 'service', scope: 'tab', type: 'custom', value: ['api'] }]
      },
      {
        id: 'tab-2',
        panels: [
          {
            id: 'panel-1',
            variables: [
              { name: 'endpoint', scope: 'panel', type: 'query_values',
                dependsOn: 'service', query: 'SELECT endpoint WHERE service=$service'
              }
            ]
          }
        ]
      }
    ]
  });

  await page.goto('/dashboards/view/test-dashboard');

  // Navigate directly to Tab 2 (Tab 1 never activated)
  await page.locator('[data-test="tab-button-tab-2"]').click();

  // Verify: Panel variable still loads (parent from Tab 1 auto-loaded)
  await expect(page.locator('[data-test="panel-1-variable-endpoint-loading"]')).toBeVisible();
  await page.waitForSelector('[data-test="panel-1-variable-endpoint-loaded"]');
});
```

#### Test Case 6.5: Backward Compatibility with Legacy Dashboards
```typescript
test('should auto-migrate legacy dashboards without explicit scope', async ({ page }) => {
  // Setup: Dashboard with old format (no scope field)
  await createLegacyDashboard(page, {
    variables: [
      { name: 'country', type: 'query_values' }, // No scope specified
      { name: 'status', type: 'custom', value: ['200', '404'] } // No scope specified
    ]
  });

  await page.goto('/dashboards/view/legacy-dashboard');

  // Verify: Variables migrated to global scope
  await expect(page.locator('[data-test="variable-selector-country"]')).toBeVisible();
  await expect(page.locator('[data-test="variable-selector-status"]')).toBeVisible();

  // Verify: Variables work as global (visible everywhere)
  await page.locator('[data-test="variable-selector-status"]').click();
  await page.locator('[data-test="variable-option-200"]').click();

  // Verify: URL uses global format
  await expect(page).toHaveURL(/var-status=200/);
});
```

---

### Test Execution Strategy

#### 1. Pre-Implementation Testing
- Create test cases BEFORE implementation
- Use tests as specification validation
- Tests will fail initially (expected)

#### 2. During Implementation
- Run relevant test suite after each feature completion
- Use test failures to identify integration issues
- Fix issues immediately before moving to next feature

#### 3. Post-Implementation Validation
- **CRITICAL**: Run COMPLETE test suite after implementation
- All tests MUST pass before considering implementation complete
- Address any failures with high priority

#### 4. Continuous Testing
- Include tests in CI/CD pipeline
- Run on every commit to prevent regressions
- Monitor test performance and stability

---

### Test Execution Commands

```bash
# Run all dashboard variable tests
npx playwright test tests/ui-testing/playwright-tests/dashboards/

# Run specific test suite
npx playwright test dashboard-variables-global.spec.ts

# Run with UI mode for debugging
npx playwright test --ui

# Run specific test case
npx playwright test -g "should load global variables on dashboard mount"

# Run tests in parallel
npx playwright test --workers=4

# Generate test report
npx playwright test --reporter=html
```

---

### Success Criteria

Implementation is complete ONLY when:

1. ✅ All global variable tests pass (6+ test cases)
2. ✅ All tab-scoped variable tests pass (6+ test cases)
3. ✅ All panel-scoped variable tests pass (6+ test cases)
4. ✅ All cross-scope dependency tests pass (6+ test cases)
5. ✅ All URL synchronization tests pass (10+ test cases)
6. ✅ All edge case tests pass (10+ test cases)
7. ✅ No console errors during test execution
8. ✅ All tests pass consistently (3 consecutive runs)
9. ✅ Test execution time is reasonable (<5 minutes for full suite)
10. ✅ All network requests are efficient (no unnecessary duplicate requests)

**TOTAL**: Minimum 44+ test cases covering all scenarios

---

### Maintenance and Updates

After initial implementation:

1. **Add tests for new features**: Any new variable-related feature requires corresponding Playwright tests
2. **Update tests for bug fixes**: Bug fixes should include regression tests
3. **Monitor test stability**: Address flaky tests immediately
4. **Review test coverage**: Periodically review and expand test coverage
5. **Performance benchmarks**: Track test execution time and optimize as needed

---

**End of Specification**

