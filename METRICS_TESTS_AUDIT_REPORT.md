# Sentinel Audit Report: Metrics Test Suite
**Date**: 2026-01-14
**Files Audited**: 8 metrics spec files (3,895 lines total)
**Verdict**: ❌ **CRITICAL ISSUES FOUND - MUST BE FIXED**

---

## Executive Summary

| Category | Critical | Warnings | Total Issues |
|----------|----------|----------|--------------|
| **POM Compliance Violations** | 184+ | 0 | 184+ |
| **Soft Assertions** | Unknown | 0 | TBD |
| **Missing Dependencies** | TBD | 0 | TBD |
| **Test Consolidation** | 0 | ~40 tests | ~40 tests |
| **cleanup.spec.js** | 0 | TBD | TBD |
| **TOTAL** | **184+** | **40+** | **224+** |

---

## 🔴 CRITICAL ISSUE #1: POM Compliance Violations (184+ instances)

### Problem
Raw `page.locator()`, `page.getByRole()`, and `page.getByText()` calls found in spec files. These MUST be in page objects.

### Violations by File

| File | Raw Locators | Severity |
|------|-------------|----------|
| **metrics-advanced.spec.js** | 13 | CRITICAL |
| **metrics-aggregations.spec.js** | 8 | CRITICAL |
| **metrics-chart-types-promql.spec.js** | 0 | ✅ PASS |
| **metrics-config-tabs.spec.js** | 33 | CRITICAL |
| **metrics-config.spec.js** | 28 | CRITICAL |
| **metrics-queries.spec.js** | 28 | CRITICAL |
| **metrics-visualizations.spec.js** | 44 | CRITICAL |
| **metrics.spec.js** | 30 | CRITICAL |

### Example Violations

#### metrics-advanced.spec.js (lines 13-58)
```javascript
// ❌ VIOLATION - Raw locators in helper function
async function verifyDataOnUI(page, testName) {
  const canvas = page.locator('canvas');  // VIOLATION
  const svg = page.locator('svg').filter({ has: page.locator('path, rect, circle, line') });  // VIOLATION
  const tableRows = page.locator('table tbody tr, .data-table tr, [role="row"]');  // VIOLATION
  const resultPanels = page.locator('.result-panel, .chart-panel, .metric-card, [class*="result"], [class*="chart"]');  // VIOLATION
  const dataValues = page.locator('[class*="value"]:not(:empty), td:not(:empty)').first();  // VIOLATION
}
```

#### metrics-config-tabs.spec.js (lines 33-449)
```javascript
// ❌ VIOLATION - Raw locators throughout test
const collapseButton = page.locator('[data-test="dashboard-sidebar-collapse-btn"]').first();
const configButton = page.locator('[data-test="dashboard-sidebar"]').first();
const sidebar = page.locator('.dashboard-sidebar, .config-sidebar, [class*="sidebar"]').first();
const tabs = page.locator('.q-tab, [role="tab"], .sidebar-tab').locator('visible');
```

### Required Fix Strategy

**Option 1: Move all locators to MetricsPage class**
```javascript
// In metricsPage.js - Add these locators
class MetricsPage {
  // Visualization locators
  canvasElement = 'canvas';
  svgElement = 'svg';
  tableRows = 'table tbody tr, .data-table tr, [role="row"]';
  resultPanels = '.result-panel, .chart-panel, .metric-card, [class*="result"], [class*="chart"]';
  dataValues = '[class*="value"]:not(:empty), td:not(:empty)';

  // Config sidebar locators
  dashboardSidebarCollapseBtn = '[data-test="dashboard-sidebar-collapse-btn"]';
  dashboardSidebar = '[data-test="dashboard-sidebar"]';
  configSidebar = '.dashboard-sidebar, .config-sidebar, [class*="sidebar"]';
  sidebarTabs = '.q-tab, [role="tab"], .sidebar-tab';

  // Methods for verification
  async verifyDataVisualization(testName) {
    const canvas = this.page.locator(this.canvasElement);
    const canvasCount = await canvas.count();
    // ... rest of logic
  }

  async isCanvasVisible() {
    return await this.page.locator(this.canvasElement).count() > 0;
  }

  async getSvgCount() {
    return await this.page.locator(this.svgElement).count();
  }
}
```

**Option 2: Create utility methods in PageManager**
Move `verifyDataOnUI` to metricsPage.js as a class method.

---

## 🔴 CRITICAL ISSUE #2: Soft Assertions (expect.soft)

### Problem
User reported soft assertions throughout the codebase that allow tests to pass even when assertions fail.

### Action Required
1. Search all metrics spec files for `expect.soft(`
2. Replace with regular `expect(`
3. Verify test behavior

### Command to find soft assertions:
```bash
grep -rn "expect\.soft" tests/ui-testing/playwright-tests/Metrics/
```

### Fix Pattern:
```javascript
// ❌ BEFORE (Soft assertion - test continues if fails)
await expect.soft(element).toBeVisible();

// ✅ AFTER (Hard assertion - test fails immediately)
await expect(element).toBeVisible();
```

---

## ⚠️  ISSUE #3: Test Consolidation Needed

### Problem
Too many small tests increase maintenance burden and TestDino billing costs.

### Current Test Count by File

| File | Test Count | Recommendation |
|------|-----------|----------------|
| metrics-advanced.spec.js | ~8 tests | Consolidate into 3-4 tests |
| metrics-aggregations.spec.js | ~8 tests | Consolidate into 3-4 tests |
| metrics-chart-types-promql.spec.js | 9 tests | ✅ OK (feature-specific) |
| metrics-config-tabs.spec.js | ~10 tests | Consolidate into 4-5 tests |
| metrics-config.spec.js | ~9 tests | Consolidate into 4-5 tests |
| metrics-queries.spec.js | ~9 tests | Consolidate into 4-5 tests |
| metrics-visualizations.spec.js | ~11 tests | Consolidate into 5-6 tests |
| metrics.spec.js | ~14 tests | Consolidate into 6-8 tests |

### Consolidation Strategy

#### Example: metrics-aggregations.spec.js
**Current** (8 separate tests):
1. P1: Average aggregation test
2. P1: Sum aggregation test
3. P1: Count aggregation test
4. P1: Min aggregation test
5. P1: Max aggregation test
6. P1: Rate aggregation test
7. P1: Multi-metric aggregation test
8. P2: Aggregation with filters

**Proposed** (3 consolidated tests):
1. **P0: Basic aggregations suite** (avg, sum, count, min, max in one test)
2. **P1: Advanced aggregations** (rate, multi-metric)
3. **P2: Aggregations with filters**

Benefits:
- Reduces test execution time
- Shares setup/teardown overhead
- Easier maintenance
- Lower TestDino billing

---

## ⚠️  ISSUE #4: Missing Dependencies (PR Splitting Issue)

### Problem
User reports missing dependencies due to PR splitting strategy.

### Current PR Structure
- **PR #1**: Infrastructure (metricsPage.js, utils)
- **PR #2**: Core tests (depends on PR #1)
- **PR #3**: Chart types (depends on PR #1)

### Issues
1. PR #2 and PR #3 both modify `metricsPage.js`
2. Tests may fail if PRs aren't merged in order
3. Dependency constraints make parallel review difficult

### Recommended Solution

**Option A: Merge all PRs into one**
- Single large PR with all changes
- No dependency issues
- Longer review time

**Option B: Keep split but ensure no file conflicts**
- PR #1: Infrastructure (current metricsPage.js version)
- PR #2: Core tests (no metricsPage.js changes)
- PR #3: Chart types (add chart methods as SEPARATE commit)

**Option C: Duplicate files across PRs**
- Each PR has its own complete metricsPage.js
- No dependencies between PRs
- Requires conflict resolution during merge

**User Decision Required**: Which approach do you prefer?

---

## ⚠️  ISSUE #5: cleanup.spec.js Review

### Current Status
- **POM Violations**: 0 (✅ PASS)
- **Console.log**: 0 (✅ PASS)

### Areas to Review
1. **Test data folder approach**: Are cleanup patterns using test data folder?
2. **Metrics cleanup**: Is the metrics cleanup pattern correct?
3. **Pattern coverage**: Do all test patterns have cleanup?

### Action Required
Review cleanup.spec.js for:
- Use of test-data folder patterns
- Completeness of cleanup patterns
- Any hardcoded values that should be in test-data

---

## 📊 Detailed Violation Breakdown

### metrics-advanced.spec.js
```
Line 13:  const canvas = page.locator('canvas');
Line 22:  const svg = page.locator('svg').filter({ has: page.locator('path, rect, circle, line') });
Line 31:  const tableRows = page.locator('table tbody tr, .data-table tr, [role="row"]');
Line 40:  const resultPanels = page.locator('.result-panel, .chart-panel, .metric-card, [class*="result"], [class*="chart"]');
Line 58:  const dataValues = page.locator('[class*="value"]:not(:empty), td:not(:empty)').first();
Line 108: const streamSelector = page.locator(pm.metricsPage.selectStream);
Line 116: const streamOption = page.locator('.q-item, [role="option"]').first();
Line 160: const rangeOption = page.locator(`.q-item:has-text("${range}"), button:has-text("${range}")`).first();
Line 167: const relativeOption = page.locator('button').filter({ hasText: range }).first();
Line 238: const errorNotification = page.locator('.q-notification__message:has-text("Error")');
Line 267: const resultsArea = page.locator('.chart-container, .results-table, [class*="results"], canvas').first();
Line 330: const hasVisualization = await page.locator('canvas, .chart-container, svg').first().isVisible().catch(() => false);
Line 382: const resultsVisible = await page.locator('[class*="result"], [class*="value"], .query-result').first().isVisible().catch(() => false);
```

### metrics-config-tabs.spec.js (Top 10 of 33 violations)
```
Line 33:  const collapseButton = page.locator('[data-test="dashboard-sidebar-collapse-btn"]').first();
Line 51:  const configButton = page.locator('[data-test="dashboard-sidebar"]').first();
Line 63:  const sidebar = page.locator('.dashboard-sidebar, .config-sidebar, [class*="sidebar"]').first();
Line 69:  const tabs = page.locator('.q-tab, [role="tab"], .sidebar-tab').locator('visible');
Line 90:  const configButton = page.locator('[data-test="dashboard-sidebar"]').first();
Line 95:  const tabs = page.locator('.q-tab, [role="tab"], .sidebar-tab').locator('visible');
Line 119: const tabPanel = page.locator('.q-tab-panel, [role="tabpanel"], .tab-content').locator('visible').first();
Line 136: const configButton = page.locator('[data-test="dashboard-sidebar"]').first();
Line 141: const queryTab = page.locator('.q-tab, [role="tab"]').filter({ hasText: /Query/i }).first();
Line 158: const element = page.locator(selector).first();
```

---

## 🎯 Remediation Plan

### Phase 1: Fix Critical POM Violations (REQUIRED BEFORE MERGE)
1. **Create new locators in metricsPage.js** for all raw selectors
2. **Create helper methods** in metricsPage.js for common operations
3. **Refactor spec files** to use page object methods
4. **Verify all tests still pass**

**Estimated Effort**: 4-6 hours
**Priority**: P0 - MUST FIX

### Phase 2: Fix Soft Assertions
1. **Search for expect.soft** in all files
2. **Replace with expect**
3. **Run tests** to ensure behavior is correct

**Estimated Effort**: 1 hour
**Priority**: P0 - MUST FIX

### Phase 3: Consolidate Tests
1. **Identify consolidation opportunities** (see table above)
2. **Merge related tests** into single test cases
3. **Verify coverage is maintained**

**Estimated Effort**: 3-4 hours
**Priority**: P1 - SHOULD FIX

### Phase 4: Resolve Dependencies
1. **Choose PR strategy** (A, B, or C above)
2. **Restructure PRs** if needed
3. **Test merge scenarios**

**Estimated Effort**: 1-2 hours
**Priority**: P1 - SHOULD FIX

### Phase 5: Review cleanup.spec.js
1. **Audit test-data folder usage**
2. **Verify cleanup pattern completeness**
3. **Add missing patterns**

**Estimated Effort**: 1 hour
**Priority**: P2 - NICE TO HAVE

---

## ✅ Action Items

### Immediate (Block PR until fixed)
- [ ] Fix all 184+ POM violations
- [ ] Search and fix all soft assertions
- [ ] Verify tests pass after fixes

### Before Merge (Strongly recommended)
- [ ] Consolidate tests to reduce count by 30-40%
- [ ] Resolve PR dependency issues
- [ ] Review and update cleanup.spec.js

### Post-Merge (Can be done later)
- [ ] Further test optimization
- [ ] Performance tuning

---

## 📝 Notes

1. **metrics-chart-types-promql.spec.js** is the ONLY file with zero POM violations ✅
2. This can serve as a template for how the other files should be structured
3. The `verifyDataOnUI` helper function is reused across multiple files - should be a page object method
4. Many files have similar patterns - consolidation will reduce duplication significantly

---

## 🚨 Verdict

**❌ CRITICAL ISSUES FOUND - CANNOT MERGE UNTIL FIXED**

**Required Actions**:
1. Fix all POM violations (184+ instances)
2. Fix all soft assertions
3. Address missing dependencies

**Optional but Strongly Recommended**:
4. Consolidate tests (reduce by 30-40%)
5. Review cleanup.spec.js

---

**Generated**: 2026-01-14 by The Sentinel
**Audit Tool**: Playwright Code Sentinel
**Status**: BLOCKING - Fixes required before merge
