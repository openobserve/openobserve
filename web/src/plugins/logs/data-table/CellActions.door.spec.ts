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
import { describe, expect, it, vi } from "vitest";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import i18n from "@/locales";

import CellActions from "./CellActions.vue";

const store = vi.hoisted(() => ({
  state: { theme: "light", selectedOrganization: { identifier: "org-b" }, timezone: "UTC" },
}));
vi.mock("vuex", () => ({ useStore: () => store }));
vi.mock("@/composables/assistant/flags", () => ({ isAssistantV2: () => true }));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }));
vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => ({ searchObj: { data: { stream: {}, datetime: {} }, meta: {} } }),
}));
const doors = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("@/components/ai-assistant/entry/AiEntryButton.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    __esModule: true,
    default: defineComponent({
      inheritAttrs: false,
      setup: (_, { attrs }) => {
        doors.props.push(attrs);
        return () => h("span");
      },
    }),
  };
});

describe("CellActions field doors", () => {
  it("carry the org the host loaded the rows under, not the org at hover time (W3)", async () => {
    mount(CellActions, {
      global: { plugins: [i18n] },
      props: {
        boundOrg: "org-a",
        column: { id: "status" },
        row: { status: "200" },
        selectedStreamFields: [{ name: "status", isSchemaField: true }],
      },
    });
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(doors.props.length).toBeGreaterThan(0);
    expect(doors.props.every((p) => p.boundOrg === "org-a")).toBe(true);
  });
});

describe("CellActions copy with the assistant on", () => {
  it("confirms an in-place copy on the button", async () => {
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
    expect(button.attributes("aria-label")).toBe(i18n.global.t("common.copied"));
    expect(icon.props("name")).toBe("check");
    wrapper.unmount();
  });
});
