// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const fs = require('fs');
const path = require('path');

const authFile = path.join(__dirname, '../utils/auth/user.json');
const org = process.env.ORGNAME || 'default';

/** Read a download and parse it as JSON. */
const readDownload = async (download) =>
  JSON.parse(fs.readFileSync(await download.path(), 'utf8'));

/**
 * A downloaded pipeline, ready to be posted back.
 *
 * Two things have to change. The id, because the file carries the id of the
 * pipeline it came from. And the source stream: a realtime source stream can
 * only feed one pipeline, so importing a second pipeline off the same stream is
 * refused with "Source stream name is required" — nothing to do with bundling,
 * but it stops the import before the functions are ever reached.
 *
 * The export writes the list row, so the accessor-only columns the table derives
 * (`frequency: "--"` and friends) ride along. The server ignores them.
 */
const reimportable = (file, name, sourceStream) => {
  const next = JSON.parse(JSON.stringify(file));
  next.pipeline_id = '';
  next.name = name;
  next.stream_name = sourceStream;
  next.source.stream_name = sourceStream;
  next.nodes.forEach((node) => {
    if (node.io_type === 'input') node.data.stream_name = sourceStream;
  });
  return next;
};

test.describe(
  'Pipeline function bundling testcases',
  { tag: ['@pipeline-function-bundling', '@pipelines', '@functions', '@all'] },
  () => {
    // Sequential on purpose. These tests share one org's function list, and the
    // afterAll cleanup deletes functions by name prefix across the whole org —
    // under `mode: 'parallel'` the first worker to finish wipes functions the
    // others are still asserting on.
    test.describe.configure({ mode: 'default' });

    let pm;
    const createdPipelineIds = [];

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);
      testLogger.info('Test setup completed');
    });

    test.afterAll(async ({ browser }) => {
      try {
        const cleanupContext = await browser.newContext({ storageState: authFile });
        const cleanupPage = await cleanupContext.newPage();
        try {
          const cleanupPm = new PageManager(cleanupPage);
          // Pipelines first, always: deleting a function a pipeline still calls
          // is refused with a 409 naming the dependents.
          for (const id of createdPipelineIds) {
            await cleanupPm.apiCleanup.deletePipeline(id).catch(() => {});
          }
          await cleanupPm.apiCleanup.cleanupPipelines([], [], [/^pl_bundle_/]);
          await cleanupPm.apiCleanup.cleanupFunctionsInOrg(org, [/^fn_bundle_/]);
        } finally {
          await cleanupContext.close();
        }
      } catch (error) {
        testLogger.warn(`Bundling cleanup failed: ${error.message}`);
      }
    });

    /** Seed a function plus a realtime pipeline that calls it, on its own stream. */
    const seed = async (fnName, pipelineName, body, sourceStream) => {
      await pm.apiCleanup.createFunction(fnName, body, org);
      const id = await pm.apiCleanup.createPipelineUsingFunction(
        pipelineName,
        fnName,
        sourceStream,
        org,
      );
      createdPipelineIds.push(id);
      return id;
    };

    /** Export one pipeline from the list and return the parsed file. */
    const exportFile = async (pipelineName) => {
      await pm.pipelineImportExport.navigateToList(org);
      return await readDownload(
        await pm.pipelineImportExport.exportPipelineByRow(pipelineName),
      );
    };

    /** Import a file and wait for the screen to take itself back to the list. */
    const importFile = async (file) => {
      await pm.pipelineImportExport.navigateToImport(org);
      await pm.pipelineImportExport.setImportJsonViaMonaco(JSON.stringify(file));
      await pm.pipelineImportExport.runImportAndWaitForList();
    };

    /** The function names a created pipeline's nodes point at. */
    const functionNodesOf = async (pipelineName) => {
      const created = (await pm.apiCleanup.fetchPipelines()).find((p) => p.name === pipelineName);
      expect(created, `the imported pipeline ${pipelineName} must exist`).toBeTruthy();
      createdPipelineIds.push(created.pipeline_id);
      return created.nodes
        .filter((node) => node.data?.node_type === 'function')
        .map((node) => node.data.name);
    };

    const functionsNamed = async (prefix) =>
      (await pm.apiCleanup.fetchFunctionsInOrg(org)).filter((fn) => fn.name.startsWith(prefix));

    /**
     * A one-pipeline file written by hand, so a test can bundle something an
     * export would never produce.
     *
     * `functions` is whatever the caller passes; the single function node points
     * at `callsFunction`, which need not be one of them.
     */
    const handWrittenFile = ({ name, sourceStream, callsFunction, functions }) => ({
      pipeline_id: '',
      version: 0,
      enabled: true,
      org,
      name,
      description: 'bundling fixture',
      source: {
        source_type: 'realtime',
        org_id: org,
        stream_name: sourceStream,
        stream_type: 'logs',
      },
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
          data: { node_type: 'function', name: callsFunction, after_flatten: true },
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
      edges: [
        { id: 'e1', source: 'in1', target: 'fn1', type: 'custom', animated: true, updatable: true },
        { id: 'e2', source: 'fn1', target: 'out1', type: 'custom', animated: true, updatable: true },
      ],
      paused_at: null,
      type: 'realtime',
      stream_name: sourceStream,
      stream_type: 'logs',
      functions,
    });

    const vrl = (name, body) => ({ name, function: body, params: 'row', transType: 0 });
    // A bundled JS function is created happily and then refuses to be wired into a
    // function node, which parks the screen with every result line on it. That is
    // the only way to read the lines: a clean import redirects in 400ms.
    const js = (name, body) => ({ name, function: body, params: 'row', transType: 1 });

    /** Paste a file and run the import, leaving the results on screen. */
    const importAndStay = async (file) => {
      await pm.pipelineImportExport.navigateToImport(org);
      await pm.pipelineImportExport.setImportJsonViaMonaco(JSON.stringify(file));
      await pm.pipelineImportExport.runImport();
      await pm.pipelineImportExport.waitForImportOutcome();
      await pm.pipelineImportExport.expectStillOnImportScreen();
    };

    test(
      'should carry the functions a pipeline calls into its export file',
      { tag: ['@P0', '@smoke'] },
      async () => {
        const stamp = Date.now();
        const fnName = `fn_bundle_export_${stamp}`;
        const pipelineName = `pl_bundle_export_${stamp}`;

        await seed(fnName, pipelineName, '.bundled = true', `pl_bundle_src_export_${stamp}`);
        const file = await exportFile(pipelineName);

        expect(file.functions).toHaveLength(1);
        expect(file.functions[0].name).toBe(fnName);
        // save_function appends " \n ." to a VRL body without a return, so the
        // stored body is longer than what was sent.
        expect(file.functions[0].function).toContain('.bundled = true');
        expect(file.functions[0].params).toBe('row');
        expect(file.functions[0].transType).toBe(0);
        // Dropped on the way out: a deprecated association, and a derived count.
        expect(file.functions[0]).not.toHaveProperty('streams');
        expect(file.functions[0]).not.toHaveProperty('numArgs');
        testLogger.info('Test completed');
      },
    );

    test(
      'should recreate a bundled function on import when the name is free',
      { tag: ['@P0', '@smoke'] },
      async () => {
        const stamp = Date.now();
        const fnName = `fn_bundle_round_${stamp}`;
        const pipelineName = `pl_bundle_round_${stamp}`;

        const pipelineId = await seed(
          fnName,
          pipelineName,
          '.round_trip = true',
          `pl_bundle_src_round_${stamp}`,
        );
        const file = await exportFile(pipelineName);

        // Both gone: the import has to put the function back, not find it.
        // Pipeline first — the function delete is refused while it has dependents.
        await pm.apiCleanup.deletePipeline(pipelineId);
        await pm.apiCleanup.deleteFunctionInOrg(org, fnName);

        const newName = `pl_bundle_round_back_${stamp}`;
        await importFile(reimportable(file, newName, `pl_bundle_src_round_back_${stamp}`));

        const names = (await pm.apiCleanup.fetchFunctionsInOrg(org)).map((fn) => fn.name);
        expect(names).toContain(fnName);
        // It runs the logic it was exported with, under the name it was exported with.
        expect(await functionNodesOf(newName)).toEqual([fnName]);
        testLogger.info('Test completed');
      },
    );

    test(
      'should create a copy and repoint the node when the name is taken by different logic',
      { tag: ['@P0'] },
      async () => {
        const stamp = Date.now();
        const fnName = `fn_bundle_clash_${stamp}`;
        const pipelineName = `pl_bundle_clash_${stamp}`;

        await seed(fnName, pipelineName, '.original = true', `pl_bundle_src_clash_${stamp}`);
        const file = await exportFile(pipelineName);

        // The name now holds different logic. A PUT, not delete-and-recreate:
        // the original pipeline stays alive so the test can show it is untouched.
        await pm.apiCleanup.updateFunction(fnName, '.replaced = true', org);

        const newName = `pl_bundle_clash_copy_${stamp}`;
        await importFile(reimportable(file, newName, `pl_bundle_src_clash_copy_${stamp}`));

        const functions = await pm.apiCleanup.fetchFunctionsInOrg(org);
        const original = functions.find((fn) => fn.name === fnName);
        const copy = functions.find((fn) => fn.name === `${fnName}_1`);

        expect(copy, 'the clash must land under the first free suffix').toBeTruthy();
        expect(copy.function).toContain('.original = true');
        // Never overwritten: that is what keeps every other pipeline unchanged.
        expect(original.function).toContain('.replaced = true');

        expect(await functionNodesOf(newName)).toEqual([`${fnName}_1`]);
        // And the pipeline that was already there still calls the original.
        expect(await functionNodesOf(pipelineName)).toEqual([fnName]);
        testLogger.info('Test completed');
      },
    );

    test(
      'should write nothing when the bundled function already holds the same logic',
      { tag: ['@P1'] },
      async () => {
        const stamp = Date.now();
        const fnName = `fn_bundle_same_${stamp}`;
        const pipelineName = `pl_bundle_same_${stamp}`;

        await seed(fnName, pipelineName, '.same = true', `pl_bundle_src_same_${stamp}`);
        const file = await exportFile(pipelineName);

        const newName = `pl_bundle_same_again_${stamp}`;
        await importFile(reimportable(file, newName, `pl_bundle_src_same_again_${stamp}`));

        // The body the file carries is the one the server already stores, down to
        // the trailing dot it appended, so no copy is made.
        expect(await functionsNamed(fnName)).toHaveLength(1);
        expect(await functionNodesOf(newName)).toEqual([fnName]);
        testLogger.info('Test completed');
      },
    );

    test(
      'should reuse the copy on a second import rather than make another',
      { tag: ['@P1'] },
      async () => {
        const stamp = Date.now();
        const fnName = `fn_bundle_twice_${stamp}`;
        const pipelineName = `pl_bundle_twice_${stamp}`;

        await seed(fnName, pipelineName, '.first = true', `pl_bundle_src_twice_${stamp}`);
        const file = await exportFile(pipelineName);
        await pm.apiCleanup.updateFunction(fnName, '.second = true', org);

        for (const suffix of ['a', 'b']) {
          await importFile(
            reimportable(
              file,
              `pl_bundle_twice_${suffix}_${stamp}`,
              `pl_bundle_src_twice_${suffix}_${stamp}`,
            ),
          );
        }

        const copies = await functionsNamed(fnName);
        // _1 already carries the file's logic, so the second import reuses it.
        expect(copies.map((fn) => fn.name).sort()).toEqual([fnName, `${fnName}_1`]);

        for (const suffix of ['a', 'b']) {
          expect(await functionNodesOf(`pl_bundle_twice_${suffix}_${stamp}`)).toEqual([
            `${fnName}_1`,
          ]);
        }
        testLogger.info('Test completed');
      },
    );

    // ---- what only a browser can check: how the lines actually render ----

    test(
      'should render the two-bodies clash as prose, not a pushed object',
      { tag: ['@P0'] },
      async () => {
        // The error list renders a pushed object only when the template has a
        // branch for its `field`; anything else reaches `{{ errorMessage }}` and
        // the user is shown the JSON. Asserting on the pushed value cannot see
        // that, which is how it shipped once already.
        const stamp = Date.now();
        const fnName = `fn_bundle_dup_${stamp}`;

        await importAndStay(
          handWrittenFile({
            name: `pl_bundle_dup_${stamp}`,
            sourceStream: `pl_bundle_src_dup_${stamp}`,
            callsFunction: fnName,
            functions: [vrl(fnName, '.one = 1'), vrl(fnName, '.two = 2')],
          }),
        );

        const errors = await pm.pipelineImportExport.getImportErrors();
        const conflict = errors.find((line) => line.includes('two different bodies'));
        expect(conflict, `expected the clash to be reported; got ${JSON.stringify(errors)}`).toBeTruthy();
        expect(conflict).toContain(fnName);
        // The tells of an object that fell through to the fallback branch.
        expect(conflict).not.toContain('"field"');
        expect(conflict).not.toContain('"message"');

        expect(await functionsNamed(fnName)).toHaveLength(0);
        testLogger.info('Test completed');
      },
    );

    test(
      'should name a created function in the results, before the pipeline line',
      { tag: ['@P0'] },
      async () => {
        const stamp = Date.now();
        const fnName = `fn_bundle_line_${stamp}`;
        const pipelineName = `pl_bundle_line_${stamp}`;

        await importAndStay(
          handWrittenFile({
            name: pipelineName,
            sourceStream: `pl_bundle_src_line_${stamp}`,
            callsFunction: fnName,
            functions: [js(fnName, 'function transform(row){ return row; }')],
          }),
        );

        const lines = await pm.pipelineImportExport.getCreationMessages();
        expect(lines[0]).toContain(`function "${fnName}" created`);
        expect(lines[1]).toContain('creation failed');

        // The function stays: it has no dependents, so the user can delete it,
        // and a retry reuses it. Naming it is what makes that possible.
        expect(await functionsNamed(fnName)).toHaveLength(1);
        testLogger.info('Test completed');
      },
    );

    test(
      'should name the copy it made when the bundled name is taken',
      { tag: ['@P0'] },
      async () => {
        const stamp = Date.now();
        const fnName = `fn_bundle_copyline_${stamp}`;
        const pipelineName = `pl_bundle_copyline_${stamp}`;

        await pm.apiCleanup.createFunction(fnName, '.held = true', org);

        await importAndStay(
          handWrittenFile({
            name: pipelineName,
            sourceStream: `pl_bundle_src_copyline_${stamp}`,
            callsFunction: fnName,
            functions: [js(fnName, 'function transform(row){ return row; }')],
          }),
        );

        const lines = await pm.pipelineImportExport.getCreationMessages();
        // The one line the spec marks as required: it is the only signal that a
        // duplicate function now exists.
        expect(lines[0]).toContain(`already exists with different logic, created "${fnName}_1"`);
        // The failure names the copy, which proves the node was repointed before
        // the pipeline was posted.
        expect(lines[1]).toContain(`${fnName}_1`);

        const copies = await functionsNamed(fnName);
        expect(copies.map((fn) => fn.name).sort()).toEqual([fnName, `${fnName}_1`]);
        testLogger.info('Test completed');
      },
    );

    test(
      'should report the functions the file could not carry',
      { tag: ['@P1'] },
      async () => {
        // The RBAC-trimmed export: the file bundles some functions but not the one
        // this node calls. The node still resolves from the org, so the pipeline is
        // not blocked — the user is just told the file was short.
        const stamp = Date.now();
        const calls = `fn_bundle_nb_calls_${stamp}`;
        const unrelated = `fn_bundle_nb_spare_${stamp}`;

        await pm.apiCleanup.createJsFunction(
          calls,
          'function transform(row){ return row; }',
          org,
        );

        await importAndStay(
          handWrittenFile({
            name: `pl_bundle_nb_${stamp}`,
            sourceStream: `pl_bundle_src_nb_${stamp}`,
            callsFunction: calls,
            functions: [vrl(unrelated, '.spare = 1')],
          }),
        );

        const lines = await pm.pipelineImportExport.getCreationMessages();
        expect(lines[0]).toContain('functions not included in the export file');
        expect(lines[0]).toContain(calls);

        // A bundled function no node calls is never created — creating it would be
        // a surprise.
        expect(await functionsNamed(unrelated)).toHaveLength(0);
        testLogger.info('Test completed');
      },
    );

    // ---- multi-item files and bulk export ----

    test(
      'should create a shared function once for two pipelines in one file',
      { tag: ['@P1'] },
      async () => {
        const stamp = Date.now();
        const fnName = `fn_bundle_shared_${stamp}`;
        const names = [`pl_bundle_shared_a_${stamp}`, `pl_bundle_shared_b_${stamp}`];

        const file = names.map((name, i) =>
          handWrittenFile({
            name,
            sourceStream: `pl_bundle_src_shared_${i}_${stamp}`,
            callsFunction: fnName,
            functions: [vrl(fnName, '.shared = true')],
          }),
        );

        await importFile(file);

        // The second pipeline reuses what the first created, rather than finding
        // the name taken and making a copy.
        expect((await functionsNamed(fnName)).map((fn) => fn.name)).toEqual([fnName]);
        for (const name of names) {
          expect(await functionNodesOf(name)).toEqual([fnName]);
        }
        testLogger.info('Test completed');
      },
    );

    test(
      'should carry each pipeline\'s own functions through a bulk export',
      { tag: ['@P1'] },
      async () => {
        const stamp = Date.now();
        const withFn = `pl_bundle_bulk_fn_${stamp}`;
        const withoutFn = `pl_bundle_bulk_plain_${stamp}`;
        const fnName = `fn_bundle_bulk_${stamp}`;

        await seed(fnName, withFn, '.bulk = true', `pl_bundle_src_bulk_${stamp}`);

        // A pipeline with no function node at all, to show it gets no key.
        createdPipelineIds.push(
          await pm.apiCleanup.createPlainPipeline(
            withoutFn,
            `pl_bundle_src_bulk_plain_${stamp}`,
            org,
          ),
        );

        await pm.pipelineImportExport.navigateToList(org);
        await pm.pipelineImportExport.selectAllRows();
        const file = await readDownload(await pm.pipelineImportExport.clickBulkExport());

        // Still an array of pipelines, each carrying its own key, so the import
        // loop does not change shape.
        expect(Array.isArray(file)).toBe(true);
        const exported = Object.fromEntries(file.map((p) => [p.name, p]));
        expect(exported[withFn].functions.map((f) => f.name)).toEqual([fnName]);
        expect(exported[withoutFn]).not.toHaveProperty('functions');
        testLogger.info('Test completed');
      },
    );

    test(
      'should still demand a remap for a file that bundles nothing',
      { tag: ['@P1'] },
      async () => {
        const stamp = Date.now();
        const fnName = `fn_bundle_old_${stamp}`;
        const pipelineName = `pl_bundle_old_${stamp}`;

        const pipelineId = await seed(
          fnName,
          pipelineName,
          '.old_file = true',
          `pl_bundle_src_old_${stamp}`,
        );
        const file = await exportFile(pipelineName);

        await pm.apiCleanup.deletePipeline(pipelineId);
        await pm.apiCleanup.deleteFunctionInOrg(org, fnName);

        // A file written before Phase 2 carries no functions key at all.
        const oldFile = reimportable(
          file,
          `pl_bundle_old_back_${stamp}`,
          `pl_bundle_src_old_back_${stamp}`,
        );
        delete oldFile.functions;

        await pm.pipelineImportExport.navigateToImport(org);
        await pm.pipelineImportExport.setImportJsonViaMonaco(JSON.stringify(oldFile));
        await pm.pipelineImportExport.runImport();
        await pm.pipelineImportExport.waitForImportOutcome();

        // Nothing to create the function from, so the remap control is still the
        // only way through.
        await pm.pipelineImportExport.expectStillOnImportScreen();
        await pm.pipelineImportExport.expectImportError(0, 0);
        const names = (await pm.apiCleanup.fetchFunctionsInOrg(org)).map((fn) => fn.name);
        expect(names).not.toContain(fnName);
        testLogger.info('Test completed');
      },
    );
  },
);
