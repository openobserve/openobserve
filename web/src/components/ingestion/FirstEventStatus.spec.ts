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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, nextTick, ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import type {
  FirstEventDiagnosis,
  FirstEventResult,
  FirstEventState,
} from "@/composables/firstEvent/useFirstEventWatch";
import FirstEventStatus from "./FirstEventStatus.vue";
import { FIRST_EVENT_ASK_AI } from "./firstEventAskAi";
import analytics from "@/services/product_analytics";

const fake = {
  state: ref<FirstEventState>("waiting"),
  result: ref<FirstEventResult>(),
  diagnosis: ref<FirstEventDiagnosis>(),
  startedAtMs: ref<number>(),
  scope: ref<"new-data" | "since-watch-start">("new-data"),
  troubleshooting: ref(false),
  sinceUs: ref<number>(),
  start: vi.fn(),
  stop: vi.fn(),
  probeNow: vi.fn(),
  troubleshoot: vi.fn(),
};
const watchArgs = vi.fn();
vi.mock("@/composables/firstEvent/useFirstEventWatch", () => ({
  useFirstEventWatch: (...args: unknown[]) => {
    watchArgs(...args);
    return {
      ...fake,
      scope: computed(() => fake.scope.value),
      sinceUs: computed(() => fake.sinceUs.value),
    };
  },
}));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
const awsConfig = vi.hoisted(() => ({ isEnterprise: "false", isCloud: "false" }));
vi.mock("@/aws-exports", () => ({ default: awsConfig }));

const NOW = Date.UTC(2026, 9, 7, 10, 0, 0);
const routes = ["logs", "metrics", "traces", "recommended", "curl"].map((name) => ({
  path: `/${name}`,
  name,
  component: { template: "<div />" },
}));

const makeStore = (zoConfig: Record<string, unknown> = {}) =>
  createStore({
    state: {
      API_ENDPOINT: "https://api.openobserve.ai",
      zoConfig: { cluster_name: "US1", ...zoConfig },
      selectedOrganization: { identifier: "acme-prod" },
      organizations: [],
      organizationData: {
        organizationPasscode: "secret-token-value",
        orgTokens: [{ name: "default", token: "secret-token-value" }],
      },
    },
  });

let wrapper: VueWrapper;
let router: ReturnType<typeof createRouter>;
const mountBar = (
  props: Record<string, unknown> = {},
  opts: { askAi?: (q: string) => void; zoConfig?: Record<string, unknown> } = {},
) => {
  router = createRouter({ history: createMemoryHistory(), routes });
  wrapper = mount(FirstEventStatus, {
    props: { org: "acme-prod", guideName: "Kubernetes", ...props },
    global: {
      plugins: [i18n, makeStore(opts.zoConfig), router],
      provide: opts.askAi ? { [FIRST_EVENT_ASK_AI as symbol]: opts.askAi } : {},
    },
  });
  return wrapper;
};
const q = (id: string) => wrapper.find(`[data-test="${id}"]`);

const rejection = (reason: string, status: number, extra: Record<string, unknown> = {}) => ({
  firstSeen: NOW * 1000 - 60_000_000,
  status,
  reason,
  path: "/api/acme-prod/v1/logs",
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  fake.state.value = "waiting";
  fake.result.value = undefined;
  fake.diagnosis.value = undefined;
  fake.startedAtMs.value = NOW;
  fake.scope.value = "new-data";
  fake.troubleshooting.value = false;
  fake.sinceUs.value = undefined;
  awsConfig.isEnterprise = "false";
});

afterEach(() => {
  wrapper?.unmount();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("FirstEventStatus — waiting", () => {
  it("starts the watch on mount with no click and passes the guide's stream and filter", () => {
    mountBar({ signal: "logs", targetStream: "default", filter: "k8s_namespace_name IS NOT NULL" });
    expect(fake.start).toHaveBeenCalledWith("open");
    const [org, signal, opts] = watchArgs.mock.calls[0] as [
      { value: string },
      { value: string },
      { targetStream: { value: string }; filter: { value: string } },
    ];
    expect([org.value, signal.value, opts.targetStream.value, opts.filter.value]).toEqual([
      "acme-prod",
      "logs",
      "default",
      "k8s_namespace_name IS NOT NULL",
    ]);
  });

  it("names the source and shows the cadence and elapsed time on a ticking clock", async () => {
    mountBar({ sourceLabel: "acme-prod-eks" });
    expect(q("first-event-status").attributes("data-state")).toBe("waiting");
    expect(q("first-event-status").text()).toContain("Waiting for data from acme-prod-eks");
    expect(q("first-event-status-meta").text()).toBe("Checking every 5 s · started 0 s ago");
    await vi.advanceTimersByTimeAsync(42_000);
    expect(q("first-event-status-meta").text()).toBe("Checking every 5 s · started 42 s ago");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(q("first-event-status-meta").text()).toBe("Checking every 5 s · started 1 min ago");
    await vi.advanceTimersByTimeAsync(600_000);
    expect(q("first-event-status-meta").text()).toContain("Checking every 30 s");
  });

  it("reads the elapsed time in minutes, never as an m:ss clock time (H-6)", async () => {
    mountBar();
    fake.startedAtMs.value = NOW - (23 * 60 + 59) * 1000;
    await vi.advanceTimersByTimeAsync(1);
    expect(q("first-event-status-meta").text()).toBe("Checking every 30 s · started 24 min ago");
    expect(q("first-event-status-meta").text()).not.toMatch(/\d+:\d{2}/);
  });

  it.each([
    ["new-data", "Waiting for your first data"],
    ["since-watch-start", "Waiting for new data"],
  ] as const)("never shows a keyword fragment as a stream (%s)", async (scope, text) => {
    fake.scope.value = scope;
    mountBar({ signal: "metrics", targetStream: "system_", match: "keyword" });
    expect(q("first-event-status").text()).toContain(text);
    expect(q("first-event-status").text()).not.toContain("system_");
  });

  it("names the typed source over a keyword fragment", () => {
    mountBar({ signal: "metrics", targetStream: "mysql", match: "keyword", sourceLabel: "db-07" });
    expect(q("first-event-status").text()).toContain("Waiting for data from db-07");
  });

  it("offers Troubleshoot on the waiting bar from the first second and shows it loading", async () => {
    mountBar();
    const btn = q("first-event-status-troubleshoot-btn");
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    expect(fake.troubleshoot).toHaveBeenCalledTimes(1);
    fake.troubleshooting.value = true;
    await nextTick();
    expect(q("first-event-status-troubleshoot-btn").attributes("aria-busy")).toBe("true");
    expect(fake.state.value).toBe("waiting");
  });
});

describe("FirstEventStatus — received", () => {
  const result: FirstEventResult = {
    streamName: "default",
    streamType: "logs",
    count: 1284,
    firstRecord: { _timestamp: 1, _o2_id: "x", k8s_namespace_name: "checkout", level: "info" },
    firstRecordUs: NOW * 1000,
    rangeStart: NOW * 1000 - 900_000_000,
    rangeEnd: NOW * 1000 + 900_000_000,
  };

  it("shows the count, stream, source and first record, and fires first_event_detected once", async () => {
    mountBar({ sourceLabel: "acme-prod-eks" });
    fake.result.value = result;
    fake.state.value = "received";
    await nextTick();
    expect(q("first-event-status").attributes("data-state")).toBe("received");
    expect(q("first-event-status").text()).toContain("First event received");
    expect(q("first-event-status-summary").text()).toBe(
      "1,284 records in stream default from acme-prod-eks",
    );
    const record = q("first-event-status-first-record").text();
    expect(record).toContain('"k8s_namespace_name":"checkout"');
    expect(record).not.toContain("_timestamp");
    expect(record).not.toContain("_o2_id");
    expect(q("first-event-status-setup-another-btn").exists()).toBe(true);
    expect(q("first-event-status-connect-source-btn").exists()).toBe(false);
    expect(analytics.track).toHaveBeenCalledWith("first_event_detected", {
      stream_type: "logs",
      seconds_since_signup: -1,
    });
    expect(wrapper.emitted("detected")).toEqual([[result]]);
    fake.state.value = "waiting";
    await nextTick();
    fake.state.value = "received";
    await nextTick();
    expect(
      vi.mocked(analytics.track).mock.calls.filter((c) => c[0] === "first_event_detected"),
    ).toHaveLength(2);
  });

  it("opens Logs on the stream with the thirty minutes around the first record", async () => {
    mountBar();
    fake.result.value = result;
    fake.state.value = "received";
    await nextTick();
    await q("first-event-status-open-btn").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("logs");
    expect(router.currentRoute.value.query).toMatchObject({
      org_identifier: "acme-prod",
      stream: "default",
      stream_type: "logs",
      from: String(result.rangeStart),
      to: String(result.rangeEnd),
    });
  });

  it("sends a metrics record to the explorer by metric name, in milliseconds", async () => {
    mountBar();
    fake.result.value = { ...result, streamType: "metrics", streamName: "up" };
    fake.state.value = "received";
    await nextTick();
    expect(q("first-event-status-open-btn").text()).toBe("Open in Metrics");
    await q("first-event-status-open-btn").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({
      metric: "up",
      from: String(result.rangeStart / 1000),
    });
  });

  it("reads Test event received with Connect your real source primary on a test guide", async () => {
    mountBar({ kind: "test", guideRoute: "recommended" });
    fake.result.value = { ...result, count: 1 };
    fake.state.value = "received";
    await nextTick();
    expect(q("first-event-status").attributes("data-kind")).toBe("test");
    expect(q("first-event-status").text()).toContain("Test event received");
    expect(q("first-event-status-summary").text()).toBe(
      "1 record in stream default · your endpoint and token work",
    );
    expect(q("first-event-status-connect-source-btn").exists()).toBe(true);
    expect(q("first-event-status-setup-another-btn").exists()).toBe(false);
    await q("first-event-status-connect-source-btn").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("recommended");
  });

  it("counts records since the server-clock watch start in an org with data", async () => {
    mountBar({ targetStream: "default" });
    fake.scope.value = "since-watch-start";
    const since = new Date(2026, 9, 7, 10, 41).getTime() * 1000;
    fake.result.value = { ...result, count: 312, sinceUs: since };
    fake.state.value = "received";
    await nextTick();
    expect(q("first-event-status").attributes("data-scope")).toBe("since-watch-start");
    expect(q("first-event-status").text()).toContain("New data received");
    expect(q("first-event-status-summary").text()).toBe(
      "312 records since 10:41 in stream default",
    );
  });
});

describe("FirstEventStatus — diagnosis", () => {
  it.each([
    ["invalid_credentials", 401, "doesn't match org token default"],
    ["malformed_body", 400, "Check the payload format"],
    ["batch_too_large", 413, "Lower the batch size"],
    ["rate_or_quota", 429, "check the plan"],
  ])("names %s in words with its fix", async (reason, status, fix) => {
    mountBar();
    fake.diagnosis.value = {
      form: "rejected",
      trigger: "auto",
      rejections: [rejection(reason, status)],
    };
    fake.state.value = "rejected";
    await nextTick();
    expect(q("first-event-status").attributes("data-state")).toBe("rejected");
    expect(q("first-event-status-summary").text()).toContain("Requests to acme-prod are refused:");
    expect(q("first-event-status-summary").text()).toContain(
      "· since 09:59 on /api/acme-prod/v1/logs",
    );
    expect(q("first-event-status-summary").text()).not.toMatch(/\d+ requests?\b|last 10 min/);
    expect(q("first-event-status-summary").text()).toContain(String(status));
    expect(q("first-event-status-summary").text()).not.toContain(reason);
    expect(q("first-event-diagnosis-fix").text()).toContain(fix);
    expect(q("first-event-diagnosis").attributes("data-trigger")).toBe("auto");
    expect(q("first-event-status-troubleshoot-btn").exists()).toBe(false);
  });

  it.each([
    [undefined, "The token your sender uses doesn't match this org's current token."],
    ["config", "The password in your Fluent Bit config doesn't match this org's current token."],
  ])("reads a whole sentence when the current token has no name (%s)", async (kind, fix) => {
    mountBar(kind ? { snippetKind: kind } : {});
    (wrapper.vm as unknown as { $store: { state: any } }).$store.state.organizationData.orgTokens =
      [];
    fake.diagnosis.value = {
      form: "rejected",
      trigger: "auto",
      rejections: [rejection("invalid_credentials", 401)],
    };
    fake.state.value = "rejected";
    await nextTick();
    expect(q("first-event-diagnosis-fix").text()).toContain(fix);
    expect(q("first-event-diagnosis-fix").text()).not.toContain("org token the");
  });

  it("sets the token name apart from the path with a spaced separator", async () => {
    mountBar();
    fake.diagnosis.value = {
      form: "rejected",
      trigger: "auto",
      rejections: [rejection("invalid_credentials", 401, { tokenName: "ci-token" })],
    };
    fake.state.value = "rejected";
    await nextTick();
    expect(q("first-event-status-summary").text()).toContain(
      "on /api/acme-prod/v1/logs · token ci-token",
    );
  });

  it("still names a cause first seen 15 min ago, with since HH:MM and no count", async () => {
    mountBar();
    fake.diagnosis.value = {
      form: "rejected",
      trigger: "auto",
      rejections: [
        rejection("malformed_body", 400, { firstSeen: NOW * 1000 - 15 * 60_000_000 }),
        rejection("invalid_credentials", 401, { firstSeen: NOW * 1000 - 40 * 60_000_000 }),
      ],
    };
    fake.state.value = "rejected";
    await nextTick();
    expect(q("first-event-status").attributes("data-reason")).toBe("malformed_body");
    expect(q("first-event-status-summary").text()).toMatch(
      /^Requests to acme-prod are refused: 400 malformed body · since 09:45 on \/api\/acme-prod\/v1\/logs$/,
    );
  });

  it("puts the short date in front of a first-seen time from another day", async () => {
    mountBar();
    fake.diagnosis.value = {
      form: "rejected",
      trigger: "troubleshoot",
      rejections: [
        rejection("invalid_credentials", 401, {
          firstSeen: Date.UTC(2026, 9, 6, 23, 42) * 1000,
          tokenName: "ci",
        }),
      ],
    };
    fake.state.value = "rejected";
    await nextTick();
    const summary = q("first-event-status-summary").text();
    expect(summary).toContain("· since Oct 6 23:42 on");
    expect(summary).toContain("token ci");
  });

  it("reads Copy config on a Fluent Bit guide and asks the page to re-copy its block", async () => {
    mountBar({ snippetKind: "config" });
    fake.diagnosis.value = {
      form: "rejected",
      trigger: "troubleshoot",
      rejections: [rejection("invalid_credentials", 401)],
    };
    fake.state.value = "rejected";
    await nextTick();
    expect(q("first-event-diagnosis-copy-btn").text()).toBe("Copy config");
    expect(q("first-event-diagnosis-fix").text()).toContain("Fluent Bit");
    await q("first-event-diagnosis-copy-btn").trigger("click");
    expect(wrapper.emitted("copy-command")).toHaveLength(1);
  });

  it("shows the org id, endpoint and compare sentence when no request reached the org", async () => {
    mountBar();
    fake.diagnosis.value = { form: "no-requests", trigger: "troubleshoot", rejections: [] };
    fake.state.value = "no-requests";
    await nextTick();
    expect(q("first-event-status-summary").text()).toBe(
      "Nothing has arrived in acme-prod in US1 since the check started 0 s ago, and no request was refused.",
    );
    expect(q("first-event-diagnosis-fix").text()).toBe(
      "Check that your command uses this org id and endpoint.",
    );
    expect(q("first-event-diagnosis-org-id").text()).toBe("acme-prod");
    expect(q("first-event-diagnosis-endpoint").text()).toBe("https://api.openobserve.ai");
    expect(q("first-event-diagnosis-copy-btn").text()).toBe("Copy command");
  });

  it("falls back to the ingestion host for the region and reads the last 2 minutes after the automatic run", async () => {
    mountBar({}, { zoConfig: { cluster_name: "" } });
    fake.startedAtMs.value = NOW - 130_000;
    fake.diagnosis.value = { form: "no-requests", trigger: "auto", rejections: [] };
    fake.state.value = "no-requests";
    await nextTick();
    expect(q("first-event-status-summary").text()).toBe(
      "Nothing has arrived in acme-prod in api.openobserve.ai in the last 2 minutes, and no request was refused.",
    );
  });

  it("ends the diagnosis with the Still stuck row: the guide's docs in a new tab, no support link", async () => {
    mountBar({ docUrl: "https://openobserve.ai/docs/k8s" });
    fake.diagnosis.value = { form: "no-requests", trigger: "auto", rejections: [] };
    fake.state.value = "no-requests";
    await nextTick();
    expect(q("first-event-diagnosis-still-stuck").text()).toBe("Still stuck? Kubernetes docs");
    const docs = q("first-event-diagnosis-docs-link");
    expect(docs.text()).toBe("Kubernetes docs");
    expect(docs.attributes()).toMatchObject({
      href: "https://openobserve.ai/docs/k8s",
      target: "_blank",
      rel: "noopener noreferrer",
    });
    expect(wrapper.find('[data-test="first-event-diagnosis-contact-support-link"]').exists()).toBe(
      false,
    );
    expect(q("first-event-diagnosis-ask-ai-btn").exists()).toBe(false);
  });

  it("hides the Still stuck row when the guide has no doc URL and AI chat is off", async () => {
    mountBar();
    fake.diagnosis.value = { form: "no-requests", trigger: "auto", rejections: [] };
    fake.state.value = "no-requests";
    await nextTick();
    expect(wrapper.find('[data-test="first-event-diagnosis-still-stuck"]').exists()).toBe(false);
  });

  it("shows Ask AI only where AI chat is on, and its prompt never carries the token", async () => {
    awsConfig.isEnterprise = "true";
    const askAi = vi.fn();
    mountBar({}, { askAi, zoConfig: { ai_enabled: true } });
    fake.diagnosis.value = {
      form: "rejected",
      trigger: "auto",
      rejections: [rejection("invalid_credentials", 401)],
    };
    fake.state.value = "rejected";
    await nextTick();
    await q("first-event-diagnosis-ask-ai-btn").trigger("click");
    expect(askAi).toHaveBeenCalledTimes(1);
    const prompt = askAi.mock.calls[0][0] as string;
    expect(prompt).toContain("Kubernetes");
    expect(prompt).toContain("401");
    expect(prompt).toContain("acme-prod");
    expect(prompt).toContain("https://api.openobserve.ai");
    expect(prompt).not.toContain("secret-token-value");
  });

  it("tells Ask AI that nothing has arrived and no request was refused", async () => {
    awsConfig.isEnterprise = "true";
    const askAi = vi.fn();
    mountBar({}, { askAi, zoConfig: { ai_enabled: true } });
    fake.diagnosis.value = { form: "no-requests", trigger: "auto", rejections: [] };
    fake.state.value = "no-requests";
    await nextTick();
    await q("first-event-diagnosis-ask-ai-btn").trigger("click");
    const prompt = askAi.mock.calls[0][0] as string;
    expect(prompt).toContain(
      "The first-event check says: nothing has arrived and no request was refused.",
    );
    expect(prompt).not.toContain("no requests reached");
  });

  it("hides Ask AI when the page provides no AI hand-off or AI is off", async () => {
    awsConfig.isEnterprise = "true";
    mountBar({}, { zoConfig: { ai_enabled: true } });
    fake.diagnosis.value = { form: "no-requests", trigger: "auto", rejections: [] };
    fake.state.value = "no-requests";
    await nextTick();
    expect(q("first-event-diagnosis-ask-ai-btn").exists()).toBe(false);
    wrapper.unmount();
    mountBar({}, { askAi: vi.fn(), zoConfig: { ai_enabled: false } });
    fake.state.value = "no-requests";
    await nextTick();
    expect(q("first-event-diagnosis-ask-ai-btn").exists()).toBe(false);
  });

  it("fires first_event_diagnosis_shown once per watch with reason and trigger", async () => {
    mountBar();
    fake.diagnosis.value = {
      form: "rejected",
      trigger: "troubleshoot",
      rejections: [rejection("malformed_body", 400)],
    };
    fake.state.value = "rejected";
    await nextTick();
    fake.diagnosis.value = { form: "no-requests", trigger: "troubleshoot", rejections: [] };
    fake.state.value = "no-requests";
    await nextTick();
    const calls = vi
      .mocked(analytics.track)
      .mock.calls.filter((c) => c[0] === "first_event_diagnosis_shown");
    expect(calls).toEqual([
      ["first_event_diagnosis_shown", { reason: "malformed_body", trigger: "troubleshoot" }],
    ]);
  });

  it("reports the diagnosis again on the watch Check again restarts", async () => {
    mountBar();
    fake.diagnosis.value = { form: "no-requests", trigger: "auto", rejections: [] };
    fake.state.value = "no-requests";
    await nextTick();
    fake.state.value = "stopped";
    await nextTick();
    fake.diagnosis.value = undefined;
    fake.state.value = "waiting";
    await nextTick();
    fake.diagnosis.value = { form: "no-requests", trigger: "auto", rejections: [] };
    fake.state.value = "no-requests";
    await nextTick();
    const calls = vi
      .mocked(analytics.track)
      .mock.calls.filter((c) => c[0] === "first_event_diagnosis_shown");
    expect(calls).toHaveLength(2);
  });

  it("names the install check only on a guide where the user typed a host or cluster", async () => {
    mountBar({ sourceLabel: "acme-prod-eks" });
    fake.diagnosis.value = { form: "no-requests", trigger: "auto", rejections: [] };
    fake.state.value = "no-requests";
    await nextTick();
    expect(q("first-event-diagnosis").text()).toContain(
      "Check the install finished on acme-prod-eks.",
    );
  });
});

describe("FirstEventStatus — recent_rejections unavailable", () => {
  it("stays waiting after a failed Troubleshoot and shows no cause, status or error", async () => {
    const consoleError = vi.spyOn(console, "error");
    mountBar({ docUrl: "https://openobserve.ai/docs/k8s" });
    fake.diagnosis.value = { form: "unavailable", trigger: "troubleshoot", rejections: [] };
    await nextTick();
    expect(q("first-event-status").attributes("data-state")).toBe("waiting");
    const diag = q("first-event-diagnosis");
    expect(diag.attributes("data-reason")).toBe("unavailable");
    expect(diag.attributes("data-trigger")).toBe("troubleshoot");
    expect(q("first-event-diagnosis-fix").text()).toContain("no cause can be named");
    expect(q("first-event-diagnosis-org-id").text()).toBe("acme-prod");
    expect(q("first-event-diagnosis-copy-btn").exists()).toBe(true);
    expect(q("first-event-diagnosis-still-stuck").exists()).toBe(true);
    expect(wrapper.text()).not.toMatch(/\b(403|404|500|503)\b/);
    expect(q("first-event-status-troubleshoot-btn").exists()).toBe(false);
    expect(
      vi.mocked(analytics.track).mock.calls.filter((c) => c[0] === "first_event_diagnosis_shown"),
    ).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("keeps the plain waiting bar after a failed automatic read", async () => {
    mountBar();
    fake.startedAtMs.value = NOW - 13 * 60_000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(q("first-event-diagnosis").exists()).toBe(false);
    expect(q("first-event-status").attributes("data-state")).toBe("waiting");
    expect(q("first-event-status-troubleshoot-btn").exists()).toBe(true);
    expect(wrapper.text()).toContain("Checks stop after 60 minutes");
  });
});

describe("FirstEventStatus — pill display for empty pages", () => {
  it("renders the pill and its line only, with the page's waiting label and no bar actions", () => {
    mountBar({ signal: "logs", display: "pill", waitingLabel: "Waiting for your first logs" });
    const root = q("first-event-status");
    expect(root.attributes("data-display")).toBe("pill");
    expect(root.attributes("data-state")).toBe("waiting");
    expect(root.text()).toContain("Waiting for your first logs");
    expect(q("first-event-status-meta").text()).toContain("Checking every 5 s");
    expect(q("first-event-status-troubleshoot-btn").exists()).toBe(false);
    expect(fake.start).toHaveBeenCalledWith("open");
  });

  it("keeps the waiting pill and its meta past 120 s: the pill makes no automatic diagnosis", async () => {
    mountBar({ signal: "logs", display: "pill", waitingLabel: "Waiting for your first logs" });
    const opts = watchArgs.mock.calls[0][2] as { autoDiagnosis: { value: boolean } };
    expect(opts.autoDiagnosis.value).toBe(false);
    await vi.advanceTimersByTimeAsync(130_000);
    expect(q("first-event-status").attributes("data-state")).toBe("waiting");
    expect(q("first-event-status").text()).toContain("Waiting for your first logs");
    expect(q("first-event-status").text()).not.toContain("Nothing has arrived yet");
    expect(q("first-event-status-meta").text()).toBe("Checking every 5 s · started 2 min ago");
  });

  it("names no cause and opens no diagnosis on a rejected send", async () => {
    mountBar({ display: "pill" });
    fake.state.value = "rejected";
    fake.diagnosis.value = {
      form: "rejected",
      trigger: "auto",
      rejections: [rejection("invalid_credentials", 401)],
    };
    await nextTick();
    expect(q("first-event-status").attributes("data-state")).toBe("rejected");
    expect(q("first-event-diagnosis").exists()).toBe(false);
  });

  it("offers Check again after the 60-minute stop and restarts the watch from it", async () => {
    mountBar({ display: "pill" });
    fake.start.mockClear();
    fake.state.value = "stopped";
    await nextTick();
    expect(q("first-event-status").attributes("data-state")).toBe("stopped");
    expect(q("first-event-status").text()).toContain("Checks stopped");
    expect(q("first-event-status-meta").text()).toBe("No data arrived in 60 minutes");

    await q("first-event-status-restart-btn").trigger("click");
    expect(fake.start).toHaveBeenCalledWith("open");
    fake.state.value = "waiting";
    fake.startedAtMs.value = NOW;
    await nextTick();
    expect(q("first-event-status").attributes("data-state")).toBe("waiting");
    expect(q("first-event-status-restart-btn").exists()).toBe(false);
  });

  it("offers no Check again while the watch runs", () => {
    mountBar({ display: "pill" });
    expect(q("first-event-status-restart-btn").exists()).toBe(false);
  });

  it("summarises the first records and reports the detection once", async () => {
    mountBar({ signal: "logs", display: "pill" });
    fake.result.value = {
      streamName: "default",
      streamType: "logs",
      count: 1284,
      rangeStart: 0,
      rangeEnd: 1,
    };
    fake.state.value = "received";
    await nextTick();
    expect(q("first-event-status-summary").text()).toContain("1,284 records in stream default");
    expect(wrapper.emitted("detected")).toHaveLength(1);
    expect(
      vi.mocked(analytics.track).mock.calls.filter((c) => c[0] === "first_event_detected"),
    ).toHaveLength(1);
  });

  it("keeps the bar on every other page", () => {
    mountBar({ signal: "logs", waitingLabel: "Waiting for your first logs" });
    expect(
      (watchArgs.mock.calls[0][2] as { autoDiagnosis: { value: boolean } }).autoDiagnosis.value,
    ).toBe(true);
    expect(q("first-event-status").attributes("data-display")).toBeUndefined();
    expect(q("first-event-status-troubleshoot-btn").exists()).toBe(true);
    expect(q("first-event-status").text()).not.toContain("Waiting for your first logs");
  });
});
