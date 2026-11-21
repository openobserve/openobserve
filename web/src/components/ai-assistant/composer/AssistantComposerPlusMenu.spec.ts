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

import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { createStore } from "vuex";

import AssistantComposerPlusMenu, {
  type ComposerPlusAction,
} from "./AssistantComposerPlusMenu.vue";

const { listToolsets, setEnabled, locked, gate } = vi.hoisted(() => ({
  listToolsets: vi.fn(),
  setEnabled: vi.fn(),
  locked: { value: false },
  gate: { allowed: true },
}));

vi.mock("@/services/ai_toolsets", () => ({ default: { list: listToolsets } }));
vi.mock("@/services/assistant_settings", () => ({
  default: { setToolsetEnabled: setEnabled },
}));
vi.mock("@/composables/useFeatureLock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/useFeatureLock")>()),
  useLicenseLock: () => ({
    locked: computed(() => locked.value),
    lockedReason: computed(() => ""),
  }),
}));
vi.mock("@/utils/enterpriseFeatures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/enterpriseFeatures")>()),
  checkFeatureAccess: () => ({ allowed: gate.allowed }),
}));

// ODropdown renders its items only when open; the stub renders them in place.
const stubs = {
  ODropdown: {
    name: "ODropdown",
    emits: ["close-auto-focus"],
    template: "<div><slot name='trigger' /><slot /></div>",
  },
  ODropdownSub: {
    name: "ODropdownSub",
    props: ["textValue"],
    template:
      "<div data-test='sub'><div role='menuitem' data-test='sub-trigger'><slot name='trigger' /></div><slot /></div>",
  },
  ODropdownItem: {
    emits: ["select"],
    methods: {
      pick(this: { $emit: (name: string, event: Event) => void }) {
        this.$emit("select", new Event("select", { cancelable: true }));
      },
    },
    template:
      '<div v-bind="$attrs" :role="$attrs.role ?? \'menuitem\'" @click="pick"><slot /><slot name=\'icon-right\' /></div>',
  },
};

const TOOLSETS = [
  { id: "t1", name: "github", kind: "mcp", description: "Read issues", enabled: true },
  { id: "t2", name: "runbooks", kind: "skill", description: "", enabled: true },
  { id: "t3", name: "kubectl", kind: "cli", description: "", enabled: false },
];

function setup(actions: ComposerPlusAction[], disabled = false) {
  const queryClient = new QueryClient();
  return mount(AssistantComposerPlusMenu, {
    props: { actions, disabled },
    global: {
      stubs,
      plugins: [
        createRouter({
          history: createMemoryHistory(),
          routes: [
            { path: "/", component: { render: () => null } },
            {
              path: "/settings/assistant/:tab?",
              name: "assistantSettings",
              component: { render: () => null },
            },
          ],
        }),
        [VueQueryPlugin, { queryClient }],
        createStore({ state: { selectedOrganization: { identifier: "acme" }, zoConfig: {} } }),
      ],
    },
  });
}

beforeEach(() => {
  listToolsets.mockReset().mockResolvedValue({ data: { toolsets: TOOLSETS } });
  setEnabled.mockReset().mockResolvedValue(undefined);
  locked.value = false;
  gate.allowed = true;
});

describe("AssistantComposerPlusMenu", () => {
  it("offers Photo and Connectors, in that order (D3)", async () => {
    const wrapper = setup(["connectors", "attach"]);
    await flushPromises();
    const plus = wrapper.get('[data-test="assistant-composer-plus"]');
    expect(plus.attributes("aria-label")).toBe("Add to message");
    expect(wrapper.get('[data-test="assistant-attach-image"]').text().trim()).toBe("Photo");
    expect(wrapper.get('[data-test="sub-trigger"]').text()).toContain("Connectors");
    expect(wrapper.html().indexOf("assistant-attach-image")).toBeLessThan(
      wrapper.html().indexOf("assistant-composer-connectors"),
    );
  });

  it("lists the org's enabled toolsets with a switch, and hides disabled ones (D4')", async () => {
    const wrapper = setup(["attach", "connectors"]);
    await flushPromises();
    const rows = wrapper.findAll('[data-test^="assistant-connector-"]');
    expect(rows.map((row) => row.attributes("data-test"))).toEqual([
      "assistant-connector-github",
      "assistant-connector-runbooks",
    ]);
    expect(rows[0].attributes("aria-checked")).toBe("true");
    expect(wrapper.get('[data-test="sub-trigger"]').text()).toContain("2 on");
    expect(wrapper.find('[data-test="assistant-connectors-scope"]').exists()).toBe(false);
  });

  it("switches a toolset org-wide and keeps its row until the menu closes", async () => {
    const wrapper = setup(["attach", "connectors"]);
    await flushPromises();
    await wrapper.get('[data-test="assistant-connector-github"]').trigger("click");
    await flushPromises();
    expect(setEnabled).toHaveBeenCalledWith("acme", "t1", false);
    expect(wrapper.get('[data-test="assistant-connector-github"]').attributes("aria-checked")).toBe(
      "false",
    );
  });

  it("says which switch failed and puts it back when the server refuses for another reason", async () => {
    setEnabled.mockRejectedValueOnce({ response: { status: 500 } });
    const wrapper = setup(["attach", "connectors"]);
    await flushPromises();
    await wrapper.get('[data-test="assistant-connector-github"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-connector-github"]').attributes("aria-checked")).toBe(
      "true",
    );
    expect(wrapper.get('[data-test="assistant-connectors-toggle-failed"]').text()).toBe(
      "Couldn't switch github. Try again.",
    );
    await wrapper.get('[data-test="assistant-connector-github"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-connectors-toggle-failed"]').exists()).toBe(false);
  });

  it("draws each toolset's kind as a rounded tag, not a pill", async () => {
    const wrapper = setup(["attach", "connectors"]);
    await flushPromises();
    const tag = wrapper
      .get('[data-test="assistant-connector-github"]')
      .findAll("span")
      .find((span) => span.text() === "MCP server")!;
    expect(tag.classes()).toContain("rounded-default");
    expect(tag.classes()).not.toContain("rounded-full");
  });

  it("opens Settings toolsets in a new tab from Add a toolset", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const wrapper = setup(["attach", "connectors"]);
    await flushPromises();
    await wrapper.get('[data-test="assistant-connectors-add"]').trigger("click");
    expect(open).toHaveBeenCalledWith(expect.stringContaining("/assistant/toolsets"), "_blank");
    open.mockRestore();
  });

  it("leaves Connectors out where the Toolsets license or edition gate is closed", async () => {
    locked.value = true;
    expect(setup(["attach", "connectors"]).find('[data-test="sub"]').exists()).toBe(false);
    locked.value = false;
    gate.allowed = false;
    expect(setup(["attach", "connectors"]).find('[data-test="sub"]').exists()).toBe(false);
    expect(listToolsets).not.toHaveBeenCalled();
  });

  it("draws nothing with nothing to offer, and turns off as a whole", () => {
    expect(setup([]).find('[data-test="assistant-composer-plus"]').exists()).toBe(false);
    expect(
      setup(["attach"], true)
        .get('[data-test="assistant-composer-plus"]')
        .attributes("aria-disabled"),
    ).toBe("true");
  });

  it("hands focus back to the + after Photo", async () => {
    const wrapper = setup(["attach"]);
    const menu = wrapper.findComponent({ name: "ODropdown" });
    const event = new Event("focus", { cancelable: true });
    await wrapper.get('[data-test="assistant-attach-image"]').trigger("click");
    menu.vm.$emit("close-auto-focus", event);
    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.emitted("select")).toEqual([["attach"]]);
  });
});
