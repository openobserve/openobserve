// Copyright 2026 OpenObserve Inc.

import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const downloadEnvFile = vi.fn();
vi.mock("@/components/ingestion/setupCard/envFile", () => ({
  downloadEnvFile: (...args: unknown[]) => downloadEnvFile(...args),
}));

import CodingAgentSetup from "./CodingAgentSetup.vue";
import store from "@/test/unit/helpers/store";

const SUBS = { url: "https://api.example.com", org: "team1", token: "dG9rZW4=" };
const startCheck = vi.fn();
const WATCH_STARTED_MS = Date.UTC(2026, 10, 3, 10, 0, 0);
const FIRST_EVENT_STUB = {
  name: "FirstEventStatus",
  template: '<div data-test="first-event-status-stub" />',
  props: [
    "org",
    "signal",
    "targetStream",
    "match",
    "filter",
    "guideName",
    "docUrl",
    "diagnosisAfterMs",
    "snippetKind",
  ],
  emits: ["copy-command", "detected", "state"],
  data: () => ({ startedAtMs: WATCH_STARTED_MS }),
  methods: { start: startCheck, probeNow: vi.fn() },
};
const HEALTH_STUB = {
  name: "CodingAgentDataHealth",
  template: '<div data-test="ai-coding-agent-health-stub" />',
  props: ["org", "stream", "startUs", "agent"],
};

describe("CodingAgentSetup", () => {
  let wrapper: VueWrapper;

  const mountSetup = (props: Partial<InstanceType<typeof CodingAgentSetup>["$props"]> = {}) =>
    mount(CodingAgentSetup, {
      props: {
        subs: SUBS,
        defaultStream: "default",
        guideName: "OpenAI",
        passcodeForbidden: false,
        ...props,
      },
      global: {
        plugins: [store],
        stubs: { FirstEventStatus: FIRST_EVENT_STUB, CodingAgentDataHealth: HEALTH_STUB },
      },
    });

  const promptCode = () => wrapper.findComponent({ name: "OCodeBlock" }).props("code") as string;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("puts the edited stream into the prompt and the first-span check", async () => {
    wrapper = mountSetup({
      detect: { streamType: "traces", filter: "gen_ai_provider_name = 'openai'" },
    });
    expect(promptCode()).toContain("org team1, stream default.");

    await wrapper.find('[data-test="ai-coding-agent-stream-input"] input').setValue("ai_traces");
    await flushPromises();

    expect(promptCode()).toContain("org team1, stream ai_traces.");
    expect(wrapper.findComponent(FIRST_EVENT_STUB).props("targetStream")).toBe("ai_traces");
  });

  it("starts the first-span check when the prompt is copied, as the status row says", async () => {
    wrapper = mountSetup({ detect: { streamType: "traces" } });
    wrapper.findComponent({ name: "OCodeBlock" }).vm.$emit("copy", { partial: false });
    expect(startCheck).toHaveBeenCalledWith("copy");
  });

  it("re-copies through the prompt block when the status bar asks for the command", async () => {
    wrapper = mountSetup({ detect: { streamType: "traces" } });
    const click = vi.fn();
    wrapper
      .find('[data-test="ai-coding-agent-prompt-copy-btn"]')
      .element.addEventListener("click", click);
    wrapper.findComponent(FIRST_EVENT_STUB).vm.$emit("copy-command");
    expect(click).toHaveBeenCalled();
  });

  it("downloads the card's .env plus the chosen stream and the web UI root", async () => {
    wrapper = mountSetup();
    await wrapper.find('[data-test="ai-coding-agent-stream-input"] input').setValue("ai_traces");
    await wrapper.find('[data-test="ai-coding-agent-env-btn"]').trigger("click");
    expect(downloadEnvFile).toHaveBeenCalledWith(SUBS, {
      OPENOBSERVE_TRACES_STREAM_NAME: "ai_traces",
      OPENOBSERVE_UI_URL: window.location.origin,
    });
  });

  it("offers no .env when the org forbids its passcode", () => {
    wrapper = mountSetup({ passcodeForbidden: true });
    expect(wrapper.find('[data-test="ai-coding-agent-passcode-forbidden"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ai-coding-agent-env-btn"]').exists()).toBe(false);
  });

  it("names the coding agents in the prompt step title from code, not the translation", () => {
    wrapper = mountSetup();
    const title = wrapper.find('[data-test="ai-coding-agent-prompt-step"]').text();
    expect(title).toContain("Claude Code, Cursor or Codex");
    expect(title).not.toContain("{client");
  });

  it("keeps the first-span check waiting far longer than the stepped card, and calls it a prompt", () => {
    wrapper = mountSetup({ detect: { streamType: "traces" } });
    const bar = wrapper.findComponent(FIRST_EVENT_STUB);
    expect(bar.props("diagnosisAfterMs")).toBe(15 * 60_000);
    expect(bar.props("snippetKind")).toBe("prompt");
  });

  describe("AI data health after the first span", () => {
    const detect = (firstRecord: Record<string, unknown>, firstRecordUs?: number) =>
      wrapper.findComponent(FIRST_EVENT_STUB).vm.$emit("detected", {
        streamName: "ai_traces",
        streamType: "traces",
        count: 3,
        firstRecord,
        firstRecordUs,
        rangeStart: 0,
        rangeEnd: 1,
      });

    it("shows no checks before the first span", () => {
      wrapper = mountSetup({ detect: { streamType: "traces" } });
      expect(wrapper.findComponent(HEALTH_STUB).exists()).toBe(false);
    });

    it("checks the first span's stream from a minute before the watch, scoped to its agent", async () => {
      wrapper = mountSetup({ detect: { streamType: "traces" } });
      detect({ gen_ai_agent_name: "support-bot" }, (WATCH_STARTED_MS + 30_000) * 1000);
      await flushPromises();
      expect(wrapper.findComponent(HEALTH_STUB).props()).toEqual({
        org: "team1",
        stream: "ai_traces",
        startUs: (WATCH_STARTED_MS - 60_000) * 1000,
        agent: "support-bot",
      });
    });

    it("starts at the first span when it predates the watch, and scopes no agent without one", async () => {
      wrapper = mountSetup({ detect: { streamType: "traces" } });
      detect({ http_method: "GET" }, (WATCH_STARTED_MS - 120_000) * 1000);
      await flushPromises();
      const health = wrapper.findComponent(HEALTH_STUB);
      expect(health.props("startUs")).toBe((WATCH_STARTED_MS - 180_000) * 1000);
      expect(health.props("agent")).toBeUndefined();
    });

    it("drops the checks when the watch restarts for another stream", async () => {
      wrapper = mountSetup({ detect: { streamType: "traces" } });
      detect({}, WATCH_STARTED_MS * 1000);
      await flushPromises();
      expect(wrapper.findComponent(HEALTH_STUB).exists()).toBe(true);
      wrapper.findComponent(FIRST_EVENT_STUB).vm.$emit("state", "waiting");
      await flushPromises();
      expect(wrapper.findComponent(HEALTH_STUB).exists()).toBe(false);
    });
  });
});
