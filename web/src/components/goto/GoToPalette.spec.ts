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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { computed, defineComponent, h, provide, ref } from "vue";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { raw } from "@/types/i18n";
import { GO_TO_PAGES, type GoToPage } from "@/composables/goto/types";
import { HOME_RETURN_QUERY_KEY } from "@/composables/goto/homeReturn";

import GoToPalette from "./GoToPalette.vue";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  openAssistant: vi.fn(() => Promise.resolve({ ok: true })),
  canChat: { value: true },
}));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/composables/assistant", () => ({
  openAssistant: mocks.openAssistant,
  useAssistantCapability: () => ({ assistantCanChat: mocks.canChat }),
}));
vi.mock("@/services/common", () => ({
  default: { list_Folders: vi.fn(() => Promise.resolve({ data: { list: [] } })) },
}));
vi.mock("@/services/alerts", () => ({
  default: { listByFolderId: vi.fn(() => Promise.resolve({ data: { list: [] } })) },
}));
vi.mock("@/services/dashboards", () => ({
  default: { list: vi.fn(() => Promise.resolve({ data: { dashboards: [] } })) },
}));

const PAGES: GoToPage[] = [
  {
    id: "logs",
    label: raw("Logs"),
    route: { path: "/logs", query: { org_identifier: "default" } },
  },
  {
    id: "logsPatterns",
    label: raw("Logs patterns"),
    route: { path: "/patterns", query: { org_identifier: "default" } },
  },
];

describe("GoToPalette", () => {
  let wrapper: VueWrapper | undefined;
  const open = ref(true);

  const mountPalette = async (homeReturn: { focus: "ask" } | null = null) => {
    const Host = defineComponent({
      setup() {
        provide(
          GO_TO_PAGES,
          computed(() => PAGES),
        );
        return () =>
          h(GoToPalette, {
            open: open.value,
            "onUpdate:open": (value: boolean) => (open.value = value),
            homeReturn,
          });
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = mount(Host, {
      attachTo: document.body,
      global: { plugins: [i18n, store, [VueQueryPlugin, { queryClient }]] },
    });
    await flushPromises();
  };
  const input = () =>
    document.querySelector<HTMLInputElement>(
      '[data-test="go-to-palette-input"] input, input[data-test="go-to-palette-input"]',
    )!;
  const type = async (text: string) => {
    input().value = text;
    input().dispatchEvent(new Event("input"));
    await flushPromises();
  };
  const press = async (key: string) => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    await flushPromises();
  };

  beforeEach(() => {
    open.value = true;
    mocks.canChat.value = true;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("renders the search as a combobox over the results listbox", async () => {
    await mountPalette();
    expect(input().getAttribute("role")).toBe("combobox");
    expect(input().getAttribute("aria-controls")).toBe("go-to-palette-listbox");
    expect(input().getAttribute("placeholder")).toBe("Go to a page");
    expect(document.getElementById("go-to-palette-listbox")?.getAttribute("role")).toBe("listbox");
  });

  it("asks through the go_to_palette door on Enter without arrowing", async () => {
    await mountPalette();
    await type("logs pat");
    await press("Enter");
    expect(mocks.openAssistant).toHaveBeenCalledWith({
      entryKind: "go_to_palette",
      entryVerb: "ask",
      objectKind: "none",
      intent: "send",
      thread: "new",
      container: "sidebar",
      payload: { text: "logs pat", chips: [] },
    });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(open.value).toBe(false);
  });

  it("opens an exact match on Enter and carries the way back from Home", async () => {
    await mountPalette({ focus: "ask" });
    await type("logs");
    expect(input().getAttribute("aria-activedescendant")).toBe("go-to-palette-listbox-option-0");
    await press("Enter");
    expect(mocks.openAssistant).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith({
      path: "/logs",
      query: { [HOME_RETURN_QUERY_KEY]: "focus=ask", org_identifier: "default" },
    });
  });

  it("opens Logs on Enter after typing its name one letter at a time", async () => {
    await mountPalette();
    for (const text of ["l", "lo", "log", "logs"]) await type(text);
    expect(input().getAttribute("aria-activedescendant")).toBe("go-to-palette-listbox-option-0");
    await press("Enter");
    expect(mocks.openAssistant).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith(PAGES[0].route);
  });

  it("opens the arrowed match without a way back elsewhere", async () => {
    await mountPalette();
    await type("logs pat");
    await press("ArrowDown");
    await press("Enter");
    expect(mocks.push).toHaveBeenCalledWith(PAGES[1].route);
  });

  it("offers no Ask row without AI, so Enter opens the first match", async () => {
    mocks.canChat.value = false;
    await mountPalette();
    await type("logs pat");
    expect(document.querySelector('[data-kind="ask"]')).toBeNull();
    await press("Enter");
    expect(mocks.push).toHaveBeenCalledWith(PAGES[1].route);
  });

  it("closes on Escape", async () => {
    await mountPalette();
    await press("Escape");
    expect(open.value).toBe(false);
  });
});
