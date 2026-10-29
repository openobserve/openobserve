// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { AssistantErrorCode } from "@/composables/assistant";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/services/product_analytics", () => ({ default: { track } }));

import {
  AI_EVENT_NAMES,
  BANNED_PROPERTY_NAMES,
  TURN_SCOPED_EVENTS,
  assistantEventProblems,
  legacyEventsFor,
  admissionLegacyEvents,
  trackAssistantAdmitted,
  MAX_PENDING_ADMISSIONS,
  setAssistantTelemetryContext,
  trackAssistant,
  type AiErrorCode,
  type AiEventName,
  type AiEventProps,
  type HelperHost,
  type QueryLanguage,
} from "./assistantAnalytics";

const TURN = { sid: "0199e7b2-6f0c-7a3e-a1b2-c3d4e5f60718", turnId: "t-1", traceId: "trace-1" };

/** One valid payload per event of 99 §3.3; the keys are the catalogue's properties. */
const SAMPLES: { [N in AiEventName]: AiEventProps[N] } = {
  ai_entry_clicked: {
    entry_kind: "object_verb",
    entry_verb: "explain",
    object_kind: "log_row",
    sends: true,
    gate: "available",
    queued: false,
    host: "logs",
    language: "sql",
    text_len_bucket: "1_20",
    error: false,
  },
  ai_gate_blocked: { reason: "no_permission", cta: "ask_admin" },
  ai_container_opened: {
    from: "door",
    placement_mode: "pinned",
    turn_running: false,
    latency_ms: 42,
  },
  ai_container_moved: { from: "pinned", to: "full", turn_running: true },
  ai_container_closed: { reason: "escape" },
  ai_panel_resized: { width_rem: 24, viewport: "desktop" },
  ai_panel_mode_changed: { mode: "floating", forced: false },
  ai_sheet_snap: { snap: "half" },
  ai_toast: { kind: "ready", action: "open" },
  ai_turn_busy: {},
  ai_leave_guard: { host: "alert_query", choice: "keep" },
  ai_status_light: { state: "working" },
  ai_context_changed: { action: "add", kind: "log_row", count: 1, bytes: 512 },
  ai_context_inspected: { target: "chip", kind: "stream" },
  ai_composer_recall: { direction: "older", index: 0 },
  ai_composer_cap_hit: { cap: "rows" },
  ai_composer_enter_blocked: { reason: "running" },
  ai_composer_cleared: { reason: "new_chat", undone: false },
  ai_turn_sent: {
    input: "typed",
    chip_count: 2,
    chip_kinds: ["time", "stream"],
    image_count: 0,
    attached_bytes: 0,
    prompt_chars: 31,
    new_session: true,
  },
  ai_turn_first_byte: { ttfb_ms: 380 },
  ai_turn_state: { state: "running_tool", tool: "SearchSQL", elapsed_ms: 4000 },
  ai_turn_ended: {
    outcome: "done",
    error_code: null,
    http_status: 200,
    recoverable: false,
    duration_ms: 9000,
    ttfb_ms: 380,
    tool_calls: 3,
    tool_errors: 0,
    tokens_in: 18342,
    tokens_out: 612,
    credits: null,
    container_at_end: "sidebar",
    seen: true,
  },
  ai_turn_recovered: { action: "retry", succeeded: true },
  ai_stop: { surface: "chat", server_cancel_ms: 120, partial_kept: true },
  ai_scroll_jump: { unseen: 3 },
  ai_transcript_window: { turns_mounted: 40 },
  ai_block_invalid: { block_kind: "findings" },
  ai_evidence_action: { action: "open_explorer", block_kind: "query", language: "sql" },
  ai_downstream_saved: { object: "dashboard", origin_turn_id: "t-1" },
  ai_approval_shown: {
    op: "delete",
    resource_kind: "alert",
    destructive: true,
    grantable: false,
    asked_in: "here",
    count: 1,
  },
  ai_approval_decided: {
    decision: "approve",
    scope: "once",
    items_count: 1,
    latency_ms: 2000,
    input: "click",
  },
  ai_approval_result: { status: "succeeded", succeeded_count: 1, failed_count: 0 },
  ai_approval_expired: { op: "run", resource_kind: "command" },
  ai_policy_notice: { kind: "unreviewed_change" },
  ai_undo: { op: "delete", resource_kind: "alert", succeeded: true },
  ai_navigation: { mode: "link_card", taken: true, blocked_unsaved: false },
  ai_nl_proposal: {
    outcome: "proposal",
    language: "sql",
    host: "logs",
    validated: "ok",
    scan_estimate_bucket: "21_100",
  },
  ai_nl_decided: { decision: "accept", validated: "ok" },
  ai_feedback: { value: "up", reason: "wrong_data", outcome: "done" },
  ai_thread_action: {
    action: "download",
    had_running: false,
    had_draft: false,
    scope: "server",
    format: "json",
    to: "full",
    count: 1,
  },
  ai_history_open: { placement: "popover" },
  ai_history_search: { length_bucket: "1_20", server: false },
  ai_share: { action: "create", visibility: "org", mode: "snapshot", scope: "chat" },
  ai_shared_view: {
    visibility: "public",
    mode: "live",
    state: "ready",
    redacted: true,
    truncated: false,
  },
  ai_fork: { result: "ok" },
  ai_local_import: { result: "done", count: 4 },
  ai_consent: { step: "shown", surface: "chat", org_match: true, plan_type: "direct" },
  ai_credit_notice: { threshold: 70, mode: "free", action: "shown", had_prior_warning: false },
  ai_shortcut: { shortcut_id: "assistantOpen", effect: "open" },
  ai_welcome_shown: { fresh_org: true, starter_kinds: ["ingest", "learn"] },
  ai_welcome_starter: { starter_kind: "page", index: 0, via: "click" },
  ai_admin: { section: "paid_usage", action: "enable", result: "ok" },
  ai_org_switch_with_turns: { count: 1, choice: "keep" },
  ai_sign_out_with_turns: { count: 2, choice: "proceed" },
  ai_cross_tab_hint: { type: "turn_started" },
  ai_frame_unknown: { type: "reasoning_delta" },
};

/** The catalogue's property names per event (99 §3.3), pinned so a rename fails here. */
const CATALOGUE: Record<AiEventName, string[]> = {
  ai_entry_clicked: [
    "entry_kind",
    "entry_verb",
    "object_kind",
    "sends",
    "gate",
    "queued",
    "host",
    "language",
    "text_len_bucket",
    "error",
  ],
  ai_gate_blocked: ["reason", "cta"],
  ai_container_opened: ["from", "placement_mode", "turn_running", "latency_ms"],
  ai_container_moved: ["from", "to", "turn_running"],
  ai_container_closed: ["reason"],
  ai_panel_resized: ["width_rem", "viewport"],
  ai_panel_mode_changed: ["mode", "forced"],
  ai_sheet_snap: ["snap"],
  ai_toast: ["kind", "action"],
  ai_turn_busy: [],
  ai_leave_guard: ["host", "choice"],
  ai_status_light: ["state"],
  ai_context_changed: ["action", "kind", "count", "bytes"],
  ai_context_inspected: ["target", "kind"],
  ai_composer_recall: ["direction", "index"],
  ai_composer_cap_hit: ["cap"],
  ai_composer_enter_blocked: ["reason"],
  ai_composer_cleared: ["reason", "undone"],
  ai_turn_sent: [
    "input",
    "chip_count",
    "chip_kinds",
    "image_count",
    "attached_bytes",
    "prompt_chars",
    "new_session",
  ],
  ai_turn_first_byte: ["ttfb_ms"],
  ai_turn_state: ["state", "tool", "elapsed_ms"],
  ai_turn_ended: [
    "outcome",
    "error_code",
    "http_status",
    "recoverable",
    "duration_ms",
    "ttfb_ms",
    "tool_calls",
    "tool_errors",
    "tokens_in",
    "tokens_out",
    "credits",
    "container_at_end",
    "seen",
  ],
  ai_turn_recovered: ["action", "succeeded"],
  ai_stop: ["surface", "server_cancel_ms", "partial_kept"],
  ai_scroll_jump: ["unseen"],
  ai_transcript_window: ["turns_mounted"],
  ai_block_invalid: ["block_kind"],
  ai_evidence_action: ["action", "block_kind", "language"],
  ai_downstream_saved: ["object", "origin_turn_id"],
  ai_approval_shown: ["op", "resource_kind", "destructive", "grantable", "asked_in", "count"],
  ai_approval_decided: ["decision", "scope", "items_count", "latency_ms", "input"],
  ai_approval_result: ["status", "succeeded_count", "failed_count"],
  ai_approval_expired: ["op", "resource_kind"],
  ai_policy_notice: ["kind"],
  ai_undo: ["op", "resource_kind", "succeeded"],
  ai_navigation: ["mode", "taken", "blocked_unsaved"],
  ai_nl_proposal: ["outcome", "language", "host", "validated", "scan_estimate_bucket"],
  ai_nl_decided: ["decision", "validated"],
  ai_feedback: ["value", "reason", "outcome"],
  ai_thread_action: ["action", "had_running", "had_draft", "scope", "format", "to", "count"],
  ai_history_open: ["placement"],
  ai_history_search: ["length_bucket", "server"],
  ai_share: ["action", "visibility", "mode", "scope"],
  ai_shared_view: ["visibility", "mode", "state", "redacted", "truncated"],
  ai_fork: ["result"],
  ai_local_import: ["result", "count"],
  ai_consent: ["step", "surface", "org_match", "plan_type"],
  ai_credit_notice: ["threshold", "mode", "action", "had_prior_warning"],
  ai_shortcut: ["shortcut_id", "effect"],
  ai_welcome_shown: ["fresh_org", "starter_kinds"],
  ai_welcome_starter: ["starter_kind", "index", "via"],
  ai_admin: ["section", "action", "result"],
  ai_org_switch_with_turns: ["count", "choice"],
  ai_sign_out_with_turns: ["count", "choice"],
  ai_cross_tab_hint: ["type"],
  ai_frame_unknown: ["type"],
};

const ENVELOPE_KEYS = [
  "schema",
  "container",
  "route",
  "viewport",
  "edition",
  "credit_mode",
  "role",
  "org",
  "gate",
  "ui_version",
];

const scopeFor = (name: AiEventName) =>
  (TURN_SCOPED_EVENTS as readonly string[]).includes(name) ? TURN : undefined;

const fire = (name: AiEventName, props: unknown, scope?: object) =>
  (trackAssistant as (n: string, p: unknown, s?: object) => void)(name, props, scope);

beforeEach(() => {
  track.mockClear();
  setAssistantTelemetryContext({
    getContainer: () => "sidebar",
    getRoute: () => "logs",
    getViewport: () => "desktop",
    getEdition: () => "ee",
    getCreditMode: () => "none",
    getRole: () => "admin",
    getOrg: () => "default",
    getGate: () => "available",
    uiVersion: "abc1234",
  });
});

afterEach(() => {
  delete window.__O2_TELEMETRY_SINK__;
  delete window.__o2telemetry;
});

describe("event catalogue", () => {
  it("pins every event name of 99 §3.3", () => {
    expect([...AI_EVENT_NAMES].sort()).toEqual(Object.keys(CATALOGUE).sort());
    expect(AI_EVENT_NAMES).toHaveLength(56);
  });

  it.each(AI_EVENT_NAMES)("%s carries exactly its catalogue properties", (name) => {
    expect(Object.keys(SAMPLES[name]).sort()).toEqual([...CATALOGUE[name]].sort());
    expect(
      assistantEventProblems(name, SAMPLES[name] as Record<string, unknown>, scopeFor(name)),
    ).toEqual([]);
  });

  it("takes the alert inline editor as a helper host and JavaScript as a query language", () => {
    const proposal: AiEventProps["ai_nl_proposal"] = {
      ...SAMPLES.ai_nl_proposal,
      host: "alert",
      language: "js",
    };
    expect(assistantEventProblems("ai_nl_proposal", proposal, scopeFor("ai_nl_proposal"))).toEqual(
      [],
    );
    expectTypeOf<"alert">().toMatchTypeOf<HelperHost>();
    expectTypeOf<"js">().toMatchTypeOf<QueryLanguage>();
  });

  it("rejects an unknown property at compile time", () => {
    expectTypeOf<AiEventProps["ai_turn_first_byte"]>().toEqualTypeOf<{ ttfb_ms: number }>();
    // @ts-expect-error the catalogue has no images on ai_turn_sent (image_count instead)
    const wrong: AiEventProps["ai_turn_sent"] = { ...SAMPLES.ai_turn_sent, images: 1 };
    expect(wrong).toBeTruthy();
  });

  it("uses exactly the 99 §3.5 codes plus stopped_before_send for error_code", () => {
    const codes = [
      "offline",
      "unreachable",
      "session_expired",
      "permission_denied",
      "not_enabled",
      "credits_exhausted",
      "subscription_required",
      "consent_declined",
      "consent_still_required",
      "stopped_before_send",
      "authorization_unavailable",
      "turn_limit",
      "rate_limited",
      "turn_busy",
      "already_submitted",
      "agent_unavailable",
      "provider_error",
      "stream_dropped",
      "session_owner_unavailable",
      "restore_required",
      "stale_epoch",
      "empty_response",
      "persistence_failed",
      "cancelled_elsewhere",
      "signed_out",
      "approval_expired",
      "approval_delivery_failed",
      "stream_oversized",
      "unknown",
    ] as const satisfies readonly AiErrorCode[];
    expect(new Set(codes).size).toBe(29);
    expectTypeOf<AiErrorCode>().toEqualTypeOf<(typeof codes)[number]>();
    expectTypeOf<Exclude<AssistantErrorCode, AiErrorCode>>().toEqualTypeOf<
      | "history_unavailable"
      | "off_for_org"
      | "data_level_blocked"
      | "permission_denied_tool"
      | "approval_elsewhere"
      | "account_changed"
    >();
  });
});

describe("trackAssistant", () => {
  it("stamps the envelope and the turn scope", () => {
    trackAssistant("ai_turn_first_byte", { ttfb_ms: 380 }, TURN);
    const [name, properties] = track.mock.calls[0];
    expect(name).toBe("ai_turn_first_byte");
    expect(properties).toEqual({
      schema: 1,
      container: "sidebar",
      route: "logs",
      viewport: "desktop",
      edition: "ee",
      credit_mode: "none",
      role: "admin",
      org: "default",
      gate: "available",
      ui_version: "abc1234",
      session_id: TURN.sid,
      turn_id: "t-1",
      trace_id: "trace-1",
      ttfb_ms: 380,
    });
  });

  it.each(AI_EVENT_NAMES)("%s has a complete envelope", (name) => {
    fire(name, SAMPLES[name], scopeFor(name));
    const properties = track.mock.calls[0][1] as Record<string, unknown>;
    for (const key of ENVELOPE_KEYS) expect(properties[key], key).toBeDefined();
  });

  it("lifts door fields into the envelope", () => {
    trackAssistant("ai_entry_clicked", SAMPLES.ai_entry_clicked);
    expect(track.mock.calls[0][1]).toMatchObject({
      entry_kind: "object_verb",
      entry_verb: "explain",
      object_kind: "log_row",
    });
  });

  it("requires a turn_id on every turn-scoped event", () => {
    for (const name of TURN_SCOPED_EVENTS) {
      expect(() => fire(name, SAMPLES[name])).toThrow(/turn_id/);
    }
    expect(track).not.toHaveBeenCalled();
  });

  it("requires a session_id on every turn-scoped event", () => {
    for (const name of TURN_SCOPED_EVENTS) {
      expect(() => fire(name, SAMPLES[name], { turnId: "t-1" })).toThrow(/session_id/);
    }
    expect(track).not.toHaveBeenCalled();
  });

  it("rejects banned property names and long strings", () => {
    for (const banned of BANNED_PROPERTY_NAMES) {
      if (banned === "value") continue;
      expect(() => fire("ai_admin", { ...SAMPLES.ai_admin, [banned]: "x" })).toThrow(banned);
    }
    expect(() => fire("ai_admin", { ...SAMPLES.ai_admin, section: "x".repeat(65) })).toThrow(/64/);
    expect(() =>
      fire("ai_welcome_shown", { fresh_org: true, starter_kinds: ["y".repeat(65)] }),
    ).toThrow(/64/);
    expect(track).not.toHaveBeenCalled();
  });

  it("rejects a property that would override the envelope", () => {
    for (const field of ["container", "org", "turn_id", "gate", "role", "session_id"]) {
      expect(() => fire("ai_admin", { ...SAMPLES.ai_admin, [field]: "x" })).toThrow(/envelope/);
    }
    expect(() => fire("ai_turn_first_byte", { ttfb_ms: 1, turn_id: "other" }, TURN)).toThrow(
      /envelope/,
    );
    expect(track).not.toHaveBeenCalled();
  });

  it("keeps the catalogue's own gate and viewport properties", () => {
    trackAssistant("ai_entry_clicked", { ...SAMPLES.ai_entry_clicked, gate: "unhealthy" });
    expect(track.mock.calls[0][1]).toMatchObject({ gate: "unhealthy" });
    trackAssistant("ai_panel_resized", { width_rem: 24, viewport: "tablet" });
    expect(track.mock.calls[1][1]).toMatchObject({ viewport: "tablet" });
  });

  it("allows value only as ai_feedback's up/down enum", () => {
    expect(() => fire("ai_admin", { ...SAMPLES.ai_admin, value: "up" })).toThrow(/value/);
    expect(() => fire("ai_feedback", SAMPLES.ai_feedback, TURN)).not.toThrow();
  });

  it("rejects ai_feedback unless the turn ended done", () => {
    expect(() => fire("ai_feedback", { value: "down", outcome: "failed" }, TURN)).toThrow(/done/);
  });

  it("truncates the unknown frame type to 32 characters", () => {
    trackAssistant("ai_frame_unknown", { type: "x".repeat(80) });
    expect((track.mock.calls[0][1] as { type: string }).type).toHaveLength(32);
  });

  it("feeds the harness sink only when the harness asked for it", () => {
    trackAssistant("ai_sheet_snap", { snap: "full" });
    expect(window.__o2telemetry).toBeUndefined();

    window.__O2_TELEMETRY_SINK__ = true;
    trackAssistant("ai_sheet_snap", { snap: "peek" });
    expect(window.__o2telemetry?.map((e) => e.name)).toEqual(["ai_sheet_snap"]);
  });
});

describe("without RUM", () => {
  it("sends nothing when RUM is not configured", async () => {
    vi.resetModules();
    vi.doUnmock("@/services/product_analytics");
    const rum = await import("@openobserve/browser-rum");
    const addAction = vi.spyOn(rum.openobserveRum, "addAction");
    vi.spyOn(rum.openobserveRum, "getInitConfiguration").mockReturnValue(undefined);
    const fresh = await import("./assistantAnalytics");
    fresh.trackAssistant("ai_sheet_snap", { snap: "half" });
    expect(addAction).not.toHaveBeenCalled();
    vi.doMock("@/services/product_analytics", () => ({ default: { track } }));
  });
});

describe("legacy mapping (one release)", () => {
  it("emits the old names from the new events", () => {
    const snapshot = {
      ai_turn_sent: legacyEventsFor("ai_turn_sent", SAMPLES.ai_turn_sent),
      ai_turn_sent_admitted: admissionLegacyEvents(SAMPLES.ai_turn_sent, "sidebar"),
      ai_turn_sent_rca_admitted: admissionLegacyEvents(SAMPLES.ai_turn_sent, "rca"),
      ai_turn_sent_rca_build_on_previous: admissionLegacyEvents(SAMPLES.ai_turn_sent, "rca", {
        buildOnPrevious: true,
      }),
      ai_turn_ended_done: legacyEventsFor("ai_turn_ended", SAMPLES.ai_turn_ended),
      ai_turn_ended_failed: legacyEventsFor("ai_turn_ended", {
        ...SAMPLES.ai_turn_ended,
        outcome: "failed",
      }),
      ai_turn_ended_refused: legacyEventsFor("ai_turn_ended", {
        ...SAMPLES.ai_turn_ended,
        outcome: "refused",
      }),
      ai_turn_ended_lost: legacyEventsFor("ai_turn_ended", {
        ...SAMPLES.ai_turn_ended,
        outcome: "lost",
      }),
      ai_turn_ended_stopped: legacyEventsFor("ai_turn_ended", {
        ...SAMPLES.ai_turn_ended,
        outcome: "stopped",
      }),
      ai_stop_chat: legacyEventsFor("ai_stop", SAMPLES.ai_stop),
      ai_stop_helper: legacyEventsFor("ai_stop", { ...SAMPLES.ai_stop, surface: "inline_helper" }),
      ai_approval_decided: legacyEventsFor("ai_approval_decided", SAMPLES.ai_approval_decided),
      ai_feedback: legacyEventsFor("ai_feedback", SAMPLES.ai_feedback),
      ai_nl_proposal: legacyEventsFor("ai_nl_proposal", SAMPLES.ai_nl_proposal),
      ai_nl_proposal_failed: legacyEventsFor("ai_nl_proposal", {
        ...SAMPLES.ai_nl_proposal,
        outcome: "failed",
      }),
    };
    expect(snapshot).toMatchInlineSnapshot(`
      {
        "ai_approval_decided": [
          {
            "name": "ai_assistant_tool_call_answered",
            "properties": {
              "approved": true,
            },
          },
        ],
        "ai_feedback": [
          {
            "name": "ai_assistant_feedback_given",
            "properties": {
              "type": "up",
            },
          },
        ],
        "ai_nl_proposal": [
          {
            "name": "ai_query_generated",
            "properties": {},
          },
        ],
        "ai_nl_proposal_failed": [],
        "ai_stop_chat": [
          {
            "name": "ai_assistant_answer_aborted",
            "properties": {},
          },
        ],
        "ai_stop_helper": [],
        "ai_turn_ended_done": [
          {
            "name": "ai_assistant_answer_completed",
            "properties": {},
          },
        ],
        "ai_turn_ended_failed": [
          {
            "name": "ai_assistant_answer_failed",
            "properties": {
              "stage": "stream",
            },
          },
        ],
        "ai_turn_ended_lost": [
          {
            "name": "ai_assistant_answer_failed",
            "properties": {
              "stage": "stream",
            },
          },
        ],
        "ai_turn_ended_refused": [
          {
            "name": "ai_assistant_answer_failed",
            "properties": {
              "stage": "request",
            },
          },
        ],
        "ai_turn_ended_stopped": [],
        "ai_turn_sent": [],
        "ai_turn_sent_admitted": [
          {
            "name": "ai_assistant_message_sent",
            "properties": {
              "has_images": false,
              "new_session": true,
            },
          },
        ],
        "ai_turn_sent_rca_admitted": [
          {
            "name": "incident_rca_requested",
            "properties": {
              "build_on_previous": false,
            },
          },
        ],
        "ai_turn_sent_rca_build_on_previous": [
          {
            "name": "incident_rca_requested",
            "properties": {
              "build_on_previous": true,
            },
          },
        ],
      }
    `);
  });

  it("sends ai_assistant_message_sent only once the turn is admitted", () => {
    trackAssistant("ai_turn_sent", SAMPLES.ai_turn_sent, TURN);
    expect(track.mock.calls.map(([name]) => name)).toEqual(["ai_turn_sent"]);
    trackAssistantAdmitted(TURN);
    expect(track.mock.calls.map(([name]) => name)).toEqual([
      "ai_turn_sent",
      "ai_assistant_message_sent",
    ]);
    expect(() => trackAssistantAdmitted(TURN)).toThrow(/no ai_turn_sent/);
    expect(track).toHaveBeenCalledTimes(2);
  });

  it("keeps build_on_previous on the admitted RCA request", () => {
    setAssistantTelemetryContext({
      getContainer: () => "rca",
      getRoute: () => "incidents",
      getViewport: () => "desktop",
      getEdition: () => "ee",
      getCreditMode: () => "none",
      getRole: () => "admin",
      getOrg: () => "default",
      getGate: () => "available",
      uiVersion: "abc1234",
    });
    trackAssistant("ai_turn_sent", SAMPLES.ai_turn_sent, TURN);
    trackAssistantAdmitted(TURN, { buildOnPrevious: true });
    expect(track.mock.calls[1]).toEqual(["incident_rca_requested", { build_on_previous: true }]);
  });

  it("evicts the oldest held send past the cap, so abandoned turns cannot pile up", () => {
    const turn = (i: number) => ({ ...TURN, turnId: `cap-${i}` });
    for (let i = 0; i <= MAX_PENDING_ADMISSIONS; i++) {
      trackAssistant("ai_turn_sent", SAMPLES.ai_turn_sent, turn(i));
    }
    expect(() => trackAssistantAdmitted(turn(0))).toThrow(/no ai_turn_sent/);
    trackAssistantAdmitted(turn(1));
    trackAssistantAdmitted(turn(MAX_PENDING_ADMISSIONS));
    const sent = track.mock.calls.filter(([name]) => name === "ai_assistant_message_sent");
    expect(sent).toHaveLength(2);
  });

  it("never sends the legacy send event for a turn refused before admission", () => {
    trackAssistant("ai_turn_sent", SAMPLES.ai_turn_sent, TURN);
    trackAssistant("ai_turn_ended", { ...SAMPLES.ai_turn_ended, outcome: "refused" }, TURN);
    expect(() => trackAssistantAdmitted(TURN)).toThrow(/no ai_turn_sent/);
    expect(track.mock.calls.map(([name]) => name)).not.toContain("ai_assistant_message_sent");
  });

  it("sends the legacy event after the new one through the same emitter", () => {
    trackAssistant("ai_turn_ended", SAMPLES.ai_turn_ended, TURN);
    expect(track.mock.calls.map(([name]) => name)).toEqual([
      "ai_turn_ended",
      "ai_assistant_answer_completed",
    ]);
  });
});
