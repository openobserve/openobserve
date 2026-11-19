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
import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";

vi.mock("@/services/settings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { getSetting: vi.fn(), setUserSetting: vi.fn() },
  });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

import settings from "@/services/settings";
import { toast } from "@/lib/feedback/Toast/useToast";
import { resolveStart, useStartPreference, type StartCandidate } from "./useStartPreference";

const store = createStore({
  state: {
    selectedOrganization: { identifier: "org1" },
    userInfo: { email: "me@example.com" },
  },
});

const setup = async () => {
  let pref!: ReturnType<typeof useStartPreference>;
  mount(
    defineComponent({
      setup() {
        pref = useStartPreference("alert");
        return () => null;
      },
    }),
    { global: { plugins: [store] } },
  );
  await flushPromises();
  return pref;
};

const stored = (value: unknown) =>
  (settings.getSetting as any).mockResolvedValue({ data: { setting_value: value } });

describe("useStartPreference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    store.state.selectedOrganization.identifier = "org1";
  });

  it.each([
    ["absent", null, "last"],
    ["a known choice", "library", "library"],
    ["an unknown value", "wizard", "last"],
  ])("reads the per-user setting: %s gives %s", async (_name, value, expected) => {
    stored(value);
    const pref = await setup();
    expect(settings.getSetting).toHaveBeenCalledWith("org1", "start_with_alert", "me@example.com");
    expect(pref.def.value).toBe(expected);
  });

  it("writes a new default to the ui user setting and shows it before the write lands", async () => {
    stored(null);
    (settings.setUserSetting as any).mockReturnValue(new Promise(() => {}));
    const pref = await setup();
    pref.setDefault("form");
    expect(pref.def.value).toBe("form");
    expect(settings.setUserSetting).toHaveBeenCalledWith(
      "org1",
      "me@example.com",
      "start_with_alert",
      "form",
      "ui",
    );
  });

  it("rolls the default back and says so when the write fails", async () => {
    stored("library");
    (settings.setUserSetting as any).mockRejectedValue(new Error("403"));
    const pref = await setup();
    await pref.setDefault("form");
    expect(pref.def.value).toBe("library");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("remembers the last choice used per organisation in this browser", async () => {
    stored(null);
    const pref = await setup();
    pref.recordUse("library");
    expect(window.localStorage.getItem("o2:start_last:org1:alert")).toBe("library");
    expect(pref.last.value).toBe("library");
    store.state.selectedOrganization.identifier = "org2";
    await flushPromises();
    expect(pref.last.value).toBeNull();
  });
});

describe("resolveStart (first open)", () => {
  const lib = (openable: boolean, count: number | null = 44): StartCandidate => ({
    id: "library",
    openable,
    count,
  });
  const ai = (openable: boolean): StartCandidate => ({ id: "ai", openable, count: null });

  it.each([
    ["the stored default wins", "library", "form", [lib(true)], "library"],
    ["a paused default falls to the last used", "ai", "form", [ai(false), lib(true)], "form"],
    ["last used, when the default is last", "last", "library", [lib(true)], "library"],
    ["a last used pane that is gone is skipped", "last", "ai", [ai(false), lib(true)], "library"],
    ["nothing used yet opens the first pane", "last", null, [ai(true), lib(true)], "ai"],
    ["a pane with no count yet still opens", "last", null, [lib(true, null)], "library"],
    ["a pane known to be empty does not", "last", null, [lib(true, 0)], "form"],
    ["no pane at all goes to the form", "last", null, [lib(false)], "form"],
  ] as const)("%s", (_name, def, last, panes, expected) => {
    expect(resolveStart(def, last, panes)).toBe(expected);
  });
});
