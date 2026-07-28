// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

import AgentSetupDrawer from "./AgentSetupDrawer.vue";

// ── Stubs ───────────────────────────────────────────────────────────────────
// ODrawer is stubbed open-regardless so the composer is always in the DOM; the
// tabs are the real components (their v-model wiring is what's under test).

const ODrawerStub = {
  name: "ODrawer",
  props: ["open", "side", "size", "title", "subTitle"],
  template: "<div><slot /></div>",
};

const OInputStub = {
  name: "OInput",
  props: ["modelValue", "label", "placeholder", "required", "size"],
  emits: ["update:modelValue"],
  template:
    '<input :value="modelValue" v-bind="$attrs" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const OButtonStub = {
  name: "OButton",
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
};

const OTagStub = { name: "OTag", template: "<span><slot /></span>" };

const STUBS = {
  ODrawer: ODrawerStub,
  OInput: OInputStub,
  OButton: OButtonStub,
  OTag: OTagStub,
};

const BASE_PROPS = {
  open: true,
  scriptUrl: "https://example.test/install.sh",
  o2Url: "http://host.docker.internal:5080",
  org: "default",
  token: "o2syn_test",
  locationName: "lcl-dev",
};

function mountDrawer(props: Record<string, unknown> = {}) {
  return mount(AgentSetupDrawer, {
    props: { ...BASE_PROPS, ...props },
    global: { stubs: STUBS },
  }) as VueWrapper;
}

function command(wrapper: VueWrapper): string {
  return wrapper.find('[data-test="synthetics-agent-setup-install-cmd"]').text();
}

// Reka's TabsTrigger doesn't activate from a synthetic jsdom click, so the tab
// strip is driven through the v-model contract it exposes — which is the part
// this component owns. OTabs' own click handling is covered by its own suite.
async function selectTab(wrapper: VueWrapper, dataTest: string, name: string) {
  wrapper.findComponent(`[data-test="${dataTest}"]`).vm.$emit("update:modelValue", name);
  await flushPromises();
}

describe("AgentSetupDrawer", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("agent type tabs", () => {
    it("should default to the net probe and omit --type from the command", () => {
      wrapper = mountDrawer();

      expect(wrapper.find('[data-test="synthetics-agent-setup-type-tabs"]').exists()).toBe(true);
      expect(command(wrapper)).not.toContain("--type=browser");
    });

    it("should open on the browser tab when agentType is browser", () => {
      wrapper = mountDrawer({ agentType: "browser" });

      expect(command(wrapper)).toContain("--type=browser");
    });

    it("should add --type=browser when the browser tab is selected", async () => {
      wrapper = mountDrawer();
      await selectTab(wrapper, "synthetics-agent-setup-type-tabs", "browser");

      expect(command(wrapper)).toContain("--type=browser");
    });

    it("should drop --type=browser when switching back to the net probe", async () => {
      wrapper = mountDrawer({ agentType: "browser" });
      await selectTab(wrapper, "synthetics-agent-setup-type-tabs", "protocol");

      expect(command(wrapper)).not.toContain("--type=browser");
    });
  });

  describe("platform tabs under browser", () => {
    it("should offer the native-binary platforms for the net probe", () => {
      wrapper = mountDrawer();
      const tabs = wrapper.find('[data-test="synthetics-agent-setup-platform-tabs"]');

      expect(tabs.find('[data-otab-name="linux"]').exists()).toBe(true);
      expect(tabs.find('[data-otab-name="windows"]').exists()).toBe(true);
    });

    it("should hide the native-binary platforms for the browser agent", async () => {
      wrapper = mountDrawer();
      await selectTab(wrapper, "synthetics-agent-setup-type-tabs", "browser");
      const tabs = wrapper.find('[data-test="synthetics-agent-setup-platform-tabs"]');

      expect(tabs.find('[data-otab-name="docker"]').exists()).toBe(true);
      expect(tabs.find('[data-otab-name="k8s"]').exists()).toBe(true);
      expect(tabs.find('[data-otab-name="linux"]').exists()).toBe(false);
      expect(tabs.find('[data-otab-name="windows"]').exists()).toBe(false);
    });

    it("should fall back to docker when browser is picked from a native-binary platform", async () => {
      wrapper = mountDrawer();
      await selectTab(wrapper, "synthetics-agent-setup-platform-tabs", "linux");
      expect(command(wrapper)).toContain("--platform=linux");

      await selectTab(wrapper, "synthetics-agent-setup-type-tabs", "browser");
      expect(command(wrapper)).toContain("--platform=docker");
      expect(command(wrapper)).not.toContain("--platform=linux");
    });
  });
});
