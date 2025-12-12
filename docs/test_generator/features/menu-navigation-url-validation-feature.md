# Menu Navigation URL Validation - Functional Design Document

## Document Information
- **Feature Name**: Menu Navigation URL Validation
- **Version**: 1.0
- **Date**: 2025-12-12
- **Source Files Analyzed**:
  - `web/src/components/MenuLink.vue`
  - `web/src/layouts/MainLayout.vue`
  - `web/src/router/index.ts`
  - `web/src/router/routes.ts`
- **Status**: DRAFT

---

## Overview

This feature validates that all menu navigation items in the OpenObserve application correctly include the `org_identifier` query parameter in their URLs. This ensures proper organization context is maintained across all pages during navigation.

---

## Feature Purpose

### Business Value
- Ensures consistent organization context across the application
- Prevents users from losing organization context when navigating between pages
- Validates that all routes properly maintain the `org_identifier` query parameter
- Provides confidence that navigation UX is consistent and reliable

### Technical Value
- Validates MenuLink component's automatic query parameter injection
- Tests router integration with Vuex store for organization management
- Ensures deep linking works correctly with organization context
- Provides regression detection for navigation-related issues

---

## Feature Access Points

### How to Access
1. User logs into the application
2. Organization is selected (either default or via dropdown)
3. User clicks any menu item in the left sidebar navigation
4. URL should contain `?org_identifier=<org_identifier>` query parameter

### Prerequisites
- User must be authenticated
- At least one organization must exist
- Organization must be selected in the application state

---

## UI Components

### Component: MenuLink
**File**: `web/src/components/MenuLink.vue`

#### Selectors (data-test attributes)
| Selector | Element Type | Purpose | Route |
|----------|--------------|---------|-------|
| `[data-test="menu-link-/-item"]` | q-item (link) | Navigate to Home | `/` |
| `[data-test="menu-link-/logs-item"]` | q-item (link) | Navigate to Logs/Search | `/logs` |
| `[data-test="menu-link-/metrics-item"]` | q-item (link) | Navigate to Metrics | `/metrics` |
| `[data-test="menu-link-/traces-item"]` | q-item (link) | Navigate to Traces | `/traces` |
| `[data-test="menu-link-/rum-item"]` | q-item (link) | Navigate to RUM | `/rum` |
| `[data-test="menu-link-/dashboards-item"]` | q-item (link) | Navigate to Dashboards | `/dashboards` |
| `[data-test="menu-link-/streams-item"]` | q-item (link) | Navigate to Streams/Index | `/streams` |
| `[data-test="menu-link-/alerts-item"]` | q-item (link) | Navigate to Alerts | `/alerts` |
| `[data-test="menu-link-/ingestion-item"]` | q-item (link) | Navigate to Ingestion | `/ingestion` |
| `[data-test="menu-link-/iam-item"]` | q-item (link) | Navigate to IAM (admin only) | `/iam` |
| `[data-test="menu-link-/reports-item"]` | q-item (link) | Navigate to Reports (OSS only) | `/reports` |
| `[data-test="menu-link-/actions-item"]` | q-item (link) | Navigate to Actions (if enabled) | `/actions` |

#### Navigation Mechanism
**From MenuLink.vue (lines 21-29)**:
```javascript
:to="{
  path: link,
  exact: false,
  query: {
    org_identifier: store.state.selectedOrganization?.identifier,
  },
}"
```

**Key Behavior**:
- MenuLink component automatically injects `org_identifier` into query params
- Organization identifier is pulled from Vuex store: `store.state.selectedOrganization.identifier`
- Navigation uses Vue Router's `router-link` functionality
- Active state is tracked by comparing `router.currentRoute.value.path.indexOf(link)`

#### States
| State | Condition | Visual Change |
|-------|-----------|---------------|
| Active | `router.currentRoute.value.path.indexOf(link) == 0 && link != '/'` | Gradient background, bold text, left border indicator |
| Inactive | Default state | Standard styling |
| Hover | Mouse over link | Icon scales up, slight transform effect |
| Disabled (IAM) | `store.state.currentuser.role != "admin"` | Menu item not displayed |
| Hidden | Feature disabled via config (`custom_hide_menus`) | Menu item not displayed |

#### Conditional Menu Items
| Menu Item | Display Condition | Source |
|-----------|-------------------|--------|
| IAM | `store.state.currentuser.role == "admin"` | MainLayout.vue:417 |
| Reports | `config.isCloud == "false"` | MainLayout.vue:576-582 |
| Actions | `isActionsEnabled.value == true` | MainLayout.vue:527-546 |
| Custom Hidden | NOT in `store.state.zoConfig.custom_hide_menus` | MainLayout.vue:551-567 |

---

## User Workflows

### Workflow 1: Click Menu Item and Verify URL

**Scenario**: User clicks a menu item and URL contains org_identifier

**Preconditions**:
- User is logged in
- Organization is selected (e.g., "default")
- User is on any page in the application

**Steps**:
1. User clicks on menu item (e.g., "Logs") → Page navigates to `/logs`
2. Browser URL updates → URL contains `?org_identifier=default`
3. Page content loads → Content is scoped to the selected organization

**Success Criteria**:
- URL contains `org_identifier` query parameter
- Query parameter value matches the selected organization identifier
- Page loads successfully with organization context
- Active menu item is visually highlighted

**Alternative Paths**:
- If organization not selected → Should redirect to organization selection
- If invalid org_identifier → Should handle gracefully with error message

---

### Workflow 2: Navigate Through All Menu Items

**Scenario**: User clicks through all menu items sequentially

**Preconditions**:
- User is logged in
- Organization "default" is selected
- User is on Home page

**Steps**:
1. Click "Home" → URL: `/?org_identifier=default`
2. Click "Logs" → URL: `/logs?org_identifier=default`
3. Click "Metrics" → URL: `/metrics?org_identifier=default`
4. Click "Traces" → URL: `/traces?org_identifier=default`
5. Click "RUM" → URL: `/rum?org_identifier=default`
6. Click "Dashboards" → URL: `/dashboards?org_identifier=default`
7. Click "Streams" → URL: `/streams?org_identifier=default`
8. Click "Alerts" → URL: `/alerts?org_identifier=default`
9. Click "Ingestion" → URL: `/ingestion?org_identifier=default`
10. Click "IAM" (if admin) → URL: `/iam?org_identifier=default`

**Success Criteria**:
- All URLs contain `org_identifier=default`
- No navigation errors occur
- Each page loads successfully
- Active state updates correctly for each click

---

### Workflow 3: Organization Change Preserves Navigation

**Scenario**: User changes organization and navigates to different pages

**Preconditions**:
- User is logged in
- Multiple organizations available ("default", "test-org")
- User is on Logs page with org_identifier=default

**Steps**:
1. Current URL: `/logs?org_identifier=default`
2. User changes organization to "test-org" via header dropdown → URL updates to `/logs?org_identifier=test-org`
3. User clicks "Dashboards" menu item → URL: `/dashboards?org_identifier=test-org`
4. User clicks "Alerts" menu item → URL: `/alerts?org_identifier=test-org`

**Success Criteria**:
- Organization change updates `org_identifier` in current URL
- Subsequent navigation uses new organization identifier
- No mixing of organization identifiers occurs
- Store state matches URL query parameter

---

## Feature Interactions

### Input Validation
| Field | Validation Rules | Error Message |
|-------|------------------|---------------|
| org_identifier | Must match an existing organization | "Organization not found" |
| org_identifier | Cannot be empty | Redirect to default organization |
| org_identifier | Must be string | Type coercion applied |

### State Dependencies
- **Vuex Store**: `store.state.selectedOrganization.identifier` - Source of truth for current organization
- **Vue Router**: `router.currentRoute.value.query.org_identifier` - URL query parameter
- **localStorage**: `useLocalOrganization()` - Persisted organization across sessions
- **User Role**: `store.state.currentuser.role` - Determines IAM menu visibility

### External Dependencies
- Organization must exist in `store.state.organizations` array
- User must have permission to access organization
- Router must be properly configured with organization-aware routes

---

## Edge Cases and Limitations

### Edge Case 1: Missing org_identifier in URL
**Condition**: User manually removes `org_identifier` from URL
**Behavior**: Application should detect missing parameter and:
- Load default organization from localStorage
- Add `org_identifier` back to URL via router.push()
- Continue normal operation

**User Action**: System auto-corrects, no user action needed

### Edge Case 2: Invalid org_identifier in URL
**Condition**: User provides non-existent org identifier (e.g., `?org_identifier=fake`)
**Behavior**: Application should:
- Validate organization exists in user's organization list
- If not found, redirect to default organization
- Show notification about invalid organization

**User Action**: Select valid organization from dropdown

### Edge Case 3: External Menu Items
**Condition**: Some menu items link to external URLs (e.g., documentation)
**Behavior**: External links do NOT include `org_identifier`
**Validation**: Test should only validate internal navigation links

### Edge Case 4: IAM Menu Not Visible for Non-Admin
**Condition**: User has "member" or "viewer" role
**Behavior**: IAM menu item does not render in DOM
**Validation**: Test should check user role before validating IAM link

### Edge Case 5: Reports Menu Only in OSS
**Condition**: Application running in cloud mode (`config.isCloud == "true"`)
**Behavior**: Reports menu item does not render
**Validation**: Test should check environment config before validating Reports link

### Edge Case 6: Actions Menu Conditionally Displayed
**Condition**: Actions feature disabled (`!store.state.zoConfig.actions_enabled`)
**Behavior**: Actions menu item does not render
**Validation**: Test should check feature flag before validating Actions link

### Edge Case 7: Custom Hidden Menus
**Condition**: `store.state.zoConfig.custom_hide_menus` contains menu names
**Behavior**: Specified menu items are filtered out
**Validation**: Test should dynamically determine which menus are visible

---

## Testing Scenarios

### Functional Testing

#### Test Case 1: Home Menu Navigation with org_identifier
**Objective**: Verify Home menu adds org_identifier to URL
**Priority**: P0 (Critical)

**Preconditions**:
- User logged in
- Organization "default" selected
- User on any page

**Steps**:
1. Click `[data-test="menu-link-/-item"]`
2. Wait for navigation to complete
3. Check browser URL

**Expected Result**:
- URL is `/?org_identifier=default`
- Home page loads successfully
- Menu item shows active state

**Selectors Used**: `[data-test="menu-link-/-item"]`

---

#### Test Case 2: Logs Menu Navigation with org_identifier
**Objective**: Verify Logs menu adds org_identifier to URL
**Priority**: P0 (Critical)

**Preconditions**:
- User logged in
- Organization "default" selected

**Steps**:
1. Click `[data-test="menu-link-/logs-item"]`
2. Wait for navigation to complete
3. Check browser URL

**Expected Result**:
- URL is `/logs?org_identifier=default`
- Logs page loads successfully
- Menu item shows active state

**Selectors Used**: `[data-test="menu-link-/logs-item"]`

---

#### Test Case 3: All Core Menus Have org_identifier
**Objective**: Verify all core menu items include org_identifier in URL
**Priority**: P0 (Critical)

**Preconditions**:
- User logged in as admin
- Organization "default" selected
- OSS environment (to include all menus)

**Steps**:
1. Define array of core menu items to test:
   ```javascript
   const coreMenus = [
     { name: 'Home', path: '/', selector: 'menu-link-/-item' },
     { name: 'Logs', path: '/logs', selector: 'menu-link-/logs-item' },
     { name: 'Metrics', path: '/metrics', selector: 'menu-link-/metrics-item' },
     { name: 'Traces', path: '/traces', selector: 'menu-link-/traces-item' },
     { name: 'RUM', path: '/rum', selector: 'menu-link-/rum-item' },
     { name: 'Dashboards', path: '/dashboards', selector: 'menu-link-/dashboards-item' },
     { name: 'Streams', path: '/streams', selector: 'menu-link-/streams-item' },
     { name: 'Alerts', path: '/alerts', selector: 'menu-link-/alerts-item' },
     { name: 'Ingestion', path: '/ingestion', selector: 'menu-link-/ingestion-item' }
   ];
   ```
2. For each menu item:
   a. Click menu item using `[data-test="${selector}"]`
   b. Wait for navigation
   c. Get current URL
   d. Assert URL contains `org_identifier=default`
   e. Assert URL path matches expected path
3. Log all results

**Expected Result**:
- All menu items successfully navigate
- All URLs contain `org_identifier=default`
- No navigation errors occur
- Active states update correctly

**Selectors Used**: All menu-link-* selectors from core menus array

---

#### Test Case 4: IAM Menu (Admin Only)
**Objective**: Verify IAM menu is visible for admin and includes org_identifier
**Priority**: P1 (Functional)

**Preconditions**:
- User logged in as admin (`role === "admin"`)
- Organization "default" selected

**Steps**:
1. Check if `[data-test="menu-link-/iam-item"]` is visible
2. Click IAM menu item
3. Wait for navigation
4. Check URL

**Expected Result**:
- IAM menu item is visible
- URL is `/iam?org_identifier=default`
- IAM page loads successfully

**Selectors Used**: `[data-test="menu-link-/iam-item"]`

---

#### Test Case 5: Reports Menu (OSS Only)
**Objective**: Verify Reports menu exists in OSS and includes org_identifier
**Priority**: P2 (Conditional)

**Preconditions**:
- User logged in
- OSS environment (`config.isCloud === "false"`)
- Organization "default" selected

**Steps**:
1. Check if `[data-test="menu-link-/reports-item"]` exists
2. If exists, click Reports menu item
3. Wait for navigation
4. Check URL

**Expected Result**:
- Reports menu item is visible (OSS only)
- URL is `/reports?org_identifier=default`
- Reports page loads successfully

**Selectors Used**: `[data-test="menu-link-/reports-item"]`

---

### Edge Case Testing

#### Test Case: Organization Change Updates All Navigation
**Objective**: Verify navigation maintains new org_identifier after organization change
**Priority**: P1 (Functional)

**Preconditions**:
- User logged in
- Multiple organizations available: "default", "test-org"
- User on Logs page

**Steps**:
1. Current URL: `/logs?org_identifier=default`
2. Change organization to "test-org" via header dropdown
3. Wait for URL update
4. Assert URL is `/logs?org_identifier=test-org`
5. Click Dashboards menu
6. Assert URL is `/dashboards?org_identifier=test-org`
7. Click Alerts menu
8. Assert URL is `/alerts?org_identifier=test-org`

**Expected Result**:
- Organization change immediately updates URL
- All subsequent navigation uses new org_identifier
- No navigation uses old org_identifier
- Store state matches URL throughout

---

#### Test Case: Direct URL Navigation Preserves org_identifier
**Objective**: Verify manually typing URL with org_identifier works correctly
**Priority**: P2 (Edge Case)

**Preconditions**:
- User logged in
- Organization "test-org" exists

**Steps**:
1. Navigate directly to `/dashboards?org_identifier=test-org`
2. Wait for page load
3. Click any other menu item (e.g., Logs)
4. Check URL includes `org_identifier=test-org`

**Expected Result**:
- Direct navigation loads correct organization context
- Subsequent navigation preserves org_identifier
- Store state updates to match URL

---

## Selector Reference (Quick Lookup)

| Menu Name | Selector | Route | Condition |
|-----------|----------|-------|-----------|
| Home | `[data-test="menu-link-/-item"]` | `/` | Always visible |
| Logs | `[data-test="menu-link-/logs-item"]` | `/logs` | Always visible |
| Metrics | `[data-test="menu-link-/metrics-item"]` | `/metrics` | Always visible |
| Traces | `[data-test="menu-link-/traces-item"]` | `/traces` | Always visible |
| RUM | `[data-test="menu-link-/rum-item"]` | `/rum` | Always visible |
| Dashboards | `[data-test="menu-link-/dashboards-item"]` | `/dashboards` | Always visible |
| Streams | `[data-test="menu-link-/streams-item"]` | `/streams` | Always visible |
| Alerts | `[data-test="menu-link-/alerts-item"]` | `/alerts` | Always visible |
| Ingestion | `[data-test="menu-link-/ingestion-item"]` | `/ingestion` | Always visible |
| IAM | `[data-test="menu-link-/iam-item"]` | `/iam` | Admin role only |
| Reports | `[data-test="menu-link-/reports-item"]` | `/reports` | OSS only |
| Actions | `[data-test="menu-link-/actions-item"]` | `/actions` | If enabled |

---

## Appendix: Source Code References

### Main Component Files
- `web/src/components/MenuLink.vue` - Menu link component with auto org_identifier injection
- `web/src/layouts/MainLayout.vue` - Main layout with menu configuration
- `web/src/router/index.ts` - Router configuration
- `web/src/router/routes.ts` - Route definitions

### Store Dependencies
- `store.state.selectedOrganization.identifier` - Current organization
- `store.state.organizations` - Available organizations list
- `store.state.currentuser.role` - User role for IAM visibility
- `store.state.zoConfig.custom_hide_menus` - Hidden menus configuration
- `store.state.zoConfig.actions_enabled` - Actions feature flag

### Related Utilities
- `utils/zincutils.ts::useLocalOrganization()` - Organization persistence
- `utils/zincutils.ts::useLocalCurrentUser()` - User persistence

---

## Test Implementation Notes

### Data-Test Selector Pattern
Menu links use a consistent pattern:
```
data-test="menu-link-${route_path}-item"
```

Where `${route_path}` is the route path (e.g., `/logs` becomes `menu-link-/logs-item`)

### URL Validation Pattern
All internal routes should match:
```javascript
const url = new URL(page.url());
expect(url.searchParams.get('org_identifier')).toBe(expectedOrgId);
```

### Environment-Specific Tests
Tests should check environment before validating conditional menus:
```javascript
if (config.isCloud === 'false') {
  // Test Reports menu
}
if (userRole === 'admin') {
  // Test IAM menu
}
```

---

## Proposed Test Count
- **P0 Tests**: 3 (Home, Logs, All Core Menus)
- **P1 Tests**: 3 (IAM admin, Organization change, Multiple navigations)
- **P2 Tests**: 2 (Reports OSS, Direct URL navigation)
- **Total**: 8 tests

---

## Document Status
✅ Selectors extracted from source code
✅ Routes mapped from MainLayout.vue
✅ Navigation mechanism documented
✅ Conditional logic identified
✅ Edge cases documented
✅ Test cases defined with priorities

**Ready for Review**: YES
