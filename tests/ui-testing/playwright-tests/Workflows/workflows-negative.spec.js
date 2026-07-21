/**
 * Workflows v1 — Negative / validation sweep (CT-18) + NFR sweep (CT-19)
 *
 * Enterprise-only feature: event(alert_fired) -> action(remote/pipeline destination).
 * Plan: tests/ui-testing/MD_Files/features/workflows/06-consolidated-suite.md (CT-18, CT-19).
 * Findings this spec asserts against (04-execution-log.md):
 *   F-05 (NEG-02) ✅ — trigger-only save is BLOCKED: "Add At Least One Step After The Trigger".
 *   F-01 (K10)        — GET /workflows list is slow (~16-20s live). We time it and soft-assert < 60s.
 *   F-02 (K9)         — Save button tooltip intercepts pointer events; the page object bypasses it
 *                       with a JS .click() (clickSave()). We assert that JS-click path works and
 *                       document (as fixme) that a plain .click() is intercepted.
 *
 * Self-cleaning: every artifact is namespaced `wf_auto_neg_*`; cleanup.spec.js sweeps by prefix.
 * No ingestion needed here (UI validation + list timing + console/network hygiene only).
 *
 * Known quirks handled by the page object: K9 (Save tooltip intercept -> JS click), K10 (~18s list load).
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const uniq = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

test.describe.configure({ mode: 'parallel' });

test.describe(
  'Workflows negative & NFR sweep',
  { tag: ['@workflows', '@workflowsNegative', '@enterprise', '@all'] },
  () => {
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);
      // Enterprise-only feature: these specs run ONLY in the ENT playwright matrix (never wired into
      // OSS), where Workflows is enabled by default. No runtime availability skip — if the feature is
      // missing where this runs, the test must fail loudly rather than silently pass as skipped.
    });

    // =====================================================================
    // CT-18 — Negative & validation sweep (UI)
    // Covers NEG-01 (empty name), NEG-02 (no-sink), NEG-04 (long/unicode/emoji names),
    // NEG-05 (invalid function code -> graceful compile error) and NEG-06 (dead destination
    // URL -> per-node send error, via a Test-run).
    // =====================================================================

    // NEG-02 — CONFIRMED (F-05): a trigger-only workflow cannot be saved; the app requires
    // at least one downstream step. This is a real, working validation -> hard assertion.
    test(
      'CT-18 NEG-02: rejects saving a trigger-only workflow (no sink)',
      { tag: ['@workflowsNegative'] },
      async () => {
        await pm.workflowsPage.goToAdd();
        await pm.workflowsPage.setName(`wf_auto_neg_${uniq()}`);
        const msg = await pm.workflowsPage.saveAndCaptureResult();
        testLogger.info('trigger-only save result', { msg });
        // F-05: exact confirmed copy is "Add At Least One Step After The Trigger".
        expect(msg.toLowerCase()).toContain('at least one step');
      }
    );

    // NEG-01 — empty name must block save (either name-required or the no-step validation fires;
    // either way, save must NOT silently succeed and a message must be surfaced).
    test(
      'CT-18 NEG-01: empty name is blocked on save',
      { tag: ['@workflowsNegative'] },
      async () => {
        await pm.workflowsPage.goToAdd();
        // Leave the name empty; attempt to save.
        const msg = await pm.workflowsPage.saveAndCaptureResult();
        testLogger.info('empty-name save result', { msg });
        // A validation message must appear; the editor must stay on the add page (no navigation away).
        expect(msg.length).toBeGreaterThan(0);
        await pm.workflowsPage.expectEditorVisible();
      }
    );

    // NEG-04 — very long / unicode / emoji names must be handled without a crash.
    // We type each into the name field and assert the app does not blow up: the editor stays
    // rendered, the value round-trips into the field, and a save attempt returns a graceful
    // message (rather than an uncaught error / blank page).
    for (const variant of [
      { label: 'very-long', value: `wf_auto_neg_${uniq()}_${'a'.repeat(300)}` },
      { label: 'unicode', value: `wf_auto_neg_${uniq()}_ﾃｽﾃ｣ｷ_数据_Ω≈ç√` },
      { label: 'emoji', value: `wf_auto_neg_${uniq()}_🚀🔥✅🧪` },
    ]) {
      test(
        `CT-18 NEG-04: handles ${variant.label} name without crashing`,
        { tag: ['@workflowsNegative'] },
        async () => {
          await pm.workflowsPage.goToAdd();
          await pm.workflowsPage.setName(variant.value);
          // Value round-trips into the field (no truncation crash / input rejection blow-up).
          await pm.workflowsPage.expectNameValue(variant.value);
          // Attempt save; app must respond gracefully (a message toast, no uncaught crash).
          const msg = await pm.workflowsPage.saveAndCaptureResult();
          testLogger.info(`${variant.label} name save result`, { msg });
          // Editor must still be rendered (app did not crash to a blank/error page).
          await pm.workflowsPage.expectEditorVisible();
        }
      );
    }

    // NEG-05 — invalid function code is rejected gracefully. Workflow functions run on QuickJS
    // (JavaScript); feeding the inline function editor code that fails to compile must surface a
    // graceful "JS compilation failed" message and keep the editor rendered — never an uncaught
    // app crash. (This is the deterministic guard; runtime-abort surfacing is covered separately.)
    test(
      'CT-18 NEG-05: invalid function code surfaces a graceful error',
      { tag: ['@workflowsNegative'] },
      async () => {
        const id = uniq();
        await pm.workflowsPage.goToAdd();
        await pm.workflowsPage.setName(`wf_auto_neg_${id}`);
        await pm.workflowsPage.addNodeFromPalette('function');
        const msg = await pm.workflowsPage.attemptCreateFunction({
          name: `wf_auto_fn_${id}`,
          code: 'function ((( this is not valid javascript', // fails QuickJS compilation
        });
        testLogger.info('invalid function save result', { msg });
        // A graceful compilation-error message is surfaced (no uncaught crash).
        expect(msg.toLowerCase()).toMatch(/compil|exception|fail|error/);
        // The editor is still rendered — the app degraded gracefully.
        await pm.workflowsPage.expectEditorVisible();
      }
    );

    // NEG-06 — dead / invalid destination URL surfaces a per-node send error. Build
    // Trigger -> Destination pointed at an unreachable URL, save, then Test-run the graph and
    // assert the destination node paints an error badge while the trigger paints ✓.
    test(
      'CT-18 NEG-06: dead destination URL surfaces a per-node send error',
      { tag: ['@workflowsNegative'] },
      async () => {
        const id = uniq();
        const name = `wf_auto_neg_${id}`;
        await pm.workflowsPage.buildTriggerToDestinationAndSave({
          name,
          destName: `wf_auto_dest_${id}`,
          url: 'http://10.255.255.1:9/dead', // non-routable -> send fails
        });
        await pm.workflowsPage.goToList();
        await pm.workflowsPage.openEdit(name);
        await pm.workflowsPage.testRunFromEditor();
        // The destination step fails to send; the trigger step still succeeds.
        await pm.workflowsPage.expectNodeTestError('destination');
        await pm.workflowsPage.expectNodeTestOk('workflow_trigger');
      }
    );

    // =====================================================================
    // CT-19 — NFR sweep (Mixed)
    // Covers REG-06/K10 (list latency), REG-05/K9 (Save-button interception),
    // NFR-03 (console/network hygiene).
    // =====================================================================

    // K10 (F-01) — quantify the workflows list load time. We wrap goToList() in a timer,
    // assert the list eventually renders, log the ms, and soft-assert it stays under 60s.
    // (Live it is ~16-20s; this documents the perf risk without being CI-brittle.)
    test(
      'CT-19 K10: measures workflows list load latency',
      { tag: ['@workflowsNegative'] },
      async () => {
        const start = Date.now();
        await pm.workflowsPage.goToList();
        const loadMs = Date.now() - start;
        testLogger.info('workflows list load latency', { loadMs, note: 'K10 perf risk (~16-20s live)' });
        // It must render at all.
        await pm.workflowsPage.expectListVisible();
        // Soft upper bound — flags a hang/regression, not the known ~18s slowness.
        expect(loadMs).toBeLessThan(60000);
      }
    );

    // K9 (F-02) — the editor Save button's tooltip overlay intercepts pointer events.
    // The page object's clickSave() bypasses it with a JS .click(). Here we assert that
    // JS-click path actually triggers the app's save/validation flow (a toast comes back).
    test(
      'CT-19 K9: Save works via the JS-click path (tooltip-intercept workaround)',
      { tag: ['@workflowsNegative'] },
      async () => {
        await pm.workflowsPage.goToAdd();
        await pm.workflowsPage.setName(`wf_auto_neg_${uniq()}`);
        // clickSave() uses evaluate()+.click() to dodge the o-tooltip-content overlay (K9).
        const msg = await pm.workflowsPage.saveAndCaptureResult();
        testLogger.info('K9 JS-click save produced a response', { msg });
        // The JS-click reached the app: it ran validation (trigger-only) and surfaced a message.
        expect(msg.length).toBeGreaterThan(0);
      }
    );

    // K9 — a NORMAL Playwright .click() on Save is intercepted (Save is covered by the tooltip
    // overlay), which is why the page object saves via a JS .click(). This asserts the bug still
    // reproduces AND that the JS-click workaround reaches the app. If K9 is ever fixed, the first
    // assertion flips and this fails — the signal to drop the workaround from the page object.
    test(
      'CT-19 K9: a normal .click() on Save is intercepted by the tooltip overlay',
      { tag: ['@workflowsNegative'] },
      async () => {
        await pm.workflowsPage.goToAdd();
        await pm.workflowsPage.setName(`wf_auto_neg_${uniq()}`);
        // A plain click cannot land on Save (overlay owns the point).
        expect(await pm.workflowsPage.normalSaveClickIsIntercepted(4000)).toBe(true);
        // The JS-click workaround still reaches the app (validation toast comes back).
        const msg = await pm.workflowsPage.saveAndCaptureResult();
        expect(msg.length).toBeGreaterThan(0);
      }
    );

    // NFR-03 — console / network hygiene on a create+list flow: no uncaught JS errors,
    // no 5xx responses. (4xx from expected validation is tolerated; we only fail on 5xx.)
    test(
      'CT-19 NFR-03: no uncaught JS errors or 5xx during a create+list flow',
      { tag: ['@workflowsNegative'] },
      async ({ page }) => {
        const consoleErrors = [];
        const serverErrors = [];

        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', (err) => {
          consoleErrors.push(`pageerror: ${err.message}`);
        });
        page.on('response', (resp) => {
          const status = resp.status();
          if (status >= 500) serverErrors.push(`${status} ${resp.url()}`);
        });

        // Exercise the editor (create screen) then the list — the two heaviest screens.
        await pm.workflowsPage.goToAdd();
        await pm.workflowsPage.setName(`wf_auto_neg_${uniq()}`);
        await pm.workflowsPage.goToList();

        testLogger.info('console/network hygiene', {
          consoleErrorCount: consoleErrors.length,
          serverErrorCount: serverErrors.length,
          consoleErrors: consoleErrors.slice(0, 10),
          serverErrors: serverErrors.slice(0, 10),
        });

        // No server-side failures on these screens.
        expect(serverErrors, `5xx responses: ${serverErrors.join(', ')}`).toEqual([]);
        // No uncaught JS errors / pageerrors.
        expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
      }
    );
  }
);
