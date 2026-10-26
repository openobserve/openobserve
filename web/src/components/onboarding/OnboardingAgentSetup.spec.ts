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
import { flushPromises, mount } from "@vue/test-utils";
import { http, HttpResponse } from "msw";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";

import { queryClient } from "@/composables/query/queryClient";
import { maskSecret } from "@/composables/useCredentialSnippet";
import { streamKeys } from "@/services/stream.querykeys";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import analytics from "@/services/product_analytics";
import store from "@/test/unit/helpers/store";
import { copyToClipboard } from "@/utils/clipboard";
import { b64EncodeStandard } from "@/utils/formatters";

import { buildAgentSetupFile } from "./agentSetupFile";
import OnboardingAgentSetup from "./OnboardingAgentSetup.vue";

vi.mock("@/composables/useOrgCredential", () => ({
  useOrgCredential: vi.fn(() => ({ ready: { value: true } })),
}));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

// The real status polls the server and has its own specs; this one reports state and detection.
const start = vi.fn();
const StatusStub = defineComponent({
  name: "FirstEventStatus",
  props: ["org", "signal", "targetStream", "kind"],
  emits: ["state", "detected", "copy-command"],
  setup: (_, { expose }) => {
    expose({ start });
    return () => h("div", { "data-test": "first-event-status" });
  },
});

const PASSCODE = "s3cret-passcode-value";
const email = store.state.userInfo.email;
const token = b64EncodeStandard(`${email}:${PASSCODE}`)!;
const org = store.state.selectedOrganization.identifier;
const empty = { render: () => null };

// The org's logs streams; the other types have none.
const serveLogStreams = (logs: string[]) =>
  global.server.use(
    http.get(`${store.state.API_ENDPOINT}/api/:org/streams`, ({ request }) => {
      const type = new URL(request.url).searchParams.get("type");
      return HttpResponse.json({ list: type === "logs" ? logs.map((name) => ({ name })) : [] });
    }),
  );

let router: ReturnType<typeof createRouter>;
async function mountPage() {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/onboarding/:path*", name: "onboarding", component: empty },
      { path: "/iam/mcpServer", name: "mcpServer", component: empty },
      { path: "/logs", name: "logs", component: empty },
      { path: "/traces", name: "traces", component: empty },
      { path: "/", name: "home", component: empty },
      { path: "/ingestion/recommended", name: "recommended", component: empty },
    ],
  });
  await router.push("/onboarding/agent");
  const wrapper = mount(OnboardingAgentSetup, {
    global: { plugins: [store, router], stubs: { FirstEventStatus: StatusStub } },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

type Page = Awaited<ReturnType<typeof mountPage>>;
const byTest = (w: Page, id: string) => w.find(`[data-test="${id}"]`);
const copiedTexts = () => vi.mocked(copyToClipboard).mock.calls.map((c) => c[0]);

describe("OnboardingAgentSetup", () => {
  beforeEach(() => {
    store.state.organizationData.organizationPasscode = PASSCODE;
    Element.prototype.scrollIntoView = vi.fn();
    serveLogStreams([]);
  });

  afterEach(() => {
    store.state.organizationData.organizationPasscode = "";
    queryClient.clear();
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("shows the token masked in the export line and in the PowerShell line", async () => {
    const w = await mountPage();
    const block = byTest(w, "onboarding-agent-setup-token").text();
    expect(block).toContain(`export O2_ACCESS_KEY="${maskSecret(token)}"`);
    expect(block).toContain(`$env:O2_ACCESS_KEY="${maskSecret(token)}"`);
    expect(w.html()).not.toContain(token);
  });

  it("shows the brand panel, like the other steps, with no example screen", async () => {
    const w = await mountPage();
    expect(byTest(w, "onboarding-preview").classes()).toContain("from-onboarding-panel-start");
    expect(w.find('[data-test="onboarding-example"]').exists()).toBe(false);
  });

  it("copies the real token, and a copy restarts the watch", async () => {
    const w = await mountPage();
    await byTest(w, "ingestion-onboarding-agent-token-code-block-copy-btn").trigger("click");
    await byTest(w, "onboarding-agent-setup-powershell-copy").trigger("click");
    await flushPromises();
    expect(copiedTexts()).toEqual([
      `export O2_ACCESS_KEY="${token}"`,
      `$env:O2_ACCESS_KEY="${token}"`,
    ]);
    expect(start).toHaveBeenCalledWith("copy");
  });

  it("copies a prompt for the chosen focus, never with the token", async () => {
    const w = await mountPage();
    await byTest(w, "onboarding-agent-setup-copy").trigger("click");
    w.findComponent(OSelect).vm.$emit("update:modelValue", "kubernetes");
    await flushPromises();
    await byTest(w, "onboarding-agent-setup-copy").trigger("click");
    await flushPromises();
    const [auto, k8s] = copiedTexts();
    expect(auto).toMatch(/^Set up OpenObserve/);
    expect(auto).toContain("## What to set up");
    expect(k8s).toContain("## Kubernetes cluster");
    expect(k8s).not.toContain("## Web frontend");
    for (const text of [auto, k8s]) {
      expect(text).toContain(`- Organization: ${org}`);
      expect(text).not.toContain(token);
    }
    expect(analytics.track).toHaveBeenLastCalledWith("onboarding_agent_prompt_copied", {
      focus: "kubernetes",
    });
    expect(start).toHaveBeenCalledWith("copy");
  });

  it("downloads the file as openobserve-setup.md", async () => {
    const createObjectURL = vi.fn((_: Blob) => "blob:setup");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const w = await mountPage();
    await byTest(w, "onboarding-agent-setup-download").trigger("click");
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("text/markdown");
    // jsdom's Blob has no text(); FileReader reads it.
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    // The test store's ingestion endpoint is its API endpoint.
    expect(text).toContain("- Endpoint: http://localhost:5080\n");
    expect(text).toBe(
      buildAgentSetupFile({
        endpoint: "http://localhost:5080",
        org,
        stream: "default",
        focus: "auto",
      }),
    );
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe("openobserve-setup.md");
    click.mockRestore();
  });

  it("gives a run hint for each agent", async () => {
    const w = await mountPage();
    expect(byTest(w, "onboarding-agent-setup-hint").text()).toContain("run claude in your");
    await byTest(w, "onboarding-agent-setup-agent-cursor").trigger("click");
    expect(byTest(w, "onboarding-agent-setup-hint").text()).toContain("Start Cursor");
    expect(byTest(w, "onboarding-agent-setup-hint").text()).toContain("cursor .");
    await byTest(w, "onboarding-agent-setup-agent-other").trigger("click");
    expect(byTest(w, "onboarding-agent-setup-hint").text()).toContain("openobserve-setup.md");
  });

  it("links to the MCP server page in a new tab", async () => {
    const w = await mountPage();
    const link = byTest(w, "onboarding-agent-setup-mcp");
    expect(link.attributes("href")).toBe(`/iam/mcpServer?org_identifier=${org}`);
    expect(link.attributes("target")).toBe("_blank");
  });

  it("watches any new stream, with the bar mirroring its state", async () => {
    const w = await mountPage();
    const status = w.findComponent(StatusStub);
    expect(status.props("targetStream")).toBeUndefined();
    expect(status.props("signal")).toBeUndefined();
    expect(byTest(w, "onboarding-listen-bar-title").text()).toBe(
      "Waiting for your coding agent's first event",
    );
    status.vm.$emit("state", "rejected");
    await flushPromises();
    expect(byTest(w, "onboarding-listen-bar-title").text()).toBe(
      "Data from your coding agent is being rejected",
    );
    await byTest(w, "onboarding-listen-bar-troubleshoot").trigger("click");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    status.vm.$emit("detected", {
      streamName: "default",
      streamType: "logs",
      count: 1,
      rangeStart: 1,
      rangeEnd: 2,
    });
    await flushPromises();
    const panel = byTest(w, "onboarding-first-data");
    expect(panel.text()).toContain("Your token and endpoint work");
    expect(panel.text()).toContain("1 record arrived in default");
  });

  it("watches the logs stream default for new records when the org already has it", async () => {
    serveLogStreams(["default", "app"]);
    const w = await mountPage();
    const status = w.findComponent(StatusStub);
    expect(status.props("signal")).toBe("logs");
    expect(status.props("targetStream")).toBe("default");
    // Existing traffic holds the watch until a copy.
    status.vm.$emit("state", "idle");
    await flushPromises();
    expect(byTest(w, "onboarding-listen-bar-title").text()).toBe(
      "Copy the prompt to start checking",
    );
    await byTest(w, "onboarding-agent-setup-copy").trigger("click");
    await flushPromises();
    expect(start).toHaveBeenCalledWith("copy");
  });

  it("keeps the watch it chose at page open when the cached list later gains default", async () => {
    const w = await mountPage();
    const status = w.findComponent(StatusStub);
    // The watch refreshes this same cached list when data lands.
    queryClient.setQueryData(streamKeys.nameList(org, "logs"), [{ name: "default" }]);
    await flushPromises();
    expect(w.findComponent(StatusStub).vm).toBe(status.vm);
    expect(status.props("signal")).toBeUndefined();
    expect(status.props("targetStream")).toBeUndefined();
  });

  it("names each step once, as a heading, with no disabled button", async () => {
    const w = await mountPage();
    expect(w.findAll("ol > li h2").map((h) => h.text())).toEqual([
      "Save your token",
      "Copy the prompt",
      "Paste it into your coding agent",
    ]);
    expect(w.findAll("button[disabled]")).toHaveLength(0);
    expect(w.find('[aria-current="step"] h2').text()).toBe("Save your token");
    await byTest(w, "ingestion-onboarding-agent-token-code-block-copy-btn").trigger("click");
    await flushPromises();
    expect(w.find('[aria-current="step"] h2').text()).toBe("Copy the prompt");
    expect(w.findAll("ol > li h2")[0].text()).toBe("Save your token (done)");
  });

  it("after the test event, says to run the app and offers Traces", async () => {
    const w = await mountPage();
    w.findComponent(StatusStub).vm.$emit("detected", {
      streamName: "default",
      streamType: "logs",
      count: 1,
      rangeStart: 1,
      rangeEnd: 2,
    });
    await flushPromises();
    expect(byTest(w, "onboarding-first-data").text()).toContain("Your token and endpoint work");
    expect(byTest(w, "onboarding-first-data-note").text()).toBe(
      "Next, run your app. Its logs, metrics and traces show up here as they arrive.",
    );
    expect(byTest(w, "onboarding-first-data-open").text()).toBe("Explore Your Logs");
    await byTest(w, "onboarding-agent-setup-open-traces").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("traces");
    expect(router.currentRoute.value.query.org_identifier).toBe(org);
  });

  it("adds no next step when the app's own data arrives first", async () => {
    const w = await mountPage();
    w.findComponent(StatusStub).vm.$emit("detected", {
      streamName: "default",
      streamType: "traces",
      count: 3,
      rangeStart: 1,
      rangeEnd: 2,
    });
    await flushPromises();
    expect(byTest(w, "onboarding-first-data-open").text()).toBe("Explore Your Traces");
    expect(byTest(w, "onboarding-first-data-note").exists()).toBe(false);
    expect(byTest(w, "onboarding-agent-setup-open-traces").exists()).toBe(false);
  });

  it("re-copies the export line when the status asks to copy the command", async () => {
    const w = await mountPage();
    w.findComponent(StatusStub).vm.$emit("copy-command");
    await flushPromises();
    expect(copiedTexts()).toEqual([`export O2_ACCESS_KEY="${token}"`]);
  });

  it("goes back", async () => {
    const w = await mountPage();
    await byTest(w, "onboarding-agent-setup-back").trigger("click");
    expect(w.emitted("back")).toHaveLength(1);
  });
});
