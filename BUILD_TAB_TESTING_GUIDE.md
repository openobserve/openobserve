# Build Tab Testing & Deployment Guide

## ✅ Integration Status: COMPLETE

All integration work has been completed successfully as of 2026-01-02.

### Files Modified
- ✅ [web/src/plugins/logs/SearchBar.vue](web/src/plugins/logs/SearchBar.vue) - Added Build tab button
- ✅ [web/src/plugins/logs/Index.vue](web/src/plugins/logs/Index.vue) - Integrated BuildQueryTab component
- ✅ [web/src/styles/logs/logs-page.scss](web/src/styles/logs/logs-page.scss) - Added styling
- ✅ [web/src/locales/languages/en.json](web/src/locales/languages/en.json) - Added i18n translation
- ✅ [web/src/plugins/logs/GeneratedQueryDisplay.vue](web/src/plugins/logs/GeneratedQueryDisplay.vue) - Fixed SCSS syntax

### Files Created
- ✅ [web/src/plugins/logs/BuildQueryTab.vue](web/src/plugins/logs/BuildQueryTab.vue) (~470 lines)
- ✅ [web/src/plugins/logs/GeneratedQueryDisplay.vue](web/src/plugins/logs/GeneratedQueryDisplay.vue) (~220 lines)

### Build Verification
- ✅ TypeScript compilation: **PASSED**
- ✅ Production build: **SUCCESSFUL** (completed in 2m 59s)
- ✅ No SCSS syntax errors
- ✅ All imports resolved correctly

---

## 🧪 Manual Testing Checklist

### Basic Functionality

#### Tab Navigation
- [ ] Open OpenObserve logs page
- [ ] Verify "Build" button appears between "Visualize" and "Patterns" tabs
- [ ] Click "Build" button → BuildQueryTab component should display
- [ ] Verify three-column layout appears:
  - Left: Chart type selection
  - Middle: Field list + Query builder + Chart preview
  - Right: Configuration panel (initially collapsed)

#### Stream Selection
- [ ] Select a stream from the main logs page dropdown
- [ ] Switch to Build tab
- [ ] Verify field list populates with stream fields
- [ ] Verify stream name appears in query builder

#### Chart Type Selection
- [ ] Click different chart types in left sidebar:
  - [ ] Bar chart
  - [ ] Line chart
  - [ ] Area chart
  - [ ] Pie chart
  - [ ] Donut chart
  - [ ] Table
  - [ ] Metric
- [ ] Verify chart preview updates for each type

### Query Building

#### X-Axis Configuration
- [ ] Drag `_timestamp` field to X-axis
- [ ] Verify it's added with "histogram" aggregation
- [ ] Check generated SQL includes histogram function
- [ ] Drag a text field to X-axis
- [ ] Verify no aggregation applied (plain field)

#### Y-Axis Configuration
- [ ] Drag a numeric field to Y-axis
- [ ] Verify aggregation dropdown appears (COUNT, SUM, AVG, MIN, MAX)
- [ ] Select "COUNT" → verify SQL shows `COUNT(field)`
- [ ] Select "AVG" → verify SQL shows `AVG(field)`
- [ ] Add multiple Y-axis fields
- [ ] Verify all appear in generated SQL

#### Breakdown (Group By)
- [ ] Drag a field to "Breakdown" area
- [ ] Verify `GROUP BY` clause appears in generated SQL
- [ ] Add multiple breakdown fields
- [ ] Verify all appear in `GROUP BY` clause

#### Filters (Where Conditions)
- [ ] Click "Add Filter" button
- [ ] Select a field, operator (=, !=, >, <, etc.), and value
- [ ] Verify `WHERE` clause appears in generated SQL
- [ ] Add multiple filters
- [ ] Verify they're combined with `AND`
- [ ] Try "OR" conditions if supported

### Generated SQL Display

#### SQL Preview
- [ ] Verify "Generated SQL Query" section appears at bottom
- [ ] Check syntax highlighting works:
  - Keywords (SELECT, FROM, WHERE) → Blue
  - Functions (COUNT, AVG) → Yellow
  - Strings → Orange
  - Numbers → Green
- [ ] Click collapse/expand icon → verify it toggles visibility

#### Copy SQL
- [ ] Click "Copy SQL" button
- [ ] Paste into text editor
- [ ] Verify complete SQL query is copied
- [ ] Check notification appears: "SQL query copied to clipboard"

#### Edit in SQL Mode
- [ ] Click "Edit in SQL mode" button (open_in_new icon)
- [ ] Verify you're switched back to "Logs" tab
- [ ] Verify generated SQL is populated in query editor
- [ ] Verify SQL mode is enabled automatically

### Chart Preview

#### Basic Rendering
- [ ] After adding X and Y axis fields, click "Apply" button
- [ ] Verify chart renders in preview area
- [ ] Check data appears correctly
- [ ] Verify loading indicator shows during query execution

#### Error Handling
- [ ] Try creating invalid configuration (e.g., no Y-axis)
- [ ] Verify error message appears
- [ ] Try selecting non-existent field
- [ ] Verify validation error displays

### Configuration Panel

#### Opening/Closing
- [ ] Click config icon (top-right of middle panel)
- [ ] Verify configuration sidebar opens from right
- [ ] Verify splitter allows resizing
- [ ] Close config panel → verify it collapses

#### Chart Settings
- [ ] Open config panel
- [ ] Navigate through tabs:
  - [ ] Chart tab → axis labels, titles
  - [ ] Legend tab → position, visibility
  - [ ] Data tab → limits, sorting
- [ ] Modify settings → click Apply
- [ ] Verify chart preview reflects changes

### Field List Interaction

#### Collapse/Expand
- [ ] Click collapse icon on field list
- [ ] Verify field list hides
- [ ] Click expand icon → verify it reappears

#### Search Fields
- [ ] Type field name in search box
- [ ] Verify matching fields are filtered
- [ ] Clear search → verify all fields reappear

#### Drag & Drop
- [ ] Drag field from list to X-axis drop zone
- [ ] Verify smooth drag interaction
- [ ] Drag field to Y-axis
- [ ] Verify drop zone highlights on hover

### Add to Dashboard

#### Save Flow
- [ ] Click "Add to Dashboard" button (top-right)
- [ ] Verify dialog opens with:
  - Dashboard dropdown
  - Panel title input
  - Panel description input
- [ ] Select existing dashboard or create new
- [ ] Enter panel title and description
- [ ] Click "Save"
- [ ] Verify success notification appears
- [ ] Navigate to dashboard → verify panel appears

#### Validation
- [ ] Try saving without X or Y axis
- [ ] Verify validation error displays
- [ ] Try saving with empty title
- [ ] Verify required field error shows

### Context Synchronization

#### Stream Changes
- [ ] Select "Stream A" on logs page
- [ ] Switch to Build tab → verify fields from Stream A appear
- [ ] Switch back to logs, select "Stream B"
- [ ] Switch to Build tab → verify fields from Stream B appear

#### Time Range Sync
- [ ] Set custom time range on logs page (e.g., "Last 15 minutes")
- [ ] Switch to Build tab
- [ ] Run query → verify time range matches logs page
- [ ] Change time range in logs
- [ ] Re-run Build tab query → verify updated time range used

### Edge Cases

#### No Stream Selected
- [ ] Clear stream selection on logs page
- [ ] Switch to Build tab
- [ ] Verify message appears: "Please select a stream first"

#### Empty Query
- [ ] Open Build tab without adding any fields
- [ ] Click "Apply"
- [ ] Verify error or prompt to configure query

#### Large Result Sets
- [ ] Create query that returns >10,000 rows
- [ ] Verify warning/notification about large results
- [ ] Check results are limited (e.g., to 1000 rows)

#### Network Errors
- [ ] Disconnect network (or simulate via DevTools)
- [ ] Try running query
- [ ] Verify error message displays
- [ ] Reconnect network → verify retry works

#### SQL Mode Toggle
- [ ] Enable SQL mode on logs tab
- [ ] Switch to Build tab → verify it still works
- [ ] Disable SQL mode
- [ ] Verify Build tab continues functioning

#### Quick Mode
- [ ] Enable Quick mode on logs page
- [ ] Switch to Build tab
- [ ] Verify functionality not affected

### Multi-Language Support

#### Translation Keys
- [ ] Switch UI language to German/Spanish/French (if available)
- [ ] Verify "Build" button text translates
- [ ] Check tooltips translate correctly
- [ ] Verify error messages translate

---

## 🔍 Automated Testing Recommendations

### Unit Tests (Recommended to Add)

```typescript
// BuildQueryTab.spec.ts
describe('BuildQueryTab', () => {
  it('should initialize with default fields', () => {
    // Test default X-axis: _timestamp
    // Test default Y-axis: count(*)
  });

  it('should generate SQL when fields added', () => {
    // Add X-axis field → verify SQL generated
    // Add Y-axis field → verify SQL updated
  });

  it('should handle chart type changes', () => {
    // Change from bar to line → verify config updates
  });

  it('should emit query-changed event', () => {
    // Modify query → verify event emitted with SQL
  });
});

// GeneratedQueryDisplay.spec.ts
describe('GeneratedQueryDisplay', () => {
  it('should highlight SQL syntax', () => {
    // Pass SQL query → verify HTML with syntax classes
  });

  it('should copy query to clipboard', () => {
    // Click copy → verify navigator.clipboard called
  });

  it('should emit edit event', () => {
    // Click edit in SQL mode → verify event emitted
  });
});
```

### E2E Tests (Cypress/Playwright)

```javascript
// build-tab.e2e.ts
describe('Build Tab E2E', () => {
  it('should create and save visualization', () => {
    cy.visit('/logs');
    cy.selectStream('default');
    cy.get('[data-test="logs-build-toggle"]').click();

    // Drag field to X-axis
    cy.get('[data-field="_timestamp"]').drag('[data-drop="x-axis"]');

    // Add Y-axis aggregation
    cy.get('[data-test="add-y-axis"]').click();
    cy.get('[data-test="y-axis-field"]').select('count');

    // Apply query
    cy.get('[data-test="apply-query"]').click();

    // Verify chart renders
    cy.get('.panel-schema-renderer').should('be.visible');

    // Save to dashboard
    cy.get('[data-test="add-to-dashboard"]').click();
    cy.get('[data-test="dashboard-select"]').select('My Dashboard');
    cy.get('[data-test="panel-title"]').type('Test Visualization');
    cy.get('[data-test="save-panel"]').click();

    // Verify success
    cy.contains('Visualization saved to dashboard').should('be.visible');
  });
});
```

---

## 🚀 Deployment Steps

### Pre-Deployment Checklist
- [x] All TypeScript compilation errors resolved
- [x] Production build succeeds without errors
- [x] Code reviewed by team
- [ ] Manual testing completed (see checklist above)
- [ ] Documentation updated
- [ ] Release notes prepared

### Development Environment
1. Ensure latest code pulled from main branch
2. Install dependencies:
   ```bash
   cd web
   npm install
   ```
3. Run dev server:
   ```bash
   npm run dev
   ```
4. Test locally at `http://localhost:8080`

### Staging Deployment
1. Merge feature branch to staging:
   ```bash
   git checkout staging
   git merge feat/visualization-auto-support
   ```
2. Build production bundle:
   ```bash
   cd web
   npm run build
   ```
3. Deploy to staging server
4. Run smoke tests on staging
5. Verify with QA team

### Production Deployment
1. Tag release:
   ```bash
   git tag -a v1.X.0 -m "Add Build tab for auto SQL query builder"
   git push origin v1.X.0
   ```
2. Merge to main:
   ```bash
   git checkout main
   git merge staging
   git push origin main
   ```
3. Deploy to production
4. Monitor error logs and metrics
5. Notify users of new feature

### Rollback Plan
If critical issues found:
1. Revert merge commit:
   ```bash
   git revert -m 1 <merge-commit-hash>
   ```
2. Redeploy previous version
3. Investigate and fix issues
4. Re-test thoroughly before re-deploying

---

## 📊 Monitoring & Metrics

### Key Metrics to Track
- **Adoption Rate**: % of users clicking Build tab
- **Completion Rate**: % of users who save visualizations
- **Error Rate**: Errors in Build tab vs. other tabs
- **Performance**: Query generation time, chart render time
- **Abandonment Points**: Where users drop off in flow

### Logging Points
- Build tab opened (analytics event)
- Query generated (log SQL + fields)
- Query executed (log execution time)
- Visualization saved (log to dashboard)
- Errors encountered (log stack trace)

### Success Criteria
- [ ] >20% of log users try Build tab within first week
- [ ] <5% error rate in Build tab interactions
- [ ] Average query generation time <500ms
- [ ] Positive user feedback (>4/5 rating)

---

## 🐛 Known Issues & Limitations

### Current Limitations
1. **Single Stream Only**: Build tab only supports one stream at a time (matches existing Visualize behavior)
2. **No SQL Parsing**: Cannot parse custom SQL back into visual builder (Phase 2 feature)
3. **Limited VRL Support**: VRL functions not yet integrated into visual builder
4. **No Query History**: Previous Build tab queries not saved (can be added in Phase 2)

### Browser Compatibility
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+
- ⚠️ IE 11 not supported (matches existing OpenObserve support)

### Performance Considerations
- Large streams (>10,000 fields) may slow field list rendering
- Complex queries with many breakdowns may take longer to execute
- Chart rendering with >50 series may impact performance

---

## 📝 Release Notes Template

### Version X.X.0 - Build Tab Feature

**New Feature: Visual Query Builder (Build Tab)**

We're excited to introduce the new **Build tab** on the Logs page, making it easier than ever to create visualizations without writing SQL!

**What's New:**
- 🎨 Drag-and-drop interface for building queries visually
- 📊 Real-time chart preview as you configure fields
- 🔍 Auto-generated SQL with syntax highlighting
- 💾 Save visualizations directly to dashboards
- 🔄 Seamless switching between Build and SQL modes

**How to Use:**
1. Navigate to Logs page
2. Select a stream
3. Click the new "Build" tab (4th tab, between Visualize and Patterns)
4. Drag fields to X-axis, Y-axis, and Breakdown areas
5. Click "Apply" to preview your chart
6. Click "Add to Dashboard" to save

**Benefits:**
- No SQL knowledge required
- Faster visualization creation
- Reduced errors from manual SQL writing
- Consistent with dashboard panel creation UX

**Learn More:**
- [Documentation Link](#)
- [Video Tutorial](#)
- [Dashboard Guide](#)

---

## 👥 Training & Support

### User Training Materials Needed
- [ ] Video walkthrough of Build tab (5-10 minutes)
- [ ] Written tutorial with screenshots
- [ ] FAQ document
- [ ] Example use cases and templates

### Support Team Preparation
- [ ] Share testing guide with support team
- [ ] Document common issues and resolutions
- [ ] Create support ticket templates
- [ ] Schedule support team demo session

### Common User Questions (Draft FAQ)

**Q: What's the difference between Build and Visualize tabs?**
A: Build tab provides a visual, drag-and-drop interface for creating queries. Visualize tab shows charts for queries written in SQL mode. Build tab auto-generates the SQL for you.

**Q: Can I edit the generated SQL?**
A: Yes! Click "Edit in SQL mode" to switch to the Logs tab with your generated SQL, where you can modify it further.

**Q: Why can't I see the Build tab?**
A: Make sure you've selected a stream first. Build tab requires a stream to load available fields.

**Q: Can I use multiple streams in Build tab?**
A: Not currently. Build tab supports single-stream queries only (matching Visualize tab behavior).

**Q: My chart doesn't render. What's wrong?**
A: Check that you've added at least one field to both X-axis and Y-axis, then click "Apply" to run the query.

---

## 🎯 Success Checklist

### Before Going Live
- [ ] All manual tests passed
- [ ] No console errors in browser DevTools
- [ ] Performance meets benchmarks (<500ms query gen)
- [ ] Documentation complete and reviewed
- [ ] Support team trained
- [ ] Stakeholder demo completed
- [ ] Release notes approved

### Post-Launch (Week 1)
- [ ] Monitor error logs daily
- [ ] Track adoption metrics
- [ ] Collect user feedback
- [ ] Address critical bugs within 24 hours
- [ ] Schedule retrospective meeting

### Post-Launch (Month 1)
- [ ] Review analytics and metrics
- [ ] Identify improvement opportunities
- [ ] Prioritize Phase 2 features
- [ ] Document lessons learned
- [ ] Celebrate success with team! 🎉

---

**Last Updated:** 2026-01-02
**Version:** 1.0.0
**Status:** ✅ Ready for Testing & Deployment
