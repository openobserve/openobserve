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

import { flushPromises, mount } from "@vue/test-utils";
import { OTableToolbarOwnerKey } from "@/lib/core/Table/OTable.types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import i18n from "@/locales";

import CellActions from "./CellActions.vue";

const store = vi.hoisted(() => ({
  state: { theme: "light", selectedOrganization: { identifier: "org-b" }, timezone: "UTC" },
}));
vi.mock("vuex", () => ({ useStore: () => store }));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }));
vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => ({ searchObj: { data: { stream: {}, datetime: {} }, meta: {} } }),
}));
const env = await vi.hoisted(async () => ({
  gate: (await import("vue")).ref("available"),
  add: (await import("vitest")).vi.fn(),
}));
vi.mock("@/composables/assistant/pure", async (importOriginal) => {
  const { computed } = await import("vue");
  return {
    ...(await importOriginal<typeof import("@/composables/assistant/pure")>()),
    runtimeHandle: () => ({ value: { store: { state: { userOrgKey: "u|org-a" } } } }),
    useAssistantGate: () => computed(() => env.gate.value),
  };
});
vi.mock("@/plugins/logs/logsDoors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/plugins/logs/logsDoors")>()),
  addDoorToChat: env.add,
}));
vi.mock("@/components/common/O2AIContextAddBtn.vue", () => ({
  default: {
    emits: ["sendToAiChat"],
    template: '<button data-test="ai-sparkle-stub" @click="$emit(\'sendToAiChat\')" />',
  },
}));

const mountActions = (props: Record<string, unknown> = {}) =>
  mount(CellActions, {
    global: { plugins: [i18n] },
    props: {
      column: { id: "status" },
      row: { status: "200" },
      selectedStreamFields: [{ name: "status", isSchemaField: true }],
      ...props,
    },
  });

describe("CellActions AI button (main's sparkle)", () => {
  beforeEach(() => {
    env.add.mockClear();
    env.gate.value = "available";
  });

  it("adds the field bound to the org the host loaded the rows under, with the key captured at mount (W3)", async () => {
    const w = mountActions({ boundOrg: "org-a" });
    await w.get('[data-test="ai-sparkle-stub"]').trigger("click");
    expect(env.add).toHaveBeenCalledWith(
      expect.objectContaining({ objectKind: "log_field", boundOrg: "org-a" }),
      "u|org-a",
      null,
    );
  });

  it("names the table cell as the invoker, since its toolbar unmounts once focus leaves it", async () => {
    const cell = document.createElement("td");
    const w = mount(CellActions, {
      global: { plugins: [i18n], provide: { [OTableToolbarOwnerKey as symbol]: () => cell } },
      props: {
        column: { id: "status" },
        row: { status: "200" },
        selectedStreamFields: [{ name: "status", isSchemaField: true }],
      },
    });
    await w.get('[data-test="ai-sparkle-stub"]').trigger("click");
    expect(env.add).toHaveBeenCalledWith(expect.anything(), "u|org-a", cell);
  });

  it("holds copy, include, exclude and the AI button together in one toolbar, as on main", () => {
    const bar = mountActions().get(".table-cell-actions");
    expect(bar.find('[data-test="logs-cell-actions-copy-btn"]').exists()).toBe(true);
    expect(bar.find('[data-test="log-details-include-field-200"]').exists()).toBe(true);
    expect(bar.find('[data-test="log-details-exclude-field-200"]').exists()).toBe(true);
    expect(bar.findAll('[data-test="ai-sparkle-stub"]')).toHaveLength(1);
  });

  it("hides the AI button while the assistant is not configured", () => {
    env.gate.value = "not_configured";
    expect(mountActions().find('[data-test="ai-sparkle-stub"]').exists()).toBe(false);
  });
});

describe("CellActions copy with the assistant on", () => {
  it("copies in place through the shared Copied bubble, leaving the button as it was", async () => {
    const wrapper = mount(CellActions, {
      global: { plugins: [i18n] },
      props: {
        copyInPlace: true,
        column: { id: "status" },
        row: { status: "200" },
        selectedStreamFields: [],
      },
    });
    const button = wrapper.get('[data-test="logs-cell-actions-copy-btn"]');
    const icon = button.findComponent(OIcon);
    expect(button.attributes("aria-label")).toBe(i18n.global.t("logs.cellActions.copy"));
    expect(icon.props("name")).toBe("content-copy");
    await button.trigger("click");
    await flushPromises();
    expect(wrapper.emitted("copy")).toBeUndefined();
    expect(button.attributes("aria-label")).toBe(i18n.global.t("logs.cellActions.copy"));
    expect(icon.props("name")).toBe("content-copy");
    wrapper.unmount();
  });
});
