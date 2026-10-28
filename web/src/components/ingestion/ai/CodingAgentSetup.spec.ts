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
const FIRST_EVENT_STUB = {
  name: "FirstEventStatus",
  template: '<div data-test="first-event-status-stub" />',
  props: ["org", "signal", "targetStream", "match", "filter", "guideName", "docUrl"],
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
      global: { plugins: [store], stubs: { FirstEventStatus: FIRST_EVENT_STUB } },
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
    const title = wrapper.find('[data-test="ai-coding-agent-prompt-step"] h3').text();
    expect(title).toContain("Claude Code, Cursor or Codex");
    expect(title).not.toContain("{client");
  });
});
