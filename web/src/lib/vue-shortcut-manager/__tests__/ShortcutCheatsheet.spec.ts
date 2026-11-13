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

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import ShortcutCheatsheet from "../ShortcutCheatsheet.vue";

const mac = vi.hoisted(() => ({ value: true }));
vi.mock("@/utils/keyboardShortcuts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/keyboardShortcuts")>()),
  isMacOS: () => mac.value,
}));
vi.mock("vuex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuex")>()),
  useStore: () => store,
}));

const TIME_RANGE_ROWS: [string, string, string[]][] = [
  ["timeRangeOpen", "Open time range", ["T"]],
  ["timeRangePrevious", "Previous range", ["["]],
  ["timeRangeNext", "Next range", ["]"]],
  ["timeRangeZoomOut", "Zoom out", ["-"]],
  ["timeRangeUndo", "Undo range change", ["Z"]],
];

describe("ShortcutCheatsheet — Time range section (S15)", () => {
  let wrapper: VueWrapper | null = null;

  const mountSheet = () =>
    mount(ShortcutCheatsheet, {
      props: { open: true },
      global: {
        plugins: [i18n],
        stubs: {
          ODialog: { template: "<div><slot name='header' /><slot /></div>" },
          OSearchInput: true,
        },
      },
    });

  const row = (id: string) => wrapper!.find(`[data-test="shortcut-cheatsheet-row-${id}"]`);
  const keys = (id: string) =>
    row(id)
      .findAll("kbd")
      .map((k) => k.text());

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    mac.value = true;
  });

  it("lists the Time range module right after Global", () => {
    wrapper = mountSheet();
    const modules = wrapper
      .findAll('[data-test="shortcut-cheatsheet-module"]')
      .map((m) => m.text());
    expect(modules.slice(0, 2)).toEqual(["Global", "Time range"]);
  });

  it.each(TIME_RANGE_ROWS)("shows %s as %s with its key", (id, label, caps) => {
    wrapper = mountSheet();
    expect(row(id).text()).toContain(label);
    expect(keys(id)).toEqual(caps);
  });

  it.each([
    [true, ["⌘", "⇧", "C"]],
    [false, ["Alt", "Shift", "C"]],
  ])("shows Copy time range for mac=%s as %j", (isMac, caps) => {
    mac.value = isMac;
    wrapper = mountSheet();
    expect(row("timeRangeCopy").text()).toContain("Copy time range (picker open)");
    expect(keys("timeRangeCopy")).toEqual(caps);
  });
});
