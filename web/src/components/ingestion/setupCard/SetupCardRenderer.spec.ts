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

// Renderer-level tests for the two supplementary-section behaviours: the
// collapsed `extras.advanced` block, and the step-note jump links that open it.
// Driven by a synthetic content fixture so these stay independent of any one
// data source's copy.

import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import SetupCardRenderer from "./SetupCardRenderer.vue";
import { iconRegistry } from "@/lib/core/Icon/OIcon.icons";
import type { RichCardContent } from "./types";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import analytics from "@/services/product_analytics";

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: vi.fn() }),
}));

const nameListMock = vi.fn();
vi.mock("@/services/stream", () => ({
  default: { nameList: (...a: any[]) => nameListMock(...a) },
}));
vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

const store = createStore({
  state: {
    selectedOrganization: { identifier: "test-org" },
    userInfo: { email: "t@e.com" },
    organizationData: { organizationPasscode: "pc" },
    theme: "light",
  },
});
const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", component: { template: "<div/>" } }],
});
const SUBS = { url: "https://o2.example.com", org: "test-org", token: "tok" };

const CONTENT: RichCardContent = {
  provider: { id: "demo", name: "Demo", tagline: "A demo card.", logo: "", tone: "#000" },
  steps: [
    {
      id: "install",
      title: "Install",
      description: "Run it.",
      chip: { kind: "terminal", label: "Terminal" },
      completeOn: "copy",
      code: { lang: "bash", raw: "echo hi" },
      note: "Prefer the long way? Go to [Manual Setup](#advanced).",
    },
    {
      id: "verify",
      title: "Verify",
      description: "Check it.",
      completeOn: "detect",
      detectionAnchor: true,
    },
  ],
  detect: { streamType: "logs", streamName: "default", filter: "a IS NOT NULL" },
  extras: {
    advanced: {
      label: "Manual Setup",
      description: "The step-by-step path.",
      code: { lang: "bash", raw: "echo manual-path" },
    },
    troubleshooting: [{ q: "It broke", a: "Turn it off and on." }],
  },
};

const barStart = vi.fn();
const barProbeNow = vi.fn();
// The bar's own polling is covered by FirstEventStatus.spec; here it only reports into the card.
const FirstEventStatusStub = defineComponent({
  name: "FirstEventStatus",
  props: ["org", "signal", "targetStream", "match", "filter", "guideName", "docUrl", "sourceLabel"],
  emits: ["detected", "copy-command", "state"],
  setup(_props, { expose }) {
    expose({ start: barStart, probeNow: barProbeNow });
    return () => h("div", { "data-test": "first-event-status-stub" });
  },
});

const mountCard = (content: RichCardContent = CONTENT) =>
  mount(SetupCardRenderer, {
    props: { content, subs: SUBS },
    global: { plugins: [store, router], stubs: { FirstEventStatus: FirstEventStatusStub } },
    attachTo: document.body,
  });

const bar = (wrapper: VueWrapper<any>) => wrapper.findComponent(FirstEventStatusStub);

describe("SetupCardRenderer — advanced section", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders the advanced accordion collapsed, as its own panel", () => {
    wrapper = mountCard();
    const acc = wrapper.find('[data-test="ai-advanced-accordion"]');
    expect(acc.exists()).toBe(true);
    expect(acc.text()).toContain("Manual Setup");
    // .acc-item carries the border/background so it reads as a real section
    // rather than stray text at the bottom of a long card.
    expect(acc.classes()).toContain("acc-item");
    // Collapsed → Radix leaves the body unmounted entirely.
    expect(wrapper.find('[data-test="ai-advanced-code"]').exists()).toBe(false);
  });

  it("uses icons registered in OIcon, never the material-font fallback", () => {
    // An unregistered name silently degrades to a ligature span, which renders
    // the raw word next to the label. Guard every accordion icon we pass.
    for (const name of ["settings", "layers", "help-outline", "delete-outline"]) {
      expect(name in iconRegistry).toBe(true);
    }
    wrapper = mountCard();
    const acc = wrapper.find('[data-test="ai-advanced-accordion"]');
    expect(acc.find("svg").exists()).toBe(true);
    expect(acc.find(".material-icons-outlined").exists()).toBe(false);
  });

  it("omits the accordion entirely when no advanced content is given", () => {
    wrapper = mountCard({ ...CONTENT, extras: { troubleshooting: [] } });
    expect(wrapper.find('[data-test="ai-advanced-accordion"]').exists()).toBe(false);
  });
});

// Content builders (setupCard/content/*) store copy as i18n keys and the
// renderer resolves them; a consumer that forgets t() shows the user a key.
describe("SetupCardRenderer — key-as-data copy", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const keyed: RichCardContent = {
    ...CONTENT,
    steps: [
      {
        id: "configure",
        titleKey: "ingestion.setupCard.configureCollectorTitle",
        descriptionKey: "ingestion.setupCard.configureCollectorDesc",
        completeOn: "copy",
        inputs: [
          { id: "host", labelKey: "ingestion.setupCard.jmxHostLabel", default: "localhost" },
        ],
        variants: [
          {
            id: "generic",
            labelKey: "ingestion.setupCard.genericWindowsVariant",
            code: { lang: "bash", raw: "echo hi" },
          },
        ],
      },
      CONTENT.steps[1],
    ],
  };

  it("translates titleKey / descriptionKey / labelKey instead of printing the key", () => {
    wrapper = mountCard(keyed);
    const text = wrapper.text();
    expect(text).toContain("Configure the OpenTelemetry Collector");
    // inlineMd turns the `config.yaml` backticks into <code>, so match the prose.
    expect(text).toContain("set the host/port below");
    expect(text).toContain("JMX Host");
    expect(text).toContain("Generic Windows");
    expect(text).not.toContain("ingestion.setupCard.");
  });
});

describe("SetupCardRenderer — uninstall section", () => {
  let wrapper: VueWrapper<any>;

  const withUninstall = (): RichCardContent => ({
    ...CONTENT,
    extras: {
      ...CONTENT.extras,
      uninstall: {
        label: "Uninstall the Agent",
        description: "Removes it.",
        code: { lang: "bash", raw: "sudo ./uninstall.sh" },
      },
    },
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders the uninstall accordion collapsed, as its own panel", () => {
    wrapper = mountCard(withUninstall());
    const acc = wrapper.find('[data-test="ai-uninstall-accordion"]');
    expect(acc.exists()).toBe(true);
    expect(acc.text()).toContain("Uninstall the Agent");
    expect(acc.classes()).toContain("acc-item");
    // Collapsed → the destructive command is not sitting open on the page.
    expect(wrapper.find('[data-test="ai-uninstall-code"]').exists()).toBe(false);
  });

  it("renders it after troubleshooting, so it is the last section", () => {
    wrapper = mountCard(withUninstall());
    const order = wrapper
      .findAll(".acc-item")
      .map((el) => el.attributes("data-test") ?? el.text().slice(0, 20));
    expect(order.at(-1)).toBe("ai-uninstall-accordion");
  });

  it("omits the accordion when a card provides no uninstall path", () => {
    wrapper = mountCard();
    expect(wrapper.find('[data-test="ai-uninstall-accordion"]').exists()).toBe(false);
  });

  it("still renders the section wrapper when uninstall is the only extra", () => {
    // The .c-more guard has to know about uninstall, or the accordion is dropped.
    wrapper = mountCard({
      ...CONTENT,
      extras: {
        uninstall: {
          label: "Uninstall the Agent",
          code: { lang: "bash", raw: "sudo ./uninstall.sh" },
        },
      },
    });
    expect(wrapper.find('[data-test="ai-uninstall-accordion"]').exists()).toBe(true);
  });
});

describe("SetupCardRenderer — footer doc links", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders every docLink as a real anchor beside the primary doc", () => {
    wrapper = mountCard({
      ...CONTENT,
      docUrl: "https://example.com/main",
      docLinks: [
        { label: "Second Guide", url: "https://example.com/second" },
        { label: "Third Guide", url: "https://example.com/third" },
      ],
    });
    const hrefs = wrapper.findAll(".pv-foot a").map((a) => a.attributes("href"));
    expect(hrefs).toEqual([
      "https://example.com/main",
      "https://example.com/second",
      "https://example.com/third",
    ]);
    expect(wrapper.find('[data-test="ai-doc-link-second-guide"]').text()).toBe("Second Guide →");
  });

  it("renders only the primary link when there are no docLinks", () => {
    wrapper = mountCard({ ...CONTENT, docUrl: "https://example.com/main" });
    expect(wrapper.findAll(".pv-foot a")).toHaveLength(1);
  });

  it("refuses unsafe doc link hrefs", () => {
    wrapper = mountCard({
      ...CONTENT,
      docLinks: [{ label: "Evil", url: "javascript:alert(1)" }],
    });
    const evil = wrapper.find('[data-test="ai-doc-link-evil"]');
    expect(evil.attributes("href")).toBe("#");
  });
});

// T1.2 (design 4.2/§6): the one new emit + detect-gated action; existing cards listen to neither.
describe("SetupCardRenderer — first-event bar, detected emit & showOnDetect actions", () => {
  let wrapper: VueWrapper<any>;

  const hostContent = (): RichCardContent => ({
    ...CONTENT,
    steps: [
      CONTENT.steps[0],
      CONTENT.steps[1],
      {
        id: "dashboard",
        title: "Get your dashboard",
        description: "Opens after detection.",
        completeOn: "detect",
        action: {
          id: "view-host-dashboard",
          label: "View dashboard",
          showOnDetect: true,
        } as any,
      },
    ],
    detect: { streamType: "metrics", match: "keyword", streamName: "system_", filter: "" },
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    barStart.mockReset();
    barProbeNow.mockReset();
  });

  it("mounts the bar on the detection step in place of the Test button", () => {
    wrapper = mountCard();
    expect(bar(wrapper).exists()).toBe(true);
    expect(wrapper.find('[data-test="ai-c-test"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="ai-c-statusbar"]').exists()).toBe(false);
  });

  it("hands the bar the card's own detect stream and filter, so Test and the bar never disagree", () => {
    wrapper = mountCard();
    expect(bar(wrapper).props()).toMatchObject({
      org: "test-org",
      signal: "logs",
      targetStream: "default",
      filter: "a IS NOT NULL",
      guideName: "Demo",
    });
  });

  it("hands a keyword-matched card's name fragment and match mode to the bar", () => {
    wrapper = mountCard(hostContent());
    expect(bar(wrapper).props()).toMatchObject({
      signal: "metrics",
      targetStream: "system_",
      match: "keyword",
      filter: undefined,
    });
  });

  it("emits `detected` exactly once, with the count, when the bar reports data", async () => {
    wrapper = mountCard(hostContent());
    bar(wrapper).vm.$emit("detected", { count: 3 });
    await flushPromises();
    bar(wrapper).vm.$emit("detected", { count: 5 });
    await flushPromises();
    expect(wrapper.emitted("detected")).toEqual([[3]]);
  });

  it("tracks data_source_connected with the provider id, not its label, on connect", async () => {
    vi.mocked(analytics.track).mockClear();
    wrapper = mountCard(hostContent());
    bar(wrapper).vm.$emit("detected", { count: 3 });
    await flushPromises();
    expect(analytics.track).toHaveBeenCalledTimes(1);
    expect(analytics.track).toHaveBeenCalledWith("data_source_connected", {
      provider: "demo",
      stream_type: "metrics",
    });
  });

  it("does not emit `detected` on a fresh mount (no transition happened)", async () => {
    wrapper = mountCard(hostContent());
    await flushPromises();
    expect(wrapper.emitted("detected")).toBeUndefined();
  });

  it("hides a showOnDetect action pre-connect and reveals it post-connect", async () => {
    wrapper = mountCard(hostContent());
    expect(wrapper.find('[data-test="ai-step-action-view-host-dashboard"]').exists()).toBe(false);
    bar(wrapper).vm.$emit("detected", { count: 3 });
    await flushPromises();
    expect(wrapper.find('[data-test="ai-step-action-view-host-dashboard"]').exists()).toBe(true);
  });

  it("keeps actions WITHOUT showOnDetect visible regardless of detection state", () => {
    // The ~30 existing cards must render identically (default false).
    const content: RichCardContent = {
      ...CONTENT,
      steps: [
        {
          ...CONTENT.steps[0],
          action: { id: "launch-console", label: "Launch" },
        },
        CONTENT.steps[1],
      ],
    };
    wrapper = mountCard(content);
    expect(wrapper.find('[data-test="ai-step-action-launch-console"]').exists()).toBe(true);
  });

  it("shows the most-likely-fix box only once the bar has a diagnosis, and rechecks through the bar", async () => {
    const content: RichCardContent = {
      ...CONTENT,
      extras: { ...CONTENT.extras, fixSnippet: "import otel_first" },
    };
    wrapper = mountCard(content);
    expect(wrapper.find('[data-test="ai-fix-code"]').exists()).toBe(false);
    bar(wrapper).vm.$emit("state", "no-requests");
    await flushPromises();
    expect(wrapper.find('[data-test="ai-fix-code"]').exists()).toBe(true);
    await wrapper.find('[data-test="ai-c-fix-recheck"]').trigger("click");
    expect(barProbeNow).toHaveBeenCalledTimes(1);
    bar(wrapper).vm.$emit("state", "received");
    await flushPromises();
    expect(wrapper.find('[data-test="ai-fix-code"]').exists()).toBe(false);
  });

  it("re-copies through the first step's own block when the bar asks for the command", async () => {
    wrapper = mountCard();
    const copyBtn = wrapper.find('[data-test="ingestion-setup-code-block-copy-btn"]');
    expect(copyBtn.exists()).toBe(true);
    const clicked = vi.fn();
    copyBtn.element.addEventListener("click", clicked);
    bar(wrapper).vm.$emit("copy-command");
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("names the cluster or host only once the user typed one, never the input's default (B5)", async () => {
    const content: RichCardContent = {
      ...CONTENT,
      steps: [
        {
          ...CONTENT.steps[0],
          inputs: [{ id: "cluster", label: "Cluster", default: "acme-prod-eks" } as any],
        },
        CONTENT.steps[1],
      ],
    };
    wrapper = mountCard(content);
    expect(bar(wrapper).props("sourceLabel")).toBeUndefined();
    const input = wrapper.find('[data-test="ai-input-cluster"] input');
    await input.setValue("web-07");
    expect(bar(wrapper).props("sourceLabel")).toBe("web-07");
    await input.setValue("acme-prod-eks");
    expect(bar(wrapper).props("sourceLabel")).toBeUndefined();
  });
});

describe("SetupCardRenderer — step-note jump links", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders [label](#advanced) as an anchor without leaking markdown", () => {
    wrapper = mountCard();
    const note = wrapper.find(".step-note");
    expect(note.text()).not.toContain("](#advanced)");
    expect(note.text()).not.toContain("[Manual Setup]");

    const link = wrapper.find("a.note-jump");
    expect(link.exists()).toBe(true);
    expect(link.text()).toBe("Manual Setup");
    expect(link.attributes("data-jump")).toBe("advanced");
  });

  it("opens and scrolls to the advanced section on click", async () => {
    wrapper = mountCard();
    const scrollSpy = vi.fn();
    (Element.prototype as any).scrollIntoView = scrollSpy;

    await wrapper.find("a.note-jump").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const code = wrapper.find('[data-test="ai-advanced-code"]');
    expect(code.exists()).toBe(true);
    expect(code.text()).toContain("echo manual-path");
    expect(scrollSpy).toHaveBeenCalled();
  });

  it("leaves ordinary notes untouched", () => {
    const plain: RichCardContent = {
      ...CONTENT,
      steps: [{ ...CONTENT.steps[0], note: "Just a plain note." }, CONTENT.steps[1]],
    };
    wrapper = mountCard(plain);
    expect(wrapper.find(".step-note").text()).toContain("Just a plain note.");
    expect(wrapper.find("a.note-jump").exists()).toBe(false);
  });

  it("does not turn arbitrary link targets into anchors", () => {
    // Only the fixed #advanced / #troubleshooting alternation is linkified, so
    // authored content cannot inject a URL through a note.
    const evil: RichCardContent = {
      ...CONTENT,
      steps: [
        {
          ...CONTENT.steps[0],
          note: "See [click me](javascript:alert(1)) and [x](#nope).",
        },
        CONTENT.steps[1],
      ],
    };
    wrapper = mountCard(evil);
    const html = wrapper.find(".step-note").html();
    // Neither target is linkified, so no anchor is produced at all...
    expect(wrapper.find("a.note-jump").exists()).toBe(false);
    expect(wrapper.find(".step-note a").exists()).toBe(false);
    // ...and the payload survives only as inert escaped text, never an href.
    expect(html).not.toContain('href="javascript:');
    expect(wrapper.find(".step-note").text()).toContain("javascript:alert(1)");
  });
});

describe("SetupCardRenderer — product analytics", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("tracks snippet_copied with the current route and partial flag, and restarts the bar's fast cadence", () => {
    wrapper = mountCard();

    wrapper.findComponent(OCodeBlock).vm.$emit("copy", { partial: true });

    expect(analytics.track).toHaveBeenCalledWith("snippet_copied", {
      route: router.currentRoute.value.name,
      partial: true,
    });
    expect(barStart).toHaveBeenCalledWith("copy");
  });

  it("makes every step block copy on click and names the token only where it is masked", () => {
    const content: RichCardContent = {
      ...CONTENT,
      steps: [
        { ...CONTENT.steps[0], code: { lang: "bash", raw: "key=pc", masked: "key=••" } },
        CONTENT.steps[1],
      ],
    };
    const tokenStore = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        userInfo: { email: "t@e.com" },
        organizationData: {
          organizationPasscode: "pc",
          orgTokens: [{ name: "default", token: "pc" }],
        },
        theme: "light",
      },
    });
    wrapper = mount(SetupCardRenderer, {
      props: { content, subs: SUBS },
      global: {
        plugins: [tokenStore, router],
        stubs: { FirstEventStatus: FirstEventStatusStub },
      },
    });
    const block = wrapper.findComponent(OCodeBlock);
    expect(block.props("copyOnClick")).toBe(true);
    expect(block.props("tokenName")).toBe("default");
  });
});
