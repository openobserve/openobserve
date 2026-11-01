// Copyright 2026 OpenObserve Inc.
// Shared Playwright setup: AI endpoint mocks, config gating patch, backend rewrite, login.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHATS,
  CONFIG_PATCH,
  HTTP_SCENARIOS,
  SCENARIOS,
  SHARES,
  ACTIVITY,
  GRANTS,
  TOOLSETS,
  TOOLSET_HEALTH,
  TOOLSET_RECORDS,
  chatDetail,
  chatSummary,
  overageStatus,
  sharedChat,
} from "./mocks.mjs";
import { MODE, enforceMode, isStack, mockOnly } from "./modes.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// Loaded only for stack runs, so mock-mode scripts outside the Playwright runner never import the test module.
const stackTest = isStack() ? (await import("@playwright/test")).test : null;

/** Captures, axe reports and telemetry exports of a run; the nightly workflows upload this folder. */
export const OUT = join(here, "out");

// CI serves UI and API from one origin (ZO_BASE_URL); O2_VITE_DEV points at a Vite dev server whose bundle talks to O2_API_ORIGIN.
const VITE_DEV = !!process.env.O2_VITE_DEV;
const SAME_ORIGIN = !VITE_DEV && process.env.ZO_BASE_URL ? process.env.ZO_BASE_URL.replace(/\/$/, "") : "";

export const ENV = {
  // Where the app is served.
  appUrl: SAME_ORIGIN ? `${SAME_ORIGIN}/web` : process.env.O2_APP_URL || "http://localhost:8093/web",
  // The API origin baked into the bundle (web/.env VITE_OPENOBSERVE_ENDPOINT).
  apiOrigin: SAME_ORIGIN || process.env.O2_API_ORIGIN || "http://localhost:5080",
  // Where non-AI API calls really go; set when the apiOrigin server is not running.
  backend: SAME_ORIGIN ? "" : process.env.O2_BACKEND || "",
  // Same variables as every tests/ui-testing suite; there are no built-in credentials.
  user: process.env.ZO_ROOT_USER_EMAIL || process.env.O2_USER || "",
  pass: process.env.ZO_ROOT_USER_PASSWORD || process.env.O2_PASS || "",
  org: process.env.ORGNAME || process.env.O2_ORG || "default",
  viteDev: VITE_DEV,
};

// The `role` knob as the login response names it; "custom" stands for any custom role (00 §9 probes it).
const ROLE_NAMES = { admin: "admin", editor: "editor", viewer: "viewer", user: "user", custom: "sre-oncall" };

const json = (route, body, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": route.request().headers()["origin"] || "*",
      "access-control-allow-credentials": "true",
    },
    body: JSON.stringify(body),
  });

// Keys the harness itself touches in a stack run; `then` because an async function's return value is probed for it.
const STACK_SAFE_KEYS = new Set(["overrides", "then", "toJSON", "constructor"]);

// The server's share requests are deny_unknown_fields; hide_attachments exists only where /config advertises it.
const CREATE_SHARE_FIELDS = ["mode", "visibility", "expires_in_secs", "redact_tools"];
const UPDATE_SHARE_FIELDS = ["mode", "expires_in_secs", "refresh_snapshot", "redact_tools"];
const unknownShareFields = (body, allowed, state) =>
  Object.keys(body).find((k) => !allowed.includes(k) && !(k === "hide_attachments" && state.configPatch.ai_share_redact_attachments === true));

/** Mutable per-context mock state; knobs past the first block are no-ops until their WP fills them in (99 §5). */
export function createMockState(overrides = {}) {
  const state = {
    chats: CHATS.map((c) => ({ ...c })),
    shares: SHARES.map((s) => ({ ...s })),
    overage: overageStatus(),
    configPatch: { ...CONFIG_PATCH },
    historyStatus: 200, // set to 500 to show the "history unavailable" state
    sharesStatus: 200,
    sharedChatStatus: 200,
    log: [],
    // Config patches; undefined keeps CONFIG_PATCH.
    persistence: undefined,
    publicLinks: undefined,
    aiEnabled: undefined,
    // Next AI call answers 401 once (expireSession).
    expireNext: false,
    // admin | editor | viewer | user | custom
    role: "admin",
    // B-06 capabilities probe (404 while off).
    capabilitiesEnabled: false,
    capabilities: null,
    // B-01 error envelope, B-02 lifecycle frames, B-03 tail, B-04 decisions, B-05 policy, B-07 ephemeral turns.
    envelopeEnabled: false,
    lifecycleFramesEnabled: false,
    tailEnabled: false,
    decisionFramesEnabled: false,
    policyEnforced: false,
    ephemeralEnabled: false,
    // Credits and consent: GET /ai/usage body and statuses of the usage, overage and consent PUT calls.
    usage: null,
    usageStatus: 200,
    overageStatus: 200,
    consentPutStatus: 200,
    // An Enable that takes this long, so a cancel can land while it is on its way.
    consentPutDelayMs: 0,
    // B-14 settings, B-15 toolset health, B-16 grants, B-17 activity, B-11 secret merge, B-12 import.
    settingsEnabled: false,
    settings: null,
    // Every PUT /ai/settings body, in order.
    settingsPuts: [],
    // POST /ai/capabilities/test answers in order (then ok), and how long each takes.
    capabilitiesTestResults: [],
    capabilitiesTestDelayMs: 0,
    toolsetHealthEnabled: false,
    // GET /ai/toolsets: status, delay and rows (null keeps TOOLSETS); every write lands in toolsetWrites as { method, id, body }.
    toolsetsStatus: 200,
    toolsetsDelayMs: 0,
    toolsets: null,
    toolsetWrites: [],
    // POST /ai/toolsets/{id}/test answers in order (then ok).
    toolsetTestResults: [],
    grantsEnabled: false,
    grants: null,
    activityEnabled: false,
    activity: null,
    secretMergeEnabled: false,
    importEnabled: false,
    // B-12 server search (`q` on GET /ai/chats) and server pins (`pinned` on rows and PATCH); B-03 list markers.
    historySearchEnabled: false,
    historyPinsEnabled: false,
    listMarkersEnabled: false,
    // POST /ai/chats/import refuses these chat titles one by one (per-chat failures).
    importFailTitles: [],
    // DELETE /ai/chats/{sid} answers this status.
    deleteStatus: 200,
    // GET /ai/chats/{sid} leaves out approval cards, as today's o2-ai history projection does.
    historyDropsCards: false,
    // Two orgs for org-switch flows.
    orgs: null,
    // Stop: delay and status of POST /ai/chats/{sid}/cancel.
    cancelDelayMs: 0,
    cancelStatus: 200,
    // /confirm: its status (500 = confirm_500) and the delete items it fails with 403.
    confirmStatus: 200,
    confirmFail: [],
    confirmUndoable: false,
    // The access probe (00 §9): status (default 403 for viewer, 404 otherwise) and a delay past its 5 s timeout.
    probeStatus: null,
    probeDelayMs: 0,
    ...overrides,
  };
  // Stack modes cannot honour a knob, so installMocks skips flows that set any.
  Object.defineProperty(state, "overrides", { value: Object.keys(overrides), enumerable: false });
  return isStack() ? mockOnlyState(state) : state;
}

/** In a stack mode, reading or writing any mock knob or request log skips the flow instead of asserting against nothing. */
function mockOnlyState(state) {
  const guard = (key) => {
    if (typeof key === "symbol" || STACK_SAFE_KEYS.has(key)) return;
    try {
      stackTest.info();
    } catch {
      // Scripts outside the Playwright runner have no flow to skip.
      return;
    }
    stackTest.skip(true, `the mock state "${key}" is mock-only; ${MODE} asserts structure against the real server`);
  };
  return new Proxy(state, {
    get(target, key, receiver) {
      guard(key);
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      guard(key);
      return Reflect.set(target, key, value, receiver);
    },
  });
}

/** Response headers with CORS collapsed to single values (the backend can emit them twice). */
function cleanHeaders(response, request) {
  const headers = {};
  for (const { name, value } of response.headersArray()) {
    const key = name.toLowerCase();
    if (key.startsWith("access-control-") || key === "content-length" || key === "content-encoding") continue;
    headers[key] = key in headers && key !== "set-cookie" ? headers[key] : (key === "set-cookie" && headers[key] ? `${headers[key]}\n${value}` : value);
  }
  headers["access-control-allow-origin"] = request.headers()["origin"] || ENV.appUrl.replace(/\/web$/, "");
  headers["access-control-allow-credentials"] = "true";
  headers["access-control-expose-headers"] = "*";
  return headers;
}

async function passthrough(route, request) {
  if (!ENV.backend) return route.continue();
  const url = request.url().replace(ENV.apiOrigin, ENV.backend);
  try {
    const response = await route.fetch({ url, maxRedirects: 0 });
    return route.fulfill({ status: response.status(), headers: cleanHeaders(response, request), body: await response.body() });
  } catch (e) {
    return route.abort();
  }
}

async function patchedConfig(route, request, state) {
  const url = ENV.backend ? request.url().replace(ENV.apiOrigin, ENV.backend) : request.url();
  const response = await route.fetch({ url });
  let body = {};
  try {
    body = await response.json();
  } catch (_) {}
  const knobs = {
    ...(state.persistence !== undefined && { ai_chat_persistence_enabled: state.persistence }),
    ...(state.publicLinks !== undefined && { public_ai_chat_enabled: state.publicLinks }),
    ...(state.aiEnabled !== undefined && { ai_enabled: state.aiEnabled }),
    // A non-admin role only means something with RBAC on; the OSS test backend reports it off.
    ...(state.role !== "admin" && state.configPatch.rbac_enabled === undefined && { rbac_enabled: true }),
  };
  return route.fulfill({ status: response.status(), headers: { ...cleanHeaders(response, request), "content-type": "application/json" }, body: JSON.stringify({ ...body, ...state.configPatch, ...knobs }) });
}

/** Rewrites the signed-in role so the capability heuristic and the access probe see the `role` knob. */
async function patchedLogin(route, request, state) {
  const url = ENV.backend ? request.url().replace(ENV.apiOrigin, ENV.backend) : request.url();
  const response = await route.fetch({ url });
  let body = {};
  try {
    body = await response.json();
  } catch (_) {}
  const patched = body && body.status === true ? { ...body, role: ROLE_NAMES[state.role] ?? state.role } : body;
  return route.fulfill({ status: response.status(), headers: { ...cleanHeaders(response, request), "content-type": "application/json" }, body: JSON.stringify(patched) });
}

/** Route handler for one request; returns true if it was mocked. */
async function handleAi(route, request, state) {
  const url = new URL(request.url());
  const p = url.pathname;
  const m = request.method();
  let mt;

  // Enterprise-only endpoints the OSS backend refuses with 403; the UI treats [] as "none configured".
  if (/^\/api\/[^/]+\/alerts\/deduplication\/semantic-groups$/.test(p)) return json(route, []), true;
  if (/^\/api\/[^/]+\/re_patterns(\/built_in)?$/.test(p) && request.method() === "GET") return json(route, { patterns: [] }), true;
  // A page that closes mid-request rejects the fetch; that must not fail the test that already ended.
  if (p === "/config" || /^\/api\/[^/]+\/config$/.test(p)) return patchedConfig(route, request, state).catch(() => {}), true;
  if (state.role !== "admin" && m === "POST" && /\/auth\/login$/.test(p)) return patchedLogin(route, request, state).catch(() => {}), true;

  if ((mt = p.match(/^\/api\/public\/ai_chats\/([^/]+)$/))) {
    if (state.sharedChatStatus !== 200) return json(route, { code: state.sharedChatStatus, message: "Share not found or expired" }, state.sharedChatStatus), true;
    return json(route, sharedChat(decodeURIComponent(mt[1]))), true;
  }
  if (p === "/__o2mock/turn_end") {
    const { session_id: sid } = request.postDataJSON() || {};
    const chat = state.chats.find((c) => c.session_id === sid);
    if (chat) chat.running = false;
    return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } }), true;
  }
  if (p === "/__o2mock/turn") {
    const turn = request.postDataJSON() || {};
    const known = state.chats.find((c) => c.session_id === turn.session_id);
    if (known) Object.assign(known, { running: true, turn_id: turn.turn_id || known.turn_id });
    if (turn.session_id && !state.chats.some((c) => c.session_id === turn.session_id)) {
      const nowUs = Date.now() * 1000;
      const sc = SCENARIOS[turn.scenario] || SCENARIOS.complete;
      const title = (sc.frames.find((fr) => fr.type === "title") || {}).title || turn.text.slice(0, 40);
      state.chats.unshift({ session_id: turn.session_id, turn_id: turn.turn_id, running: true, title, user: turn.text, frames: sc.frames.filter((fr) => !fr.waitForConfirm && fr.boundary === undefined).map(({ sseId, ...fr }) => fr), created_at: nowUs, updated_at: nowUs, last_committed_seq: sc.frames.length });
    }
    return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } }), true;
  }
  if (!/^\/api\/[^/]+\/(ai|quota)\//.test(p)) return false;

  state.log.push(`${m} ${p}${url.search}`);
  if (state.expireNext) {
    state.expireNext = false;
    return json(route, { code: 401, message: "Unauthorized Access" }, 401), true;
  }

  // B-06: absent (404) unless `capabilitiesEnabled`; `capabilities` overrides the answer.
  if ((mt = p.match(/^\/api\/[^/]+\/ai\/capabilities(\/test)?$/))) {
    if (!state.capabilitiesEnabled) return json(route, { code: 404, message: "Not Found" }, 404), true;
    if (mt[1]) {
      state.log.push("TEST capabilities");
      if (state.capabilitiesTestDelayMs) await new Promise((r) => setTimeout(r, state.capabilitiesTestDelayMs));
      return json(route, state.capabilitiesTestResults.shift() ?? { ok: true, duration_ms: 120 }), true;
    }
    const role = ROLE_NAMES[state.role] ?? state.role;
    const admin = role === "admin";
    const history = { ...(state.historySearchEnabled && { history_search: true }), ...(state.historyPinsEnabled && { history_pins: true }) };
    return json(route, { health: { status: "ok", checked_at: Date.now() * 1000 }, redaction_applied: false, can_chat: role !== "viewer", can_write: admin || role === "editor", can_share: admin, agents: [], toolsets: [], toolset_secret_merge: state.secretMergeEnabled, policy_enforced: state.policyEnforced, ...offForOrg(state), ...history, ...state.capabilities }), true;
  }
  // B-14: absent (404) unless `settingsEnabled`; a PUT keeps the five writable keys and stamps the writer.
  if (p.match(/^\/api\/[^/]+\/ai\/settings$/)) {
    if (!state.settingsEnabled) return json(route, { code: 404, message: "Not Found" }, 404), true;
    if (m === "PUT") {
      const body = request.postDataJSON() || {};
      state.settingsPuts.push(body);
      state.settings = { ...orgSettings(state), ...body, updated_by: ENV.user, updated_at: Date.now() * 1000 };
    }
    return json(route, orgSettings(state)), true;
  }
  // The access probe (00 §9) arrives by XHR (the shim answers fetch cancels); a viewer is refused, any other role reaches the handler.
  if (m === "POST" && /^\/api\/[^/]+\/ai\/chats\/[^/]+\/cancel$/.test(p)) {
    if (state.probeDelayMs) await new Promise((r) => setTimeout(r, state.probeDelayMs));
    const status = state.probeStatus ?? (state.role === "viewer" ? 403 : 404);
    if (status === 403) return json(route, { code: 403, message: "Forbidden" }, 403), true;
    return json(route, { code: 404, message: "conversation not found" }, 404), true;
  }
  if ((mt = p.match(/^\/api\/[^/]+\/ai\/chats$/))) {
    if (m === "DELETE") return json(route, { deleted: state.chats.length }), true;
    if (state.historyStatus !== 200) return json(route, { code: state.historyStatus, message: "history store unavailable" }, state.historyStatus), true;
    const q = state.historySearchEnabled ? (url.searchParams.get("q") || "").trim().toLowerCase() : "";
    const chats = q ? state.chats.filter((c) => `${c.title} ${c.user}`.toLowerCase().includes(q)) : state.chats;
    return json(route, { chats: chats.map((c) => listRow(c, state)) }), true;
  }
  if ((mt = p.match(/^\/api\/[^/]+\/ai\/chats\/([^/]+)\/shares$/))) {
    const sid = decodeURIComponent(mt[1]);
    if (m === "POST") {
      const body = request.postDataJSON() || {};
      const unknown = unknownShareFields(body, CREATE_SHARE_FIELDS, state);
      if (unknown) return json(route, { code: 400, message: `unknown field \`${unknown}\`` }, 400), true;
      const chat = state.chats.find((c) => c.session_id === sid) || state.chats[0];
      const nowUs = Date.now() * 1000;
      const share = {
        id: `shr_new_${state.shares.length}`,
        token: `tok-new-${state.shares.length}`,
        url_path: body.visibility === "public" ? `/web/ai/public/tok-new-${state.shares.length}` : `/web/ai/shared/tok-new-${state.shares.length}?org_identifier=default`,
        mode: body.mode || "snapshot",
        visibility: body.visibility || "org",
        snapshot_seq: body.mode === "live" ? null : chat.last_committed_seq,
        expires_at: body.expires_in_secs ? nowUs + body.expires_in_secs * 1e6 : null,
        created_at: nowUs,
        updated_at: nowUs,
        access_count: 0,
        last_accessed_at: null,
        session_id: sid,
        title: chat.title,
        redact_tools: !!body.redact_tools,
        ...(body.hide_attachments !== undefined && { hide_attachments: !!body.hide_attachments }),
      };
      state.shares.unshift(share);
      return json(route, share), true;
    }
    return json(route, { shares: state.shares.filter((s) => s.session_id === sid) }), true;
  }
  if (m === "POST" && /^\/api\/[^/]+\/ai\/chats\/import$/.test(p)) {
    if (!state.importEnabled) return json(route, { code: 404, message: "Not Found" }, 404), true;
    const { chats = [] } = request.postDataJSON() || {};
    const result = { imported: [], skipped: [], failed: [] };
    for (const chat of chats) {
      if (state.importFailTitles.includes(chat.title)) {
        result.failed.push({ client_id: chat.client_id, code: "invalid_chat" });
        continue;
      }
      const nowUs = Date.now() * 1000;
      const sessionId = `imp-${chat.client_id}`;
      state.chats.unshift({ session_id: sessionId, title: chat.title, user: chat.turns?.[0]?.user?.text || chat.title, frames: chat.turns?.[0]?.frames || [], created_at: nowUs, updated_at: nowUs, last_committed_seq: 1 });
      result.imported.push({ client_id: chat.client_id, session_id: sessionId });
    }
    return json(route, result), true;
  }
  if ((mt = p.match(/^\/api\/[^/]+\/ai\/chats\/([^/]+)\/cancel$/))) {
    if (state.cancelDelayMs) await new Promise((r) => setTimeout(r, state.cancelDelayMs));
    const status = state.cancelStatus || 200;
    return json(route, status === 200 ? { cancelled: true } : { code: status, message: "cancel failed" }, status), true;
  }
  if ((mt = p.match(/^\/api\/[^/]+\/ai\/chats\/([^/]+)$/))) {
    const sid = decodeURIComponent(mt[1]);
    const chat = state.chats.find((c) => c.session_id === sid);
    if (m === "DELETE") {
      if (state.deleteStatus !== 200) return json(route, { code: state.deleteStatus, message: "delete failed" }, state.deleteStatus), true;
      state.chats = state.chats.filter((c) => c.session_id !== sid);
      return json(route, { deleted: true }), true;
    }
    if (m === "PATCH") {
      const body = request.postDataJSON() || {};
      if (chat) chat.title = body.title || chat.title;
      if (chat && state.historyPinsEnabled && typeof body.pinned === "boolean") chat.pinned = body.pinned;
      return json(route, chat ? listRow(chat, state) : {}), true;
    }
    if (!chat) return json(route, { code: 404, message: "chat not found" }, 404), true;
    const detail = chatDetail(chat);
    if (state.historyDropsCards)
      detail.turns = detail.turns.map((t) => ({ ...t, frames: t.frames.filter((fr) => fr.type !== "confirmation_required") }));
    return json(route, detail), true;
  }
  if ((mt = p.match(/^\/api\/[^/]+\/ai\/shares$/))) {
    if (state.sharesStatus !== 200) return json(route, { code: state.sharesStatus, message: "forbidden" }, state.sharesStatus), true;
    const all = url.searchParams.get("all") === "true";
    const shares = all
      ? state.shares.map(({ token, url_path, ...s }, i) => ({ ...s, owner_name: ["Priya Raman", "Root", "Diego Alvarez"][i % 3], owner_email: ["priya@example.com", "root@example.com", "diego@example.com"][i % 3] }))
      : state.shares;
    return json(route, { shares }), true;
  }
  if ((mt = p.match(/^\/api\/[^/]+\/ai\/shares\/([^/]+)$/))) {
    const id = decodeURIComponent(mt[1]);
    const share = state.shares.find((s) => s.id === id);
    if (m === "DELETE") {
      state.shares = state.shares.filter((s) => s.id !== id);
      return json(route, { revoked: true }), true;
    }
    const patch = request.postDataJSON() || {};
    const unknown = unknownShareFields(patch, UPDATE_SHARE_FIELDS, state);
    if (unknown) return json(route, { code: 400, message: `unknown field \`${unknown}\`` }, 400), true;
    const { expires_in_secs: secs, refresh_snapshot: refresh, ...rest } = patch;
    const expiry = secs === undefined ? {} : { expires_at: secs === null ? null : Date.now() * 1000 + secs * 1e6 };
    const chat = share && state.chats.find((c) => c.session_id === share.session_id);
    const snapshot = refresh && chat ? { snapshot_seq: chat.last_committed_seq } : {};
    Object.assign(share || {}, rest, expiry, snapshot, { updated_at: Date.now() * 1000 });
    return json(route, share || {}), true;
  }
  if ((mt = p.match(/^\/api\/[^/]+\/ai\/shared\/([^/]+)\/fork$/))) {
    return json(route, { session_id: state.chats[0].session_id, title: `${state.chats[0].title} (copy)` }), true;
  }
  if ((mt = p.match(/^\/api\/[^/]+\/ai\/shared\/([^/]+)$/))) {
    if (state.sharedChatStatus !== 200) return json(route, { code: state.sharedChatStatus, message: "Share not found or expired" }, state.sharedChatStatus), true;
    return json(route, sharedChat(decodeURIComponent(mt[1]))), true;
  }
  if (/^\/api\/[^/]+\/ai\/feedback$/.test(p)) return json(route, { ok: true }), true;
  if (/^\/api\/[^/]+\/ai\/actions\/[^/]+\/undo$/.test(p)) return json(route, {}), true;
  if (/^\/api\/[^/]+\/ai\/confirm\//.test(p)) return json(route, { ok: true }), true;
  if ((mt = p.match(/^\/api\/[^/]+\/ai\/toolsets(?:\/([^/]+))?(\/test)?$/))) return toolsetRoute(route, state, m, mt), true;
  if (/^\/api\/[^/]+\/ai\/grants/.test(p)) return grantRoute(route, state, m, p), true;
  if (/^\/api\/[^/]+\/ai\/activity/.test(p)) return activityRoute(route, state, m, p), true;
  if (/^\/api\/[^/]+\/ai\/usage$/.test(p) && (state.usage || state.usageStatus !== 200)) {
    state.log.push("GET ai/usage");
    if (state.usageStatus !== 200) return json(route, { code: state.usageStatus, message: "usage read failed" }, state.usageStatus), true;
    return json(route, state.usage), true;
  }
  if (/^\/api\/[^/]+\/ai\/usage/.test(p)) return json(route, { data: [], total_tokens: 0 }), true;
  if (/^\/api\/[^/]+\/quota\/[^/]+\/paid_overage$/.test(p)) {
    if (m === "GET" && state.overageStatus !== 200) return json(route, { code: state.overageStatus, message: "paid usage status unavailable" }, state.overageStatus), true;
    if (m === "PUT") {
      if (state.consentPutDelayMs) await new Promise((r) => setTimeout(r, state.consentPutDelayMs));
      if (state.consentPutStatus !== 200) return json(route, { code: state.consentPutStatus, message: "paid usage update failed" }, state.consentPutStatus), true;
      state.log.push(`PUT paid_overage ${p.split("/")[2]}`);
      const { enabled } = request.postDataJSON() || {};
      // A PUT on the payer's own path flips the payer row; any other org is this org.
      if (state.overage.payer && p.split("/")[2] === state.overage.payer.org_id)
        state.overage = { ...state.overage, payer: { ...state.overage.payer, enabled: !!enabled } };
      else state.overage = { ...state.overage, effective: !!enabled, organization: { ...state.overage.organization, enabled: !!enabled } };
    }
    if (state.overageStatus !== 200) return json(route, { code: state.overageStatus, message: "paid usage read failed" }, state.overageStatus), true;
    if (m === "GET" && state.overage.payer && p.split("/")[2] === state.overage.payer.org_id)
      return json(route, { ...state.overage, organization: state.overage.payer, payer: null }), true;
    return json(route, state.overage), true;
  }
  return false;
}

// A list row carries pins and the running and waiting markers only while their knob is on.
function listRow(chat, state) {
  return {
    ...chatSummary(chat),
    ...(state.historyPinsEnabled && { pinned: !!chat.pinned }),
    ...(state.listMarkersEnabled && {
      active_turn: !!chat.running,
      ...(chat.running && chat.turn_id && { active_turn_id: chat.turn_id }),
      pending_approval: !!chat.pending_approval,
    }),
  };
}

/** The toolset list, records, writes and the health test; health fields only while `toolsetHealthEnabled`. */
async function toolsetRoute(route, state, m, [, id, test]) {
  const request = route.request();
  state.toolsets ??= TOOLSETS.toolsets.map((t) => ({ ...TOOLSET_RECORDS[t.id] }));
  const withHealth = (t) => (state.toolsetHealthEnabled ? { ...t, ...TOOLSET_HEALTH[t.id] } : t);
  if (test) {
    if (!state.toolsetHealthEnabled) return json(route, { code: 404, message: "Not Found" }, 404);
    return json(route, state.toolsetTestResults.shift() ?? { ok: true, duration_ms: 140 });
  }
  if (m === "GET" && state.toolsetsDelayMs) await new Promise((r) => setTimeout(r, state.toolsetsDelayMs));
  if (m === "GET" && state.toolsetsStatus !== 200) return json(route, { code: state.toolsetsStatus, message: "toolsets unavailable" }, state.toolsetsStatus);
  const found = id && state.toolsets.find((t) => t.id === decodeURIComponent(id));
  if (m === "GET") {
    if (!id) return json(route, { toolsets: state.toolsets.map(({ data, ...row }) => withHealth({ ...row, data: { allowed_subcommands: data?.allowed_subcommands, requires_confirmation: data?.requires_confirmation } })) });
    return found ? json(route, withHealth(found)) : json(route, { code: 404, message: "toolset not found" }, 404);
  }
  const body = request.postDataJSON() || {};
  state.toolsetWrites.push({ method: m, id: id ? decodeURIComponent(id) : null, body });
  const refused = m === "PUT" && found && state.secretMergeEnabled ? keptSecretRefusal(found, body) : null;
  if (refused) return json(route, { code: "invalid_request", error_code: "destination_changed", fields: refused, message: "Re-enter every secret: a kept secret cannot go with a changed destination or credential entry" }, 400);
  if (m === "DELETE") state.toolsets = state.toolsets.filter((t) => t !== found);
  else if (m === "PATCH" && found) Object.assign(found, body);
  else if (m === "PUT" && found) Object.assign(found, body);
  else if (m === "POST") state.toolsets.push({ ...body, id: `ts_new_${state.toolsets.length}` });
  return json(route, m === "POST" ? { id: `ts_new_${state.toolsets.length - 1}` } : {});
}

/** The server keeps `***` only when no destination field and no other secret in the update changed. */
function keptSecretRefusal(stored, body) {
  const SECRET = ["headers", "env", "credential_files"];
  const DEST = ["url", "command", "allowed_subcommands", "blocked_subcommands", "requires_confirmation"];
  const incoming = body.data || {};
  const was = stored.data || {};
  const maps = SECRET.filter((f) => incoming[f] && typeof incoming[f] === "object");
  if (!maps.some((f) => Object.values(incoming[f]).includes("***"))) return null;
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const fields = DEST.filter((f) => f in incoming && !same(incoming[f], was[f] ?? (f === "requires_confirmation" ? false : undefined)));
  for (const f of maps) if (Object.entries(incoming[f]).some(([k, v]) => v !== "***" && was[f]?.[k] !== v)) fields.push(f);
  return fields.length ? fields : null;
}

/** Grants: 404 while `grantsEnabled` is off; DELETE removes the row. */
function grantRoute(route, state, m, p) {
  if (!state.grantsEnabled) return json(route, { code: 404, message: "Not Found" }, 404);
  state.grants ??= GRANTS.map((g) => ({ ...g }));
  const id = p.match(/\/grants\/([^/]+)$/)?.[1];
  if (m === "DELETE" && id) {
    state.log.push(`REVOKE grant ${decodeURIComponent(id)}`);
    state.grants = state.grants.filter((g) => g.id !== decodeURIComponent(id));
    return json(route, {});
  }
  return json(route, state.grants);
}

/** Activity: 404 while `activityEnabled` is off; undo marks the row undone. */
function activityRoute(route, state, m, p) {
  if (!state.activityEnabled) return json(route, { code: 404, message: "Not Found" }, 404);
  state.activity ??= { rows: ACTIVITY.rows.map((a) => ({ ...a })) };
  const id = p.match(/\/activity\/([^/]+)\/undo$/)?.[1];
  if (m === "POST" && id) {
    const row = state.activity.rows.find((a) => a.id === decodeURIComponent(id));
    if (row) Object.assign(row, { result: { state: "undone" }, undo: { available: false, reason: "already_undone" } });
    return json(route, { id: `undo_${id}`, undone: id, target: row?.target });
  }
  return json(route, state.activity);
}

/** The stored org settings, or the B-14 defaults the server starts an org with. */
function orgSettings(state) {
  return state.settings ?? { enabled: true, permission_tier: "act_with_approval", org_sharing: true, public_sharing: true, data_sharing_level: "raw" };
}

/** A B-14 server folds `enabled: false` into the probe's gate. */
function offForOrg(state) {
  return state.settingsEnabled && state.settings?.enabled === false ? { gate: "off_for_org" } : {};
}

/** Installs the streaming shim and all HTTP mocks on a browser context. */
export async function installMocks(context, state = createMockState()) {
  await enforceMode();
  if (isStack()) {
    if (state.overrides?.length) await mockOnly(`the mock knobs ${state.overrides.join(", ")}`);
    // Telemetry capture is client-side, so stack runs still assert events; nothing else is faked.
    await context.addInitScript({ content: "window.__O2_TELEMETRY_SINK__ = true;" });
    return state;
  }
  const shim = readFileSync(join(here, "stream-shim.js"), "utf8");
  await context.addInitScript({
    content:
      `window.__O2MOCK_SCENARIOS__ = ${JSON.stringify(SCENARIOS)};\n` +
      `window.__O2MOCK_HTTP_SCENARIOS__ = ${JSON.stringify(HTTP_SCENARIOS)};\n` +
      `window.__O2MOCK_KNOBS__ = ${JSON.stringify(browserKnobs(state))};\n` +
      // trackAssistant copies every event into window.__o2telemetry only when this is set.
      "window.__O2_TELEMETRY_SINK__ = true;\n" +
      shim,
  });
  await context.route(`${ENV.apiOrigin}/**`, async (route) => {
    const request = route.request();
    try {
      if (await handleAi(route, request, state)) return;
    } catch (e) {
      console.error("mock handler failed", request.url(), e);
    }
    return passthrough(route, request);
  });
  return state;
}

/** The knobs the stream shim reads in the page; `setKnobs` changes them after load. */
function browserKnobs(state) {
  const { tailEnabled, envelopeEnabled, lifecycleFramesEnabled, cancelDelayMs, cancelStatus, confirmStatus, confirmFail, confirmUndoable } = state;
  return { tailEnabled, envelopeEnabled, lifecycleFramesEnabled, cancelDelayMs, cancelStatus, confirmStatus, confirmFail, confirmUndoable };
}

/** Flips browser-side knobs on a loaded page (the init script only reads them at load). */
export async function setKnobs(page, knobs) {
  await mockOnly(`the browser knobs ${Object.keys(knobs).join(", ")}`);
  await page.evaluate((k) => Object.assign(window.__o2mock.knobs, k), knobs);
}

/** Sets the scenario for the next chat_stream call (see SCENARIOS / HTTP_SCENARIOS). */
export async function nextScenario(page, name, { speed = 1 } = {}) {
  await mockOnly(`the scenario "${name}"`);
  await page.evaluate(([n, s]) => {
    window.__o2mock.next = n;
    window.__o2mock.speed = s;
  }, [name, speed]);
}

/** The edition rewrite needs the served `/web/src/aws-exports.ts`, which exists only on the Vite dev server. */
async function requireViteDev() {
  if (ENV.viteDev) return;
  const { test } = await import("@playwright/test");
  test.skip(true, "edition rewrite needs the Vite dev server");
}

async function rewriteEdition(context, replacements, servedBy) {
  // A stack run of the matching edition is already that build; any other stack cannot fake it.
  if (MODE === servedBy) return;
  await mockOnly("the edition rewrite");
  await requireViteDev();
  await context.route(/\/web\/src\/aws-exports\.ts/, async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    for (const [pattern, value] of replacements) body = body.replace(pattern, value);
    await route.fulfill({ response, body });
  });
}

/** Rewrites the served aws-exports module so the bundle believes it is a Cloud build (call after login, then reload). */
export async function forceCloudBuild(context) {
  await rewriteEdition(context, [[/isCloud: [^,]+,/, 'isCloud: "true",']], "stack-cloud");
}

/** Rewrites the served aws-exports module so the bundle believes it is an OSS build (G0). */
export async function forceOssBuild(context) {
  await rewriteEdition(context, [
    [/isCloud: [^,]+,/, 'isCloud: "false",'],
    [/isEnterprise: [^,]+,/, 'isEnterprise: "false",'],
  ], "stack-oss");
}

/** Rewrites the served aws-exports module so the bundle believes it is an enterprise build. */
export async function forceEnterpriseBuild(context) {
  await rewriteEdition(context, [[/isEnterprise: [^,]+,/, 'isEnterprise: "true",']], "stack-ee");
}

/** Sets the assistant_v2 flag for every page of the context (`window.__O2_ASSISTANT_V2__`, read by flags.ts). */
export async function setFlag(context, on) {
  await context.addInitScript((value) => {
    window.__O2_ASSISTANT_V2__ = value;
  }, !!on);
}

export async function setOnline(page, online) {
  await page.context().setOffline(!online);
}

/** The next AI request answers 401 once. */
export function expireSession(state) {
  if (isStack()) return mockOnly("an expired session");
  state.expireNext = true;
}

/** Two pages in one context, sharing storage and the mocks (gap-1 two-tab scenarios). */
export async function twoTabs(context) {
  return [await context.newPage(), await context.newPage()];
}

/** Every event trackAssistant sent on this page (needs installMocks, which enables the sink). */
export async function captureTelemetry(page) {
  return page.evaluate(() => window.__o2telemetry ?? []);
}

export async function exportTelemetry(page, flow) {
  const events = await captureTelemetry(page);
  mkdirSync(join(OUT, "telemetry"), { recursive: true });
  writeFileSync(join(OUT, "telemetry", `${flow}.json`), JSON.stringify({ mode: MODE, flow, events }, null, 2));
  return events;
}

/** The text of every role="status" region, in DOM order. */
export async function readAnnouncements(page) {
  return page.locator('[role="status"]').allTextContents();
}

/** Signs in as the root user, or as `as` (a user `createUser` made). */
export async function login(page, as = { user: ENV.user, pass: ENV.pass }) {
  await enforceMode();
  if (!as.user || !as.pass) throw new Error("Set ZO_ROOT_USER_EMAIL and ZO_ROOT_USER_PASSWORD (as for every tests/ui-testing suite).");
  await page.goto(`${ENV.appUrl}/login`, { waitUntil: "domcontentloaded" });
  const internal = page.locator('[data-test="login-as-internal-user"]');
  if (await internal.isVisible({ timeout: 3000 }).catch(() => false)) await internal.click();
  await page.locator('[data-test="login-user-id-field"]').fill(as.user);
  await page.locator('[data-test="login-password-field"]').fill(as.pass);
  await page.locator('[data-test="login-sign-in"]').click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** A real (unmocked) API call as the root user, for fixtures the mocks do not cover. */
async function rootApi(method, path, body) {
  const auth = Buffer.from(`${ENV.user}:${ENV.pass}`).toString("base64");
  const response = await fetch(`${ENV.backend || ENV.apiOrigin}${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}`);
  return response.json();
}

/** A new admin of the test org with a random password, for flows that switch users in one browser. */
export async function createUser(prefix = "second") {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const user = `${prefix}-${stamp}@example.com`;
  const pass = `Pw#${Math.random().toString(36).slice(2)}${stamp}`;
  await rootApi("POST", `/api/${ENV.org}/users`, { email: user, password: pass, role: "admin", first_name: "Second", last_name: "User" });
  return { user, pass };
}

/** The identifier of the organization named `name`, created once per backend (organizations cannot be deleted here). */
export async function ensureOrg(name) {
  const { data = [] } = await rootApi("GET", "/api/organizations");
  const found = data.find((o) => o.name === name);
  return found ? found.identifier : (await rootApi("POST", "/api/organizations", { name })).identifier;
}

/** Creates a two-panel dashboard (one left, one right column) and returns its id. */
export async function createTwoColumnDashboard(title) {
  const fixture = JSON.parse(readFileSync(join(here, "..", "dashboards", "d1-turn-health.json"), "utf8"));
  const [left, right] = fixture.tabs[0].panels;
  const panels = [
    { ...left, id: "e2e_left", title: "Left panel", layout: { ...left.layout, x: 0, y: 0, w: 24, i: 1 } },
    { ...right, id: "e2e_right", title: "Right panel", layout: { ...right.layout, x: 24, y: 0, w: 24, i: 2 } },
  ];
  const dashboard = { ...fixture, title, tabs: [{ ...fixture.tabs[0], panels }] };
  const created = await rootApi("POST", `/api/${ENV.org}/dashboards?folder=default`, dashboard);
  return created.v5.dashboardId;
}

export async function deleteDashboard(id) {
  // The delete answers with an empty body, which rootApi's JSON parse rejects after the dashboard is gone.
  await rootApi("DELETE", `/api/${ENV.org}/dashboards/${id}?folder=default`).catch((error) => {
    if (!(error instanceof SyntaxError)) throw error;
  });
}
