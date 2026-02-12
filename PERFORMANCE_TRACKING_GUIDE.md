# Logs Page Performance Tracking Guide

## 🔍 What Was Added

Performance tracking code has been added to **all 4 major components** to help you determine if the green paint flashing is due to actual component re-renders or just CSS repainting:

1. **Index.vue** (Parent/Container) - `/web/src/plugins/logs/Index.vue`
2. **SearchBar.vue** (Top Bar) - `/web/src/plugins/logs/SearchBar.vue`
3. **IndexList.vue** (Left Sidebar/Fields) - `/web/src/plugins/logs/IndexList.vue`
4. **SearchResult.vue** (Main Content) - `/web/src/plugins/logs/SearchResult.vue`

## 📊 How to Use

### 1. Check for Component Re-renders (Console)

**Open your browser console and hover over the SearchResult container:**

```javascript
// ===== QUICK CHECK ALL COMPONENTS =====
console.table([
  { component: 'Index (Parent)', renders: window.__LOGSINDEX_PERF__?.renders.length || 0 },
  { component: 'SearchBar (Top)', renders: window.__SEARCHBAR_PERF__?.renders.length || 0 },
  { component: 'IndexList (Sidebar)', renders: window.__INDEXLIST_PERF__?.renders.length || 0 },
  { component: 'SearchResult (Main)', renders: window.__SEARCHRESULT_PERF__?.renders.length || 0 }
])

// ===== 🔍 NEW: ANALYZE WHAT'S CAUSING RE-RENDERS =====
// This shows which reactive properties are triggering re-renders
window.__SEARCHRESULT_PERF__?.analyzeTriggers()

// See all triggers (raw data)
window.__SEARCHRESULT_PERF__?.triggers


// ===== DETAILED INSPECTION =====

// Check Index (Parent/Container)
window.__LOGSINDEX_PERF__?.renders.filter(r => r.timeSinceLastRender < 100)

// Check SearchBar (Top Bar)
window.__SEARCHBAR_PERF__?.renders.filter(r => r.timeSinceLastRender < 100)

// Check IndexList (Left Sidebar/Fields)
window.__INDEXLIST_PERF__?.renders.filter(r => r.timeSinceLastRender < 100)

// Check SearchResult (Main Content)
window.__SEARCHRESULT_PERF__?.renders.filter(r => r.timeSinceLastRender < 100)

// ===== VIEW LAST 5 RENDERS FROM EACH =====
console.log('Index:', window.__LOGSINDEX_PERF__?.renders.slice(-5))
console.log('SearchBar:', window.__SEARCHBAR_PERF__?.renders.slice(-5))
console.log('IndexList:', window.__INDEXLIST_PERF__?.renders.slice(-5))
console.log('SearchResult:', window.__SEARCHRESULT_PERF__?.renders.slice(-5))
```

### 2. Chrome DevTools Performance Tab

1. Open Chrome DevTools → **Performance** tab
2. Click **Record** (⚫)
3. Hover over the SearchResult area
4. Stop recording
5. Look for performance marks:
   - `logs-index-render-*` (parent/container)
   - `searchbar-render-*` (top search bar)
   - `indexlist-render-*` (left sidebar/fields)
   - `searchresult-render-*` (main content area)
6. If you see many marks appearing on hover, those components are re-rendering

### 3. Analyze What's Causing Re-renders (NEW!)

**SearchResult component now tracks WHAT triggers each re-render:**

```javascript
// Run this after you see re-renders happening
window.__SEARCHRESULT_PERF__.analyzeTriggers()

// Example output:
// 📊 SearchResult Re-render Trigger Analysis
// ┌─────────┬────────────────────────────┬───────┐
// │ (index) │ trigger                    │ count │
// ├─────────┼────────────────────────────┼───────┤
// │    0    │ 'currentPage (set)'        │   8   │
// │    1    │ 'showDetailTab (set)'      │   3   │
// │    2    │ 'queryResults (set)'       │   1   │
// └─────────┴────────────────────────────┴───────┘

// This tells you:
// - Which reactive properties are changing
// - How many times each property triggered a re-render
// - The type of change (set, add, delete)
```

### 4. Vue DevTools

1. Install [Vue DevTools](https://devtools.vuejs.org/)
2. Open DevTools → **Vue** tab → **Performance**
3. Click **Start Recording**
4. Hover over the SearchResult area
5. Stop recording
6. Check if Index.vue or SearchResult.vue show up in the flame chart

## 🎯 What to Look For

### ✅ **GOOD** - CSS Repaint Only (Expected)
- No console logs during hover (except initial page load)
- No entries in `window.__SEARCHRESULT_PERF__.renders` during hover
- Chrome paint flashing shows green (just CSS repainting)
- **This is normal and performant!**

### ⚠️ **BAD** - Component Re-rendering on Hover (Performance Issue)
- **Console logs appearing** when you hover
- Multiple colored logs = multiple components re-rendering
- Look for the **purple "Re-render Triggered"** logs - these show WHAT changed
- `timeSinceLastRender` values < 100ms
- **This indicates a Vue reactivity issue**

### 🔍 **INTERPRETING THE CONSOLE OUTPUT**

**You'll see two types of logs:**

1. **🔄 Red "Re-render" logs** - Shows WHEN component re-rendered
   ```
   🔄 SearchResult Re-render #12 ⏱️ 16ms 📍 Caused by: currentPage (set)
   ```
   - The number (#12) = total re-renders
   - The time (16ms) = milliseconds since last re-render
   - "Caused by" = what reactive property changed

2. **💡 Purple "Triggered" logs** - Shows WHAT caused the re-render
   ```
   💡 SearchResult Re-render Triggered
   {
     type: 'set',
     key: 'currentPage',
     newValue: 2,
     oldValue: 1
   }
   ```
   - `key` = the exact property that changed
   - `type` = what happened (set/add/delete)
   - Shows old and new values

### 📈 Understanding the Component Hierarchy

**Re-render cascade (parent to children):**
```
Index.vue (Parent/Container)
    ↓
    ├─→ SearchBar.vue (Top Bar - Child of Index)
    ├─→ IndexList.vue (Left Sidebar - Child of Index)
    └─→ SearchResult.vue (Main Content - Child of Index)
```

**Key insights:**
- If **Index** re-renders → All 3 children will re-render (cascade)
- If only **SearchBar** re-renders → Issue isolated to SearchBar
- If only **IndexList** re-renders → Issue isolated to IndexList (likely field hover/interaction)
- If only **SearchResult** re-renders → Issue isolated to SearchResult

## 🔧 Common Causes of Unnecessary Re-renders

### 🎯 How to Fix Based on Trigger Analysis

**After running `window.__SEARCHRESULT_PERF__.analyzeTriggers()`, you'll see which properties are causing re-renders:**

#### Example 1: `currentPage (set)` triggering re-renders
```javascript
// Problem: Pagination updates on hover
// Solution: Check if currentPage is being set unnecessarily
// Look for: Mouse event handlers that update pagination
```

#### Example 2: `showDetailTab (set)` triggering re-renders
```javascript
// Problem: Detail sidebar state changing
// Solution: Ensure this only changes on user clicks, not hover
// Check for: Hover handlers opening/closing the detail panel
```

#### Example 3: `queryResults (set)` triggering re-renders
```javascript
// Problem: Query data being mutated
// Solution: Check if data is being modified reactively
// Look for: Array/object mutations happening on hover
```

#### Example 4: `scrollPosition (set)` triggering re-renders
```javascript
// Problem: Scroll events triggering reactive updates
// Solution: Debounce scroll handlers or use non-reactive refs
// Consider: Moving scroll tracking outside Vue's reactivity system
```

### General Solutions:

1. **Use `markRaw()`** for non-reactive data
2. **Debounce** event handlers (scroll, mousemove)
3. **Use `shallowRef()`** instead of `ref()` for large objects
4. **Move mouse tracking** outside reactive state
5. **Check computed properties** - ensure they're not recalculating on hover

### In Index.vue (Parent):
1. **Reactive state changes on hover**
   - Check if any searchObj properties mutate on hover
   - Check if splitterModel or other reactive refs change

2. **Event handlers updating reactive data**
   - Look for @mouseover/@mouseenter handlers in Index.vue template

3. **Computed properties recalculating**
   - Check computed properties that might be triggered by mouse position

## 🧪 Testing Workflow

### Step 1: Clear tracking data
```javascript
// Reset all tracking objects
window.__LOGSINDEX_PERF__ = { renders: [] }
window.__SEARCHBAR_PERF__ = { renders: [] }
window.__INDEXLIST_PERF__ = { renders: [] }
window.__SEARCHRESULT_PERF__ = { renders: [] }
```

### Step 2: Perform hover test
1. Hover over the SearchResult area
2. Hold hover for 2-3 seconds
3. Move mouse around the area

### Step 3: Check results
```javascript
// Quick check - Show table of all components
console.table([
  { component: 'Index', renders: window.__LOGSINDEX_PERF__?.renders.length || 0 },
  { component: 'SearchBar', renders: window.__SEARCHBAR_PERF__?.renders.length || 0 },
  { component: 'IndexList', renders: window.__INDEXLIST_PERF__?.renders.length || 0 },
  { component: 'SearchResult', renders: window.__SEARCHRESULT_PERF__?.renders.length || 0 }
])

// Detailed analysis - Check each component
if (window.__LOGSINDEX_PERF__?.renders.length > 0) {
  console.log('❌ Index (Parent) is re-rendering on hover!')
  console.log('Last 5 renders:', window.__LOGSINDEX_PERF__.renders.slice(-5))
}

if (window.__SEARCHBAR_PERF__?.renders.length > 0) {
  console.log('❌ SearchBar is re-rendering on hover!')
  console.log('Last 5 renders:', window.__SEARCHBAR_PERF__.renders.slice(-5))
}

if (window.__INDEXLIST_PERF__?.renders.length > 0) {
  console.log('⚠️ IndexList is re-rendering on hover!')
  console.log('Last 5 renders:', window.__INDEXLIST_PERF__.renders.slice(-5))
  console.log('👉 This might be expected if hovering over fields in the sidebar')
}

if (window.__SEARCHRESULT_PERF__?.renders.length > 0) {
  console.log('❌ SearchResult is re-rendering on hover!')
  console.log('Last 5 renders:', window.__SEARCHRESULT_PERF__.renders.slice(-5))
}
```

## 🧹 Cleanup

Once you've finished testing, remove the performance tracking code from all 4 components:

### In Index.vue:
1. Remove `indexRenderCount` and `indexLastRenderTime` refs
2. Remove the `onUpdated` hook
3. Remove `onUpdated` from Vue imports (line 396)

### In SearchBar.vue:
1. Remove `searchBarRenderCount` and `searchBarLastRenderTime` refs
2. Remove the `onUpdated` hook
3. Remove `onUpdated` from Vue imports (line 1657)

### In IndexList.vue:
1. Remove `indexListRenderCount` and `indexListLastRenderTime` refs
2. Remove the `onUpdated` hook
3. Remove `onUpdated` from Vue imports (line 150)

### In SearchResult.vue:
1. Remove `renderCount` and `lastRenderTime` refs
2. Remove the tracking code from `onUpdated` hook

### Finally:
- Delete this guide file: `PERFORMANCE_TRACKING_GUIDE.md`

## 📝 Example Outputs

### ✅ Good (No re-renders on hover)
```javascript
> console.table([...])
┌─────────┬──────────────────────────┬─────────┐
│ (index) │       component          │ renders │
├─────────┼──────────────────────────┼─────────┤
│    0    │ 'Index (Parent)'         │    0    │
│    1    │ 'SearchBar (Top)'        │    0    │
│    2    │ 'IndexList (Sidebar)'    │    0    │
│    3    │ 'SearchResult (Main)'    │    0    │
└─────────┴──────────────────────────┴─────────┘
// Perfect! Just CSS repainting, no Vue re-renders
```

### ⚠️ Bad (Parent cascading to all children)
```javascript
> console.table([...])
┌─────────┬──────────────────────────┬─────────┐
│ (index) │       component          │ renders │
├─────────┼──────────────────────────┼─────────┤
│    0    │ 'Index (Parent)'         │   15    │ ❌
│    1    │ 'SearchBar (Top)'        │   15    │ ❌
│    2    │ 'IndexList (Sidebar)'    │   15    │ ❌
│    3    │ 'SearchResult (Main)'    │   15    │ ❌
└─────────┴──────────────────────────┴─────────┘
// All components re-rendering = Parent (Index) has reactivity issue!
// Fix the parent and all children will stop re-rendering
```

### ⚠️ Bad (Only SearchResult re-rendering)
```javascript
> console.table([...])
┌─────────┬──────────────────────────┬─────────┐
│ (index) │       component          │ renders │
├─────────┼──────────────────────────┼─────────┤
│    0    │ 'Index (Parent)'         │    0    │ ✅
│    1    │ 'SearchBar (Top)'        │    0    │ ✅
│    2    │ 'IndexList (Sidebar)'    │    0    │ ✅
│    3    │ 'SearchResult (Main)'    │   12    │ ❌
└─────────┴──────────────────────────┴─────────┘
// Only SearchResult re-rendering = Issue isolated to SearchResult component
// Check for reactive props or local state changing on hover
```

### 📊 Maybe Expected (IndexList re-rendering on field hover)
```javascript
> console.table([...])
┌─────────┬──────────────────────────┬─────────┐
│ (index) │       component          │ renders │
├─────────┼──────────────────────────┼─────────┤
│    0    │ 'Index (Parent)'         │    0    │ ✅
│    1    │ 'SearchBar (Top)'        │    0    │ ✅
│    2    │ 'IndexList (Sidebar)'    │    8    │ ⚠️
│    3    │ 'SearchResult (Main)'    │    0    │ ✅
└─────────┴──────────────────────────┴─────────┘
// IndexList re-rendering might be expected if hovering over fields
// Check if this is intentional (e.g., showing field stats on hover)
```

## 🚀 Next Steps After Testing

Based on your findings:

1. **If no re-renders detected**: The green flash is just normal CSS repainting. No action needed! ✅

2. **If Index.vue is re-rendering**: Investigate Index.vue for reactive state changes on hover

3. **If only SearchResult.vue is re-rendering**: Investigate SearchResult.vue for local reactive issues

4. **Need help fixing the issue**: Share the console output and I can help identify the root cause
