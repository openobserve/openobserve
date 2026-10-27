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
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";

import kubernetesCard from "@/components/ingestion/setupCard/content/kubernetes";
import linuxCard from "@/components/ingestion/setupCard/content/linux";
import macosCard from "@/components/ingestion/setupCard/content/macos";
import otlpTracesCard from "@/components/ingestion/setupCard/content/otlpTraces";
import rumCard from "@/components/ingestion/setupCard/content/rum";
import windowsCard from "@/components/ingestion/setupCard/content/windows";
import type { RichCardDetect } from "@/components/ingestion/setupCard/types";
import { queryClient } from "@/composables/query/queryClient";
import { maskSecret } from "@/composables/useCredentialSnippet";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import analytics from "@/services/product_analytics";
import store from "@/test/unit/helpers/store";
import { gt } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { b64EncodeStandard } from "@/utils/formatters";

import { buildAgentSetupFile, type AgentFocus } from "./agentSetupFile";
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
  props: ["org", "signal", "targetStream", "match", "filter", "kind"],
  emits: ["state", "detected", "copy-command"],
  // The signal names the instance that restarted, after a focus change mounts a new one.
  setup: (props, { expose }) => {
    expose({ start: (why: string) => start(why, props.signal) });
    return () => h("div", { "data-test": "first-event-status" });
  },
});

const PASSCODE = "s3cret-passcode-value";
const email = store.state.userInfo.email;
const token = b64EncodeStandard(`${email}:${PASSCODE}`)!;
const org = store.state.selectedOrganization.identifier;
const empty = { render: () => null };

// What each setup's guide waits for, read from the guide's own setup card.
const subs = { url: "https://api.example.test", org: "acme", token: "x" };
const rumSubs = {
  site: "",
  endpoint: "",
  org: "acme",
  rumToken: "",
  rumTokenMasked: "",
  insecureHTTP: false,
};
const GUIDE_DETECT: Record<AgentFocus, (RichCardDetect | undefined)[]> = {
  kubernetes: [kubernetesCard(subs, gt).detect],
  host: [linuxCard(subs, gt).detect, macosCard(subs, gt).detect, windowsCard(subs, gt).detect],
  backend: [otlpTracesCard(subs, gt).detect],
  // The LLM guides' cards come with the fetched AI catalog; the agent page waits for any trace.
  llm: [otlpTracesCard(subs, gt).detect],
  frontend: [rumCard(rumSubs, gt).detect],
  // The HTTP logs guide has no card: it watches logs stream default, where its record goes.
  logs: [{ streamType: "logs", streamName: "default", filter: "" }],
};
const FOCUSES = Object.keys(GUIDE_DETECT) as AgentFocus[];
const chooseFocus = async (w: Page, focus: AgentFocus) => {
  w.findComponent(OSelect).vm.$emit("update:modelValue", focus);
  await flushPromises();
};
const RECEIVED = {
  streamName: "default",
  streamType: "traces",
  count: 3,
  rangeStart: 1,
  rangeEnd: 2,
};

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

  it("shows the brand panel with the setup file example, like the other steps", async () => {
    const w = await mountPage();
    expect(byTest(w, "onboarding-preview").classes()).toContain("from-onboarding-panel-start");
    expect(byTest(w, "onboarding-example").attributes("data-kind")).toBe("agent");
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
    expect(start).toHaveBeenCalledWith("copy", "logs");
  });

  it("copies a prompt for the chosen focus, never with the token", async () => {
    const w = await mountPage();
    await byTest(w, "onboarding-agent-setup-copy").trigger("click");
    w.findComponent(OSelect).vm.$emit("update:modelValue", "frontend");
    await flushPromises();
    await byTest(w, "onboarding-agent-setup-copy").trigger("click");
    await flushPromises();
    const [k8s, web] = copiedTexts();
    expect(k8s).toMatch(/^Set up OpenObserve/);
    expect(k8s).toContain("## Kubernetes cluster");
    expect(k8s).not.toContain("## Web frontend");
    expect(web).toContain("## Web frontend");
    for (const text of [k8s, web]) {
      expect(text).toContain(`- Organization: ${org}`);
      expect(text).not.toContain(token);
    }
    expect(analytics.track).toHaveBeenLastCalledWith("onboarding_agent_prompt_copied", {
      focus: "frontend",
    });
    expect(start).toHaveBeenCalledWith("copy", "logs");
  });

  it("unticks the prompt step when the setup changes, as that prompt was never copied", async () => {
    const w = await mountPage();
    const promptStep = () =>
      w.findAllComponents({ name: "OnboardingSetupStep" }).find((s) => s.props("n") === 2)!;
    await byTest(w, "onboarding-agent-setup-copy").trigger("click");
    await flushPromises();
    expect(promptStep().props("done")).toBe(true);
    await chooseFocus(w, "frontend");
    expect(promptStep().props("done")).toBe(false);
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
        focus: "kubernetes",
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

  it.each(FOCUSES)("waits for the same data as the %s setup guide", async (focus) => {
    const w = await mountPage();
    await chooseFocus(w, focus);
    const status = w.findComponent(StatusStub);
    for (const d of GUIDE_DETECT[focus]) {
      expect(d).toBeDefined();
      expect(status.props("signal")).toBe(d!.streamType);
      expect(status.props("targetStream")).toBe(d!.streamName);
      expect(status.props("match")).toBe(d!.match);
      expect(status.props("filter")).toBe(d!.filter);
    }
  });

  it("restarts the watch for a new setup, and a copy restarts the new one", async () => {
    const w = await mountPage();
    const first = w.findComponent(StatusStub).vm;
    first.$emit("detected", RECEIVED);
    await flushPromises();
    expect(byTest(w, "onboarding-first-data").exists()).toBe(true);
    await chooseFocus(w, "host");
    expect(w.findComponent(StatusStub).vm).not.toBe(first);
    // The earlier success was for other data.
    expect(byTest(w, "onboarding-first-data").exists()).toBe(false);
    await byTest(w, "onboarding-agent-setup-copy").trigger("click");
    await flushPromises();
    expect(start).toHaveBeenLastCalledWith("copy", "metrics");
  });

  it("shows the bar only once the setup's own data arrives, as a setup guide does", async () => {
    const w = await mountPage();
    const status = w.findComponent(StatusStub);
    // The inline status shows the wait; a second waiting bar would repeat it.
    expect(w.find('[data-test="onboarding-listen-bar"]').exists()).toBe(false);
    status.vm.$emit("state", "rejected");
    await flushPromises();
    expect(w.find('[data-test="onboarding-listen-bar"]').exists()).toBe(false);
    status.vm.$emit("detected", RECEIVED);
    await flushPromises();
    const panel = byTest(w, "onboarding-first-data");
    expect(panel.text()).toContain("Your data is arriving");
    expect(panel.text()).toContain("3 records arrived in default");
    expect(byTest(w, "onboarding-first-data-open").text()).toBe("Explore Your Traces");
    expect(byTest(w, "onboarding-first-data-note").exists()).toBe(false);
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
