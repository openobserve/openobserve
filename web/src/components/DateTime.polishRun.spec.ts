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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DateTime from "@/components/DateTime.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/utils/timeInputFailure", () => ({ reportParseFailure: vi.fn() }));

const NOW = new Date("2026-11-16T10:00:00Z");
const tr = (key: string, params: Record<string, unknown> = {}) =>
  String((i18n.global.t as unknown as (k: string, p: object) => string)(key, params));
const tp = (key: string, count: number) =>
  String(
    (i18n.global.t as unknown as (k: string, p: object, n: number) => string)(
      key,
      { count },
      count,
    ),
  );

describe("DateTime undo runs on explorer-auto (Bug 3, R10)", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

  const createWrapper = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTime, {
      props,
      attachTo: document.body,
      global: { plugins: [i18n, store] },
    });
    return wrapper;
  };
  const pick = async (chip: string) => {
    vi.setSystemTime(Date.now() + 1000);
    wrapper!.vm.onMenuOpenChange(true);
    wrapper!.vm.menuOpen = true;
    await flushPromises();
    wrapper!.vm.pickChip(chip);
    await flushPromises();
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    store.state.timezone = "UTC";
    store.state.savedViewFlag = false;
    localStorage.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("says undo runs the query and asks the page to run the restored range", async () => {
    createWrapper({ preset: "explorer-auto", shortcuts: true });
    await flushPromises();
    await pick("1h");
    await pick("4h");

    expect(wrapper!.vm.undoTooltip).toBe(
      tr("dateTime.backToRuns", { range: tp("common.pastHour", 1) }),
    );

    vi.setSystemTime(Date.now() + 1000);
    expect(wrapper!.vm.undo()).toBe(true);
    await flushPromises();
    const applies = wrapper!.emitted("apply") as unknown[][];
    expect(applies.at(-1)![1]).toEqual({ source: "undo", run: false, undoRuns: true });
    expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).toBe("1h");
  });

  it("keeps the restore-only undo on explorer-manual with nothing run", async () => {
    createWrapper({ preset: "explorer-manual", shortcuts: true });
    await flushPromises();
    await pick("1h");
    await pick("4h");
    vi.setSystemTime(Date.now() + 1000);
    wrapper!.vm.undo();
    await flushPromises();
    const applies = wrapper!.emitted("apply") as unknown[][];
    expect(applies.at(-1)![1]).toEqual({ source: "undo", run: false, undoRuns: false });
  });
});
