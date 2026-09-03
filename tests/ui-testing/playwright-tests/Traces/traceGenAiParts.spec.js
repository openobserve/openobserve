// traceGenAiParts.spec.js
// Tests for OpenObserve Traces — GenAI v5 `parts` rendering in the trace detail
// sidebar's Preview pane (and the Thread tab). Verifies that OTel GenAI semconv
// v5 message parts (text/reasoning/thinking/tool_call/tool_call_response) render
// as readable text — never raw JSON dumps or base64 payloads — and that the
// system-instructions collapsible, tool-observation view, and truncation/expand
// all behave as documented.

const { test, expect, navigateToBase, generateUUID } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Traces GenAI v5 Parts Rendering testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.tracesPage.navigateToTracesUrl();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  /**
   * Navigate to the freshly-ingested span and open its LLM Preview pane:
   * select stream → 15m → run search → open trace → click the LLM span in the
   * tree → the sidebar defaults to the Preview tab.
   */
  async function openGenAiPreview(pm, streamName, spanName) {
    await pm.tracesPage.selectTraceStream(streamName);
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runTraceSearch();
    await pm.tracesPage.waitForTraceSearchResults();
    await pm.tracesPage.clickFirstTraceResult();
    const clicked = await pm.tracesPage.clickTraceTreeSpanByOperationName(spanName);
    expect(clicked).toBeTruthy();
    await pm.tracesPage.expectPreviewTabVisible();
  }

  test("should render v5 parts conversation in the Preview pane (reasoning / tool_call / tool_call_response)", {
    tag: ['@genai-v5-parts', '@traces', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing v5 parts conversation rendering in the Preview pane');

    const suffix = generateUUID();
    const streamName = `trace-genai-parts-${suffix}`;
    const spanName = `chat ${suffix}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
      name: spanName,
      kind: 2,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.input.messages': JSON.stringify([
          { role: 'user', parts: [{ type: 'text', content: "What's the weather in Boston?" }] },
          { role: 'assistant', parts: [
            { type: 'reasoning', content: 'I should check the weather.' },
            { type: 'tool_call', name: 'get_weather', arguments: { city: 'Boston' } },
          ] },
        ]),
        'gen_ai.output.messages': JSON.stringify([
          { role: 'tool', parts: [{ type: 'tool_call_response', result: 'rainy, 57F' }] },
        ]),
      },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(streamName, spanName);

    await openGenAiPreview(pm, streamName, spanName);

    await pm.tracesPage.expectLlmInputContains('I should check the weather.');
    await pm.tracesPage.expectLlmInputContains('get_weather');
    await pm.tracesPage.expectLlmOutputContains('rainy, 57F');
    await pm.tracesPage.expectLlmInputNotContains('"type":"tool_call"');

    testLogger.info('Test completed');
  });

  test("should render System Instructions via v5 parts as a collapsible", {
    tag: ['@genai-v5-parts', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing System Instructions rendering via v5 parts');

    const suffix = generateUUID();
    const streamName = `trace-genai-parts-${suffix}`;
    const spanName = `chat ${suffix}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
      name: spanName,
      kind: 2,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.input.messages': JSON.stringify([
          { role: 'assistant', parts: [{ type: 'reasoning', content: 'I should check the weather.' }] },
        ]),
        'gen_ai.output.messages': JSON.stringify([
          { role: 'tool', parts: [{ type: 'tool_call_response', result: 'rainy, 57F' }] },
        ]),
        'gen_ai.system.instructions': JSON.stringify([
          { type: 'reasoning', content: 'Always be concise.' },
        ]),
      },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(streamName, spanName);

    await openGenAiPreview(pm, streamName, spanName);

    await pm.tracesPage.expectSystemInstructionsVisible();
    await pm.tracesPage.expandSystemInstructions();
    await pm.tracesPage.expectSystemInstructionsContains('Always be concise.');

    testLogger.info('Test completed');
  });

  test("should render thinking / result real-world aliases", {
    tag: ['@genai-v5-parts', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing thinking / result real-world aliases');

    const suffix = generateUUID();
    const streamName = `trace-genai-parts-${suffix}`;
    const spanName = `chat ${suffix}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
      name: spanName,
      kind: 2,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.input.messages': JSON.stringify([
          { role: 'assistant', parts: [{ type: 'thinking', content: 'let me check' }] },
        ]),
        'gen_ai.output.messages': JSON.stringify([
          { role: 'tool', parts: [{ type: 'tool_call_response', result: 'rainy, 57F' }] },
        ]),
      },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(streamName, spanName);

    await openGenAiPreview(pm, streamName, spanName);

    await pm.tracesPage.expectLlmInputContains('let me check');
    await pm.tracesPage.expectLlmOutputContains('rainy, 57F');

    testLogger.info('Test completed');
  });

  test("should render execute_tool span as a tool-observation view", {
    tag: ['@genai-v5-parts', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing execute_tool span tool-observation rendering');

    const suffix = generateUUID();
    const streamName = `trace-genai-parts-${suffix}`;
    const spanName = `execute_tool ${suffix}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
      name: spanName,
      kind: 2,
      attributes: {
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': 'calculator',
        'gen_ai.tool.call.id': 'call-123',
        'gen_ai.tool.call.arguments': '{"operation":"add","numbers":[1,2]}',
        'gen_ai.tool.call.result': '{"result":3}',
        // The Preview renderer is v-if="hasContent(previewInput/previewOutput)";
        // a tool span MUST also carry non-empty messages or it shows "No data".
        'gen_ai.input.messages': '{"operation":"add","numbers":[1,2]}',
        'gen_ai.output.messages': '{"result":3}',
      },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(streamName, spanName);

    await openGenAiPreview(pm, streamName, spanName);

    await pm.tracesPage.expectToolContentVisible();
    await pm.tracesPage.expectToolContentContains('Tool: calculator');
    await pm.tracesPage.expectToolContentContains('Call ID: call-123');

    testLogger.info('Test completed');
  });

  test("should render blob / file / uri parts as placeholders (never base64)", {
    tag: ['@genai-v5-parts', '@traces', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing blob / file / uri placeholder rendering');

    const suffix = generateUUID();
    const streamName = `trace-genai-parts-${suffix}`;
    const spanName = `chat ${suffix}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
      name: spanName,
      kind: 2,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.input.messages': JSON.stringify([
          { role: 'assistant', parts: [
            { type: 'blob', modality: 'image', mime_type: 'image/png', content: 'aGVsbG8=' },
            { type: 'file', file_id: 'file-abc123', content: 'ZmlsZQ==' },
            { type: 'uri', uri: 'https://example.com/genai.png' },
          ] },
        ]),
      },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(streamName, spanName);

    await openGenAiPreview(pm, streamName, spanName);

    // Each suppressed part type renders its own friendly placeholder...
    await pm.tracesPage.expectLlmInputContains('[image: image/png]');
    await pm.tracesPage.expectLlmInputContains('[File: file-abc123]');
    await pm.tracesPage.expectLlmInputContains('[Uri: https://example.com/genai.png]');
    // ...and the raw base64 payloads are never exposed.
    await pm.tracesPage.expectLlmInputNotContains('aGVsbG8=');
    await pm.tracesPage.expectLlmInputNotContains('ZmlsZQ==');

    testLogger.info('Test completed');
  });

  test("should truncate long content with an expand/collapse button", {
    tag: ['@genai-v5-parts', '@traces', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing truncation and expand/collapse behaviour');

    const suffix = generateUUID();
    const streamName = `trace-genai-parts-${suffix}`;
    const spanName = `chat ${suffix}`;

    const textParts = Array.from({ length: 20 }, (_, i) => ({ type: 'text', content: `line ${i} of content` }));

    await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
      name: spanName,
      kind: 2,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.input.messages': JSON.stringify([
          { role: 'assistant', parts: textParts },
        ]),
      },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(streamName, spanName);

    await openGenAiPreview(pm, streamName, spanName);

    // >15 joined lines → truncated preview with an expand button.
    await pm.tracesPage.expectLlmExpandButtonVisible();

    // Expand: full content (the late lines are now visible) + collapse button.
    await pm.tracesPage.clickLlmExpandButton();
    await pm.tracesPage.expectLlmCollapseButtonVisible();
    await pm.tracesPage.expectLlmInputContains('line 19 of content');

    // Collapse: back to the truncated preview with the expand button again.
    await pm.tracesPage.clickLlmCollapseButton();
    await pm.tracesPage.expectLlmExpandButtonVisible();

    testLogger.info('Test completed');
  });

  test("should render v5 parts in the Thread tab", {
    tag: ['@genai-v5-parts', '@traces', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing v5 parts rendering in the Thread tab');

    const suffix = generateUUID();
    const streamName = `trace-genai-parts-${suffix}`;
    const spanName = `chat ${suffix}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
      name: spanName,
      kind: 2,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.input.messages': JSON.stringify([
          { role: 'user', parts: [{ type: 'text', content: "What's the weather in Boston?" }] },
          { role: 'assistant', parts: [
            { type: 'reasoning', content: 'I should check the weather.' },
            { type: 'tool_call', name: 'get_weather', arguments: { city: 'Boston' } },
          ] },
        ]),
        'gen_ai.output.messages': JSON.stringify([
          { role: 'tool', parts: [{ type: 'tool_call_response', result: 'rainy, 57F' }] },
        ]),
      },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(streamName, spanName);

    await pm.tracesPage.selectTraceStream(streamName);
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runTraceSearch();
    await pm.tracesPage.waitForTraceSearchResults();
    await pm.tracesPage.clickFirstTraceResult();

    const opened = await pm.tracesPage.openTraceDetailsTab('thread');
    expect(opened).toBeTruthy();
    await pm.tracesPage.expectThreadViewContains('I should check the weather.');

    testLogger.info('Test completed');
  });
});
