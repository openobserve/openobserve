# Supercluster Testing POC - Alert Syncing

## Overview
This document outlines the approach for testing OpenObserve supercluster environments where multiple clusters (devcluster1, devcluster2, etc.) synchronize data between them.

## Implementation Approach

We use **existing alert test files** (e.g., `alerts-ui-operations.spec.js`) instead of creating custom supercluster-specific tests. This approach allows us to:
- Test alert functionality in supercluster environments
- Verify basic alert operations work correctly across clusters
- Use proven, existing test patterns
- Gradually add verification for cross-cluster syncing in future iterations

## Test Scenario: Alert Operations in Supercluster Environment

### Current POC Scope
Run existing alert tests (like `alerts-ui-operations.spec.js`) against supercluster environments to verify:
1. Alerts can be created successfully on cluster 1
2. Alert operations (create, edit, delete) work correctly
3. Basic functionality is operational in supercluster setup

### Future Enhancement: Cross-Cluster Sync Verification
1. **Create Alert** - Randomly select cluster A and create an alert
2. **Verify Sync** - Check that the alert appears in cluster B and C
3. **Edit Alert** - Randomly select cluster B (different from A) and edit the alert
4. **Verify Edit Sync** - Check that the edited alert is updated in all clusters (A, B, C)
5. **Delete Alert** - Randomly select cluster C (different from A & B) and delete the alert
6. **Verify Delete Sync** - Check that the alert is deleted from all clusters

### Environment Configuration

#### Cluster Environments
```javascript
const CLUSTERS = {
  devcluster1: {
    ZO_ROOT_USER_EMAIL: 'root@example.com',
    ZO_ROOT_USER_PASSWORD: 'ac0dcdf1c5a1183bd78a9bdb67e18406',
    ZO_BASE_URL: 'https://devcluster1.o2aks1.internal.zinclabs.dev/',
    INGESTION_URL: 'https://devcluster1.o2aks1.internal.zinclabs.dev/',
    ORGNAME: 'default'
  },
  devcluster2: {
    ZO_ROOT_USER_EMAIL: 'root@example.com',
    ZO_ROOT_USER_PASSWORD: 'ac0dcdf1c5a1183bd78a9bdb67e18406',
    ZO_BASE_URL: 'https://devcluster2.o2aks1.internal.zinclabs.dev/',
    INGESTION_URL: 'https://devcluster2.o2aks1.internal.zinclabs.dev/',
    ORGNAME: 'default'
  },
  // Add more clusters as needed
};
```

### Test Implementation Details

#### Key Features
- **Random Cluster Selection**: Each operation (create, edit, delete) happens on a randomly selected cluster
- **Cross-Cluster Verification**: After each operation, verify the change is reflected in ALL clusters
- **Wait for Sync**: Include appropriate wait times for sync to complete (configurable)
- **Idempotency**: Tests should be repeatable and handle existing state

#### Sync Wait Strategy
- Initial sync wait: 5-10 seconds (configurable via env var `SUPERCLUSTER_SYNC_WAIT_MS`)
- Max retry attempts: 3
- Exponential backoff for retries

### GitHub Actions Workflow Integration

#### Workflow: `playwright.sc.yml` (in o2-enterprise)
- Location: `o2-enterprise/.github/workflows/playwright.sc.yml`
- Trigger: Manual workflow dispatch
- Test File: Uses existing `alerts-ui-operations.spec.js` from Alerts folder

#### Workflow Inputs
```yaml
inputs:
  cluster1_url: "https://devcluster1.o2aks1.internal.zinclabs.dev/"
  cluster2_url: "https://devcluster2.o2aks1.internal.zinclabs.dev/"
  root_email: "root@example.com"
  root_password: "ac0dcdf1c5a1183bd78a9bdb67e18406"
  orgname: "default"
  o2_opensource_repo: "main"
  o2_enterprise_repo: "main"
```

#### Job Configuration
```yaml
- testfolder: "Alerts"
  browser: "chrome"
  run_files: ["alerts-ui-operations.spec.js"]
```

### Environment Configuration in Tests

The workflow configures multiple environment variables for supercluster testing:

**Cluster 1 (Primary for tests):**
- `SC_CLUSTER1_EMAIL` - Email for cluster 1
- `SC_CLUSTER1_PASSWORD` - Password for cluster 1
- `SC_CLUSTER1_URL` - Base URL for cluster 1
- `SC_CLUSTER1_INGESTION_URL` - Ingestion URL for cluster 1
- `SC_CLUSTER1_ORG` - Organization name for cluster 1

**Cluster 2:**
- `SC_CLUSTER2_EMAIL` - Email for cluster 2
- `SC_CLUSTER2_PASSWORD` - Password for cluster 2
- `SC_CLUSTER2_URL` - Base URL for cluster 2
- `SC_CLUSTER2_INGESTION_URL` - Ingestion URL for cluster 2
- `SC_CLUSTER2_ORG` - Organization name for cluster 2

**Standard env vars (point to cluster 1):**
- `ZO_ROOT_USER_EMAIL`, `ZO_ROOT_USER_PASSWORD`
- `ZO_BASE_URL`, `INGESTION_URL`, `ORGNAME`

This allows existing tests to run against cluster 1 by default, while providing access to cluster 2 configuration for future sync verification tests.

### Future Enhancement: Helper Utilities for Sync Verification

When implementing cross-cluster sync verification, these utilities will be needed:

1. **ClusterManager** - Manage multiple cluster contexts
2. **SyncVerifier** - Verify synchronization across clusters
3. **MultiClusterLogin** - Handle authentication for multiple clusters

### Success Criteria
- Alert created on one cluster appears in all other clusters within sync timeout
- Alert edits propagate to all clusters
- Alert deletion removes alert from all clusters
- Test runs reliably in CI/CD pipeline
- Clear error messages when sync fails

### Risks & Mitigations
1. **Network latency** - Use configurable timeouts
2. **Sync delays** - Implement retry logic with exponential backoff
3. **Cluster availability** - Skip test if any cluster is unreachable (with warning)
4. **Auth token expiry** - Refresh tokens as needed

### Future Enhancements
- Test alert triggering and notification syncing
- Test dashboard syncing
- Test user/org syncing
- Performance metrics for sync time
- Parallel execution across multiple alert types
