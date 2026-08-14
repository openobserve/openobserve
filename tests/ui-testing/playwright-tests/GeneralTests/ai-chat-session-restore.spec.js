// ai-chat-session-restore.spec.js
//
// E2E for the AI Chat Session Restore (HA) feature.
//
// The `session_owner_unavailable` condition is only organically produced by a real multi-replica
// outage, which a single-node CI cluster cannot create. These tests drive it deterministically by
// intercepting the two HTTP endpoints the O2AIChat panel calls (`**/ai/chat_stream` and
// `**/ai/confirm/**`) with `page.route`, then assert the *rendered* outcomes (restore notice,
// preserved transcript, single resend, inline error blocks) against the real panel.
//
// The unit-level behaviour is covered by web/src/components/O2AIChat.spec.ts; this spec asserts the
// user-visible UI. No data ingestion is required — the panel is driven by mocked HTTP.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// Build a single SSE event line as emitted by the o2-ai backend.
const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`;

test.describe("AI Chat Session Restore (HA) testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Capability probe: the AI panel is gated on enterprise/cloud + `ai.enabled`. If it (or the
    // send input) is unavailable in this environment, skip rather than assert on a dead panel.
    const available = await pm.aiChatPage.openAiPanel();
    if (!available) {
      test.skip(true, 'AI assistant panel is not available/configured in this environment');
      return;
    }
    testLogger.info('Test setup completed');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // P0-1 — Pre-stream 409 session_owner_unavailable restores the conversation
  // and shows the RESTORED_NOTICE.
  // ──────────────────────────────────────────────────────────────────────────
  test("should restore the conversation and show the RESTORED_NOTICE when chat_stream returns a pre-stream 409 session_owner_unavailable", {
    tag: ['@aiChatSessionRestore', '@restore', '@P0', '@all'],
  }, async ({ page }) => {
    testLogger.info('Installing route interception: 1st chat_stream -> 409, 2nd -> 200 text');
    let chatStreamCalls = 0;
    await page.route('**/ai/chat_stream', async (route) => {
      chatStreamCalls += 1;
      if (chatStreamCalls === 1) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ detail: { code: 'session_owner_unavailable' } }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: sse({ type: 'text', text: 'restored reply' }),
        });
      }
    });

    await pm.aiChatPage.typeMessage('how many errors today');
    await pm.aiChatPage.sendMessage();

    await pm.aiChatPage.expectRestoredNoticeVisible();
    await pm.aiChatPage.expectTranscriptText('how many errors today');
    await pm.aiChatPage.expectTranscriptText('restored reply');
    expect(chatStreamCalls).toBe(2);

    testLogger.info('Test completed');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // P0-2 — Mid-stream SSE session_owner_unavailable restores the conversation.
  // ──────────────────────────────────────────────────────────────────────────
  test("should restore the conversation when a session_owner_unavailable error arrives mid-stream over SSE", {
    tag: ['@aiChatSessionRestore', '@restore', '@sse', '@P0', '@all'],
  }, async ({ page }) => {
    testLogger.info('Installing route interception: 1st chat_stream -> 200 SSE error, 2nd -> 200 text');
    let chatStreamCalls = 0;
    await page.route('**/ai/chat_stream', async (route) => {
      chatStreamCalls += 1;
      if (chatStreamCalls === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: sse({ type: 'error', code: 'session_owner_unavailable' }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: sse({ type: 'text', text: 'restored reply' }),
        });
      }
    });

    await pm.aiChatPage.typeMessage('follow-up question');
    await pm.aiChatPage.sendMessage();

    await pm.aiChatPage.expectRestoredNoticeVisible();
    await pm.aiChatPage.expectTranscriptText('follow-up question');
    await pm.aiChatPage.expectTranscriptText('restored reply');
    expect(chatStreamCalls).toBe(2);

    testLogger.info('Test completed');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // P1-1 — A non-owner failure does NOT trigger restore (narrow matching).
  // ──────────────────────────────────────────────────────────────────────────
  test("should not trigger restore for a non-owner generic server failure", {
    tag: ['@aiChatSessionRestore', '@negative', '@P1', '@all'],
  }, async ({ page }) => {
    testLogger.info('Installing route interception: single chat_stream -> 500 generic failure');
    let chatStreamCalls = 0;
    await page.route('**/ai/chat_stream', async (route) => {
      chatStreamCalls += 1;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Server error (503)' }),
      });
    });

    await pm.aiChatPage.typeMessage('status check');
    await pm.aiChatPage.sendMessage();

    // The generic failure surfaces as a normal error; it must NOT claim a restore.
    await pm.aiChatPage.expectTranscriptText('Server error (503)');
    await pm.aiChatPage.expectNoRecoverableNotice();
    expect(chatStreamCalls).toBe(1);

    testLogger.info('Test completed');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // P1-2 — Failed tool-confirmation delivery surfaces an inline error.
  // ──────────────────────────────────────────────────────────────────────────
  test("should surface an inline error when a tool-confirmation cannot be delivered (404)", {
    tag: ['@aiChatSessionRestore', '@confirm', '@P1', '@all'],
  }, async ({ page }) => {
    testLogger.info('Installing route interception: chat_stream emits a pending confirmation, confirm -> 404');
    await page.route('**/ai/chat_stream', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse({
          type: 'confirmation_required',
          tool: 'search_logs',
          message: 'Confirm execution of search_logs?',
          args: {},
        }),
      });
    });
    await page.route('**/ai/confirm/**', async (route) => {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });

    await pm.aiChatPage.typeMessage('search for errors');
    await pm.aiChatPage.sendMessage();

    await pm.aiChatPage.expectConfirmDialogVisible();
    await pm.aiChatPage.clickConfirmApprove();

    await pm.aiChatPage.expectConfirmationDeliveryErrorVisible();

    testLogger.info('Test completed');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // P2-1 — Retry after a mid-stream restore fails -> explicit "could not be
  // restored" message (no silent end, no loop).
  // ──────────────────────────────────────────────────────────────────────────
  test("should show an explicit could-not-be-restored message when the restore retry itself fails", {
    tag: ['@aiChatSessionRestore', '@restore', '@P2', '@all'],
  }, async ({ page }) => {
    testLogger.info('Installing route interception: 1st chat_stream -> 200 SSE error, 2nd (retry) -> 500');
    let chatStreamCalls = 0;
    await page.route('**/ai/chat_stream', async (route) => {
      chatStreamCalls += 1;
      if (chatStreamCalls === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: sse({ type: 'error', code: 'session_owner_unavailable' }),
        });
      } else {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      }
    });

    await pm.aiChatPage.typeMessage('keep going');
    await pm.aiChatPage.sendMessage();

    await pm.aiChatPage.expectCouldNotBeRestoredErrorVisible();
    expect(chatStreamCalls).toBe(2);

    testLogger.info('Test completed');
  });
});
