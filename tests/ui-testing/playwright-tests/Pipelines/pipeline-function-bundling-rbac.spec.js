// Copyright 2026 OpenObserve Inc.

/**
 * RBAC coverage for pipeline function bundling (#13299 Phase 2).
 *
 * Two behaviours in the feature exist *only* for a user whose function list is
 * filtered, and neither the OSS suite nor root can reach them:
 *
 *   1. A pipeline export whose node names a function the user cannot read leaves
 *      that function out of the file and names it in a warning toast.
 *   2. An import whose bundled name is taken by a function the user cannot SEE.
 *      The resolver's map says the name is free, so it posts — and only the
 *      server knows the name is taken, answering 400 `already exist`. Reading
 *      that as "taken" and walking to the next suffix is the whole reason the
 *      branch exists.
 *
 * Why its own ENT shard rather than appended to the Pipelines shard:
 * `O2_OPENFGA_ENABLED` is read once at server start and is global to the
 * process, so the enterprise gate starts OpenFGA per shard. Appended here it
 * would run against a backend without OpenFGA, where the restricted user sees
 * everything — and both tests would pass while proving nothing.
 *
 * Root bypasses every check, so each enforcement assertion goes through
 * `reqAs()` (no Authorization header; identity is the session cookie) or a
 * browser signed in as the restricted user. `req()` is root and builds and tears
 * down fixtures only.
 */

const { test, expect } = require('../baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const fs = require('fs');
const {
  loginAs,
  MEMBER_PASSWORD,
  createMember,
  rbacEnabled,
  ns,
  uniq,
  req,
  reqAs,
  createRole,
  setRolePerms,
  makeTracker,
} = require('../IAM/iam-fixtures.js');

// Three lowercase letters, distinct from every other spec's namespace, so no
// prefix sweep can mistake one spec's fixtures for another's.
const NS = ns('pfb');
const org = process.env.ORGNAME || 'default';

const vrl = (name, body) => ({ name, function: body, params: 'row', transType: 0 });

const pipelinePayload = (name, functionName, sourceStream) => {
  // Shaped like a file the EXPORT produces, not like a POST /pipelines body: the
  // import screen reads and validates `source.stream_name` / `source.stream_type`
  // and the top-level copies, which the API would otherwise fill in itself.
  const edge = (id, source, target) => ({
    id,
    source,
    target,
    type: 'custom',
    animated: true,
    updatable: true,
    markerEnd: { type: 'arrowclosed', width: 20, height: 20 },
    style: { strokeWidth: 2 },
  });
  return {
    pipeline_id: '',
    version: 0,
    enabled: true,
    org,
    name,
    description: 'rbac bundling fixture',
    source: {
      source_type: 'realtime',
      org_id: org,
      stream_name: sourceStream,
      stream_type: 'logs',
    },
    paused_at: null,
    nodes: [
      {
        id: 'in1',
        position: { x: 100, y: 100 },
        io_type: 'input',
        data: { node_type: 'stream', stream_type: 'logs', stream_name: sourceStream, org_id: org },
      },
      {
        id: 'fn1',
        position: { x: 300, y: 200 },
        io_type: 'default',
        data: { node_type: 'function', name: functionName, after_flatten: true },
      },
      {
        id: 'out1',
        position: { x: 500, y: 300 },
        io_type: 'output',
        data: {
          node_type: 'stream',
          stream_type: 'logs',
          stream_name: `${name}_dest`,
          org_id: org,
        },
      },
    ],
    edges: [edge('e1', 'in1', 'fn1'), edge('e2', 'fn1', 'out1')],
    type: 'realtime',
    stream_name: sourceStream,
    stream_type: 'logs',
  };
};

test.describe(
  'Pipeline function bundling RBAC testcases',
  { tag: ['@pipeline-function-bundling-rbac', '@pipelines', '@functions', '@enterprise'] },
  () => {
    // Every test mutates the same org's roles, functions and pipelines.
    test.describe.configure({ mode: 'default' });

    const tracker = makeTracker();
    // Reads only `visibleFn`, and may create functions — so the resolver's POST
    // is a permission hit, and a 400 can only have come from the name.
    const partialUser = tracker.user(`${NS}_partial@example.com`);
    const partialRole = tracker.role(`${NS}_partial`);

    const stamp = uniq();
    const visibleFn = `${NS}_visible_${stamp}`;
    const hiddenFn = `${NS}_hidden_${stamp}`;
    const pipelineOnHidden = `${NS}_pl_hidden_${stamp}`;

    let hasRbac = false;
    const createdPipelineIds = [];

    test.beforeAll(async ({ browser }) => {
      const page = await browser.newPage();
      try {
        hasRbac = await rbacEnabled(page);
        if (!hasRbac) {
          // An OSS build answers /roles with 403 whatever OpenFGA does, so there
          // is nothing here to test rather than something failing.
          testLogger.warn('RBAC is off on this build; this file will skip');
          return;
        }

        await req(page, 'POST', '/functions', vrl(visibleFn, '.visible = 1'));
        await req(page, 'POST', '/functions', vrl(hiddenFn, '.hidden = 1'));
        const created = await req(
          page,
          'POST',
          '/pipelines',
          pipelinePayload(pipelineOnHidden, hiddenFn, `${NS}_src_${stamp}`),
        );
        if (created.body?.id) createdPipelineIds.push(created.body.id);

        await createMember(page, partialUser, 'user');
        await createRole(page, partialRole);
        // The shape matters, and it is not obvious. AllowList on `_all_` is what
        // permits the list CALL; AllowGet scoped to one object is what makes
        // O2_OPENFGA_LIST_ONLY_PERMITTED filter the result down to it. Granting
        // only the per-object Get — the first thing I tried — answers GET
        // /functions with a blanket 403 rather than a filtered list, and the whole
        // premise of this file collapses.
        //
        // AllowPost is on `_all_` so the resolver's create is a permission hit: a
        // 400 back from it can then only have come from the name being taken,
        // which is the behaviour under test.
        await setRolePerms(
          page,
          partialRole,
          [
            { object: `function:_all_${org}`, permission: 'AllowList' },
            { object: `function:${visibleFn}`, permission: 'AllowGet' },
            { object: `function:_all_${org}`, permission: 'AllowPost' },
            { object: `pipeline:_all_${org}`, permission: 'AllowAll' },
            { object: `stream:_all_${org}`, permission: 'AllowAll' },
          ],
          [],
        );
        await req(page, 'PUT', `/roles/${partialRole}`, {
          add: [],
          remove: [],
          add_users: [partialUser],
          remove_users: [],
        });
      } finally {
        await page.close();
      }
    });

    test.afterAll(async ({ browser }) => {
      const page = await browser.newPage();
      try {
        // Pipelines before functions: a function a pipeline still calls answers 409.
        for (const id of createdPipelineIds) {
          await req(page, 'DELETE', `/pipelines/${id}`).catch(() => {});
        }
        for (const name of [visibleFn, hiddenFn, `${hiddenFn}_1`]) {
          await req(page, 'DELETE', `/functions/${name}`).catch(() => {});
        }
        const gone = await tracker.cleanup(page);
        testLogger.info('RBAC bundling fixtures removed', gone);
      } catch (error) {
        testLogger.warn(`RBAC bundling cleanup failed: ${error.message}`);
      } finally {
        await page.close();
      }
    });

    test.beforeEach(() => {
      test.skip(!hasRbac, 'needs an enterprise build with OpenFGA');
    });

    test(
      'the function list is filtered to what the user may read',
      { tag: ['@P0'] },
      async ({ browser }) => {
        // The premise the other two rest on. Without it they would be asserting
        // against an unfiltered list and could pass for the wrong reason.
        const { context, page } = await loginAs(browser, partialUser, MEMBER_PASSWORD);
        try {
          const { status, body } = await reqAs(page, 'GET', '/functions');
          expect(status).toBeLessThan(400);
          const names = (body?.list ?? []).map((fn) => fn.name);
          expect(names).toContain(visibleFn);
          expect(names).not.toContain(hiddenFn);
        } finally {
          await context.close();
        }
        testLogger.info('Test completed');
      },
    );

    test(
      'an export leaves out a function the user cannot read and names it',
      { tag: ['@P0'] },
      async ({ browser }) => {
        const { context, page } = await loginAs(browser, partialUser, MEMBER_PASSWORD);
        try {
          const pm = new PageManager(page);
          await pm.pipelineImportExport.navigateToList(org);

          const download = await pm.pipelineImportExport.exportPipelineByRow(pipelineOnHidden);
          const file = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));

          // The file cannot carry a body this user cannot read, so the key is
          // absent rather than holding a half-built entry.
          expect(file.functions ?? []).toHaveLength(0);
          // The user is told which name is missing — they are the only one who can
          // get the read granted.
          await pm.pipelineImportExport.expectToast(hiddenFn);
        } finally {
          await context.close();
        }
        testLogger.info('Test completed');
      },
    );

    test(
      'an import copies under the next suffix when the clashing function is invisible',
      { tag: ['@P0'] },
      async ({ browser }) => {
        const { context, page } = await loginAs(browser, partialUser, MEMBER_PASSWORD);
        try {
          const pm = new PageManager(page);
          const imported = `${NS}_pl_copy_${stamp}`;
          const file = pipelinePayload(imported, hiddenFn, `${NS}_src_copy_${stamp}`);
          file.functions = [vrl(hiddenFn, '.from_the_file = 1')];

          await pm.pipelineImportExport.navigateToImport(org);
          await pm.pipelineImportExport.setImportJsonViaMonaco(JSON.stringify(file));
          await pm.pipelineImportExport.runImportAndWaitForList();
        } finally {
          await context.close();
        }

        // Read the outcome as root: the restricted user made the copy but cannot
        // see both names to compare them.
        const probe = await browser.newPage();
        try {
          const { body } = await req(probe, 'GET', '/functions');
          const byName = new Map((body?.list ?? []).map((fn) => [fn.name, fn]));

          expect(byName.has(`${hiddenFn}_1`), 'the invisible clash must land on _1').toBe(true);
          expect(byName.get(`${hiddenFn}_1`).function).toContain('.from_the_file = 1');
          // Never overwritten, which is what keeps the pipeline already using it working.
          expect(byName.get(hiddenFn).function).toContain('.hidden = 1');

          const { body: pipelines } = await req(probe, 'GET', '/pipelines');
          const row = (pipelines?.list ?? []).find((p) => p.name === `${NS}_pl_copy_${stamp}`);
          expect(row, 'the imported pipeline must exist').toBeTruthy();
          if (row?.pipeline_id) createdPipelineIds.push(row.pipeline_id);
          const fnNode = row.nodes.find((n) => n.data?.node_type === 'function');
          expect(fnNode.data.name).toBe(`${hiddenFn}_1`);
        } finally {
          await probe.close();
        }
        testLogger.info('Test completed');
      },
    );
  },
);
