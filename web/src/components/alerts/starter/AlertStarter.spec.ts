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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { queryClient } from "@/composables/query/queryClient";

vi.mock("@/services/settings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { getSetting: vi.fn(), setUserSetting: vi.fn() },
  });
});
vi.mock("@/components/alerts/starter/AlertLibraryPane.vue", () => ({
  default: { name: "AlertLibraryPane", template: "<div data-test='library-pane-stub' />" },
}));
vi.mock("@/components/alerts/starter/BulkAddReview.vue", () => ({
  default: { name: "BulkAddReview", template: "<div />" },
}));

import settings from "@/services/settings";
import AlertStarter from "./AlertStarter.vue";

const store = createStore({
  state: {
    selectedOrganization: { identifier: "org1" },
    userInfo: { email: "me@example.com" },
    zoConfig: {},
  },
});

const render = async (stored: string | null) => {
  (settings.getSetting as any).mockResolvedValue({ data: { setting_value: stored } });
  const w = mount(AlertStarter, { attachTo: document.body, global: { plugins: [store] } });
  await flushPromises();
  return w;
};

describe("AlertStarter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  it.each([
    ["the form", "form", true],
    ["the library", "library", false],
  ])("New alert set to %s", async (_name, stored, split) => {
    const w = await render(stored);
    expect(w.find("[data-test=alert-starter-caret]").exists()).toBe(split);
    await w.find("[data-test=alert-list-add-alert-btn]").trigger("click");
    await flushPromises();
    expect(!!w.emitted("open-form")).toBe(split);
    expect(!!document.body.querySelector("[data-test=library-pane-stub]")).toBe(!split);
    w.unmount();
  });

  it("opens the starter from the caret even when New alert opens the form", async () => {
    const w = await render("form");
    await w.find("[data-test=alert-starter-caret]").trigger("click");
    await flushPromises();
    expect(w.emitted("open-form")).toBeUndefined();
    expect(document.body.querySelector("[data-test=library-pane-stub]")).not.toBeNull();
    w.unmount();
  });
});
