# Product Requirements Document (PRD)
## TestDino Integration for OpenObserve UI Test Suite

**Version:** 1.0
**Date:** October 8, 2025
**Author:** AI Assistant
**Status:** Draft - Awaiting Review

---

## 1. Executive Summary

### 1.1 Purpose
Integrate TestDino, an AI-powered Playwright reporting and analytics platform, with OpenObserve's existing UI automation test suite to provide enhanced test visibility, flakiness detection, historical reporting, and email notifications.

### 1.2 Goals
- Replace basic Playwright HTML reports with TestDino's advanced reporting dashboard
- Integrate with existing GitHub Actions CI/CD workflow
- Provide historical test run analytics and flakiness tracking
- Enable email notifications for test run results
- Maintain complete transparency with zero changes to existing test code, locators, or architecture

### 1.3 Success Criteria
- TestDino successfully receives and displays test results for every GitHub Actions run
- Test history and flakiness metrics are visible in TestDino dashboard
- Email notifications are received after each test run
- POC completed for one test folder without breaking existing tests
- No modification to existing test logic, locators, or page objects

---

## 2. Current State Analysis

### 2.1 Existing Test Infrastructure

**Test Framework:** Playwright v1.50.0

**Test Structure:**
- Tests organized in folders: GeneralTests, Logs, Dashboards, Alerts, Pipelines, Reports, Streams
- Matrix-based execution in GitHub Actions with 11 parallel jobs
- Tests run on: push to main, pull requests, and manual triggers

**Current Workflow (playwright.yml):**
```
Build Binary → UI Integration Tests (Matrix) → Generate Coverage Report
```

**Test Execution Matrix:**
- GeneralTests (8 spec files)
- Logs-Core (7 spec files)
- Logs-Queries (6 spec files)
- Alerts (3 spec files)
- Dashboards-Core (6 spec files)
- Dashboards-Settings (5 spec files)
- Dashboards-Charts (6 spec files)
- Dashboards-Streaming (1 spec file)
- Pipelines (3 spec files)
- Reports (2 spec files)
- Streams (3 spec files)

**Current Reporting:**
- Reporter: HTML (playwright.config.js line 36)
- Reports uploaded as GitHub Actions artifacts
- Retention: 30 days
- No centralized dashboard or historical tracking
- No flakiness detection
- No email notifications

### 2.2 Pain Points
1. **Limited Visibility:** Basic HTML reports don't provide historical trends
2. **No Flakiness Tracking:** No automated detection of flaky tests
3. **Distributed Reports:** Each run creates separate artifacts, hard to compare
4. **No Proactive Notifications:** Team must manually check GitHub Actions
5. **Limited Analytics:** No insights into test stability, execution time trends, or failure patterns

---

## 3. TestDino Platform Overview

### 3.1 What is TestDino?
TestDino is an AI-powered reporting and analytics platform specifically designed for Playwright test automation.

### 3.2 Key Features
1. **AI-Powered Insights**
   - Automatic test failure classification
   - Root cause analysis with confidence scores
   - Specific fix suggestions

2. **Flakiness Detection**
   - Identifies inconsistent pass/fail patterns
   - Categorizes flakiness: timing, network, or environment-related
   - Historical flakiness trends

3. **Test Analytics**
   - Tracks slow tests
   - Performance comparison across environments
   - Detailed root cause analysis
   - Pass/fail trends over time

4. **Integration**
   - One-line CI/CD integration
   - Works with GitHub Actions
   - Git-aware (branch, commit tracking)
   - Slack/Teams/PR summaries
   - Screenshots and trace viewer

5. **Reporting**
   - Centralized test run overview
   - Export reports (CSV/PDF)
   - Email notifications (assumed based on modern test platforms)

### 3.3 Integration Method
**Command:** `npx tdpw path/to/json/report --token $SECRET_API_KEY`

**Requirements:**
- JSON report from Playwright
- TestDino API token (from https://app.testdino.com)
- Node.js environment (already available)

---

## 4. Proposed Solution

### 4.1 Integration Approach

#### Phase 1: POC with One Test Folder (GeneralTests)
1. Configure Playwright to generate JSON reports alongside HTML
2. Add TestDino reporter configuration
3. Update GitHub Actions workflow for GeneralTests matrix job only
4. Store TestDino API token as GitHub Secret
5. Add TestDino upload step after test execution
6. Verify reports in TestDino dashboard
7. Test email notification functionality

#### Phase 2: Full Rollout (if POC successful)
1. Apply changes to all matrix jobs
2. Document the integration
3. Set up team access to TestDino dashboard
4. Configure email distribution lists

### 4.2 Technical Implementation

#### 4.2.1 Playwright Configuration Changes
**File:** `tests/ui-testing/playwright.config.js`

**Current:**
```javascript
reporter: 'html',
```

**Proposed:**
```javascript
reporter: [
  ['html'], // Keep existing HTML reporter
  ['json', { outputFile: 'test-results/results.json' }] // Add JSON reporter for TestDino
],
```

**Impact:**
- Zero impact on test execution
- HTML reports remain unchanged
- Additional JSON report generated

#### 4.2.2 GitHub Actions Workflow Changes
**File:** `.github/workflows/playwright.yml`

**Changes Required:**

1. **Add TestDino API Token Secret**
   - Secret Name: `TESTDINO_API_TOKEN`
   - To be configured in GitHub repository settings

2. **Modify ui_integration_tests job** (lines 98-315)
   - Add step after test execution
   - Upload JSON report to TestDino

**New Step (to be added after line 284):**
```yaml
- name: Upload results to TestDino
  if: always() # Run even if tests fail
  run: |
    cd tests/ui-testing
    npx tdpw test-results/results.json --token ${{ secrets.TESTDINO_API_TOKEN }}
```

**POC Scope:** Apply only to GeneralTests matrix job initially

#### 4.2.3 Directory Structure
```
tests/ui-testing/
├── playwright.config.js          # Modified: Add JSON reporter
├── test-results/                 # New: Created by Playwright
│   └── results.json              # New: JSON report for TestDino
├── playwright-report/            # Existing: HTML reports
└── playwright-tests/             # Existing: No changes
```

### 4.3 Email Notifications
- TestDino platform should support email notifications (to be verified during setup)
- Configure in TestDino dashboard settings
- Set up distribution list for team
- Configure notification triggers (failures, flaky tests, etc.)

---

## 5. Implementation Plan

### 5.1 Prerequisites
- [ ] Create TestDino account at https://app.testdino.com/auth/signup
- [ ] Obtain TestDino API token
- [ ] Add `TESTDINO_API_TOKEN` to GitHub repository secrets
- [ ] Document current test pass rates for baseline comparison

### 5.2 POC Phase - GeneralTests Folder

**Duration:** 1-2 days

**Steps:**

1. **Backup Current State** ✓ Critical Rule #3
   - Document current workflow configuration
   - Capture baseline test results

2. **Configure Playwright Reporter**
   - Modify `playwright.config.js` to add JSON reporter
   - Test locally to ensure JSON generation works

3. **Create TestDino Account & Setup**
   - Sign up at TestDino
   - Obtain API token
   - Add token to GitHub secrets

4. **Update GitHub Actions for GeneralTests**
   - Modify only the GeneralTests matrix job
   - Add TestDino upload step
   - Commit to feature branch

5. **Test Integration**
   - Trigger manual workflow run
   - Verify tests execute normally
   - Confirm JSON report uploaded to TestDino
   - Check TestDino dashboard for results

6. **Verify Functionality**
   - Review test results in TestDino
   - Test email notification setup
   - Compare with GitHub Actions results
   - Document any issues

7. **Gather Feedback**
   - Review PRD and results with user
   - Assess value of TestDino reports
   - Decision point: Proceed to full rollout or adjust

### 5.3 Full Rollout (Conditional on POC Success)

**Duration:** 1 day

**Steps:**
1. Apply TestDino integration to all matrix jobs
2. Monitor 3-5 test runs for stability
3. Document integration for team
4. Set up team access to TestDino
5. Configure email notifications
6. Archive old HTML reports (optional)

---

## 6. Questions for User Review

### 6.1 Critical Questions
1. **TestDino Account:** Do you already have a TestDino account, or shall we create one?
2. **Email Recipients:** Who should receive email notifications from TestDino?
3. **POC Folder:** Is GeneralTests the right folder for POC, or would you prefer a different one?
4. **Approval:** Any concerns about adding JSON reporter alongside HTML?

### 6.2 Optional Questions
1. **Slack/Teams Integration:** Would you like TestDino to post to Slack/Teams channels?
2. **Report Retention:** Should we keep both HTML and TestDino reports, or eventually remove HTML?
3. **Flakiness Threshold:** What flakiness rate would trigger action (e.g., 10%, 25%)?
4. **Email Frequency:** Notifications for every run, or only failures/flaky tests?

---

## 7. Risk Assessment

### 7.1 Low Risk
- ✅ Adding JSON reporter is non-invasive
- ✅ TestDino step runs after tests complete
- ✅ Using `if: always()` ensures upload even on test failure
- ✅ No changes to test code, locators, or architecture (Critical Rule #1)

### 7.2 Medium Risk
- ⚠️ **New Dependency:** TestDino service availability (mitigation: keep HTML reports)
- ⚠️ **Cost:** TestDino pricing model unknown (action: verify free tier limits)
- ⚠️ **Learning Curve:** Team needs to learn new dashboard (mitigation: provide training)

### 7.3 Mitigation Strategy
- Parallel reporting: Keep HTML reports during POC
- Feature branch testing before merging to main
- POC limited to one folder to minimize impact
- Rollback plan: Simply remove TestDino step from workflow

---

## 8. Success Metrics

### 8.1 POC Success Criteria
- [ ] Zero test failures caused by integration
- [ ] JSON reports successfully uploaded to TestDino
- [ ] TestDino dashboard shows test results with correct metadata
- [ ] Historical data visible after 2-3 runs
- [ ] Email notifications working
- [ ] Total setup time < 2 hours

### 8.2 Long-term Success Metrics
- Faster identification of flaky tests (target: detect within 3 runs)
- Reduced time investigating test failures (target: 6-8 hours saved/week)
- Improved test stability (track flakiness rate over time)
- Better visibility into test health (team checks dashboard daily)

---

## 9. Documentation & Knowledge Transfer

### 9.1 Documentation Deliverables
- Updated README in `tests/ui-testing/` with TestDino setup
- TestDino dashboard access guide
- Troubleshooting guide for common issues
- Email notification configuration guide

### 9.2 Checkpoint System (Critical Rule #3)
- Create checkpoint document every 30 minutes or major milestone
- Store in `tests/ui-testing/testDinoPOC/MD Files/Checkpoints/`
- Format: `Checkpoint_YYYYMMDD_HHMM.md`
- Include: current state, completed steps, next steps, blockers

---

## 10. Open Questions & Next Steps

### 10.1 Questions Requiring Research
1. Does TestDino have a free tier? What are the limits?
2. Exact email notification configuration process
3. TestDino support for parallel matrix jobs (11 concurrent runs)
4. Data retention policy in TestDino

### 10.2 Immediate Next Steps
1. **User Review:** Review this PRD with user for approval
2. **User Decisions:** Answer questions in Section 6
3. **Account Setup:** Create TestDino account (or provide existing credentials)
4. **Implementation:** Begin POC implementation upon approval

---

## 11. Appendix

### 11.1 Reference Links
- TestDino: https://testdino.com
- TestDino Docs: https://docs.testdino.com
- TestDino Signup: https://app.testdino.com/auth/signup
- Playwright JSON Reporter: https://playwright.dev/docs/test-reporters#json-reporter

### 11.2 Related Files
- GitHub Workflow: `.github/workflows/playwright.yml`
- Playwright Config: `tests/ui-testing/playwright.config.js`
- Test Files: `tests/ui-testing/playwright-tests/`
- Project Thoughts: `tests/ui-testing/testDinoPOC/MD Files/thoughts.md`

### 11.3 Critical Rules Compliance
✅ **Rule #1:** No changes to test locators, flows, validation logic, or architecture
✅ **Rule #2:** Questions documented in Section 6 for user clarification
✅ **Rule #3:** Checkpoint system defined in Section 9.2

---

## 12. Approval

**Prepared by:** AI Assistant
**Review Required:** User (Shrinath Rao)
**Status:** ⏳ Awaiting Review

**User Decision:**
- [ ] Approved - Proceed with POC
- [ ] Approved with Changes - See comments below
- [ ] Rejected - Provide alternative approach

**User Comments:**
_[Space for user feedback]_

---

**End of PRD**
