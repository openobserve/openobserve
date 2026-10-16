// Copyright 2026 OpenObserve Inc.
// Mock payloads for every AI endpoint the OpenObserve UI calls. Shapes follow
// web/src/services/ai_chat_share.ts, web/src/composables/useAiChat.ts,
// web/src/composables/useChatHistory.ts and o2-ai/src/server (SSE events).

const US = 1000; // ms -> µs multiplier
const NOW = Date.now();

/** UUIDv7 whose first 48 bits are `ms`, as the UI derives chat ids from them. */
export function uuidv7(ms, salt = 0) {
  const ts = Math.floor(ms).toString(16).padStart(12, "0");
  const rnd = (n) =>
    Array.from({ length: n }, (_, i) => ((salt * 7919 + i * 104729 + ms) % 16).toString(16)).join("");
  return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-7${rnd(3)}-a${rnd(3)}-${rnd(12)}`;
}

// ---------------------------------------------------------------------------
// Config gating: fields flipped on /config and /api/{org}/config responses.
// ---------------------------------------------------------------------------
export const CONFIG_PATCH = {
  ai_enabled: true, // gates every AI affordance (Header.vue:693, HomeView.vue:268, O2AIContextAddBtn.vue:4 ...)
  ai_chat_persistence_enabled: true, // server history + sharing (useAiChat.ts chatHistoryServer, chatShare.ts:103)
  public_ai_chat_enabled: true, // public link option in the share dialog (chatShare.ts:106)
  public_ai_chat_max_expiry_days: 30,
};

// ---------------------------------------------------------------------------
// SSE frame builders (o2-ai EventType, src/server/constants.py:27-46).
// ---------------------------------------------------------------------------
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
};

// HTTP-level scenarios: the chat_stream request itself is refused before streaming.
export const HTTP_SCENARIOS = {
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

// ---------------------------------------------------------------------------
// Chat history (server persistence) and shares.
// ---------------------------------------------------------------------------
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
    active_turn: false,
    turns: [
      {
        user_message_id: `msg_${c.session_id.slice(-6)}`,
        turn_id: uuidv7(c.created_at / US + 1000, 99),
        created: c.created_at,
        user: { text: c.user },
        frames: c.frames,
        status: "completed",
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
