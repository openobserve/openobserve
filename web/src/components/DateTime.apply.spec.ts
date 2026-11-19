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
import { afterEach, describe, expect, it } from "vitest";
import DateTime from "@/components/DateTime.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

describe("DateTime apply", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

  const create = (props: Record<string, unknown>) => {
    wrapper = mount(DateTime, {
      props,
      attachTo: document.body,
      global: { plugins: [i18n, store] },
    });
    return wrapper;
  };

  const changes = () => (wrapper!.emitted("on:date-change") ?? []).length;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("applies a chip at once and emits apply with the range", async () => {
    create({});
    await flushPromises();
    const before = changes();
    wrapper!.vm.pickChip("4h");
    await flushPromises();
    expect(changes()).toBe(before + 1);
    const payload = (wrapper!.emitted("on:date-change") as unknown[][]).at(-1)![0] as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({ valueType: "relative", relativeTimePeriod: "4h" });
    expect(wrapper!.emitted("apply")?.at(-1)).toEqual([
      { kind: "rolling", span: "4h" },
      { source: "panel", run: false },
    ]);
  });

  it("emits no apply for a parent's setter, only the range update", async () => {
    create({});
    await flushPromises();
    wrapper!.vm.setRange({ kind: "calendar", unit: "week", offset: -1 });
    await flushPromises();
    expect(wrapper!.emitted("apply")).toBeUndefined();
    expect(wrapper!.emitted("update:range")?.at(-1)).toEqual([
      { kind: "calendar", unit: "week", offset: -1 },
    ]);
  });

  it("does nothing when the applied range is applied again", async () => {
    create({ defaultRelativeTime: "4h" });
    await flushPromises();
    const before = changes();
    wrapper!.vm.pickChip("4h");
    await flushPromises();
    expect(changes()).toBe(before);
    expect(wrapper!.emitted("apply")).toBeUndefined();
  });

  it("applies a chip at once, as picking a row does", async () => {
    create({});
    await flushPromises();
    const before = changes();
    wrapper!.vm.pickChip("4h");
    await flushPromises();
    expect(changes()).toBe(before + 1);
  });

  it("closes the menu after a chip is applied", async () => {
    create({});
    await flushPromises();
    wrapper!.vm.onMenuOpenChange(true);
    wrapper!.vm.menuOpen = true;
    wrapper!.vm.pickChip("4h");
    await flushPromises();
    expect(wrapper!.vm.menuOpen).toBe(false);
  });

  it("applies a parent-invoked setRelativeDate at once", async () => {
    create({});
    await flushPromises();
    const before = changes();
    wrapper!.vm.setRelativeDate("d", 1);
    await flushPromises();
    expect(changes()).toBe(before + 1);
  });

  it("keeps an absolute range in the open panel a draft until Apply", async () => {
    create({});
    await flushPromises();
    wrapper!.vm.onMenuOpenChange(true);
    wrapper!.vm.menuOpen = true;
    const before = changes();
    wrapper!.vm.selectedType = "absolute";
    wrapper!.vm.selectedDate = { from: "2026/01/01", to: "2026/01/02" };
    wrapper!.vm.selectedTime = { startTime: "01:00", endTime: "02:00" };
    await flushPromises();
    expect(changes()).toBe(before);
  });

  it("marks a changed selection in the open panel as a draft", async () => {
    create({});
    await flushPromises();
    wrapper!.vm.onMenuOpenChange(true);
    wrapper!.vm.menuOpen = true;
    await flushPromises();
    expect(wrapper!.vm.isDraft).toBe(false);

    wrapper!.vm.selectedType = "absolute";
    wrapper!.vm.selectedDate = { from: "2026/01/01", to: "2026/01/02" };
    await flushPromises();
    expect(wrapper!.vm.isDraft).toBe(true);
    expect(wrapper!.vm.showFreezeButton).toBe(false);
  });

  it("freezes a live range at its window and applies it as fixed", async () => {
    create({ defaultRelativeTime: "1h" });
    await flushPromises();
    wrapper!.vm.onMenuOpenChange(true);
    wrapper!.vm.menuOpen = true;
    await flushPromises();
    expect(wrapper!.vm.showFreezeButton).toBe(true);

    wrapper!.vm.freezeRange();
    await flushPromises();

    const [range, meta] = wrapper!.emitted("apply")!.at(-1)! as [
      { kind: string; startUs: number; endUs: number },
      unknown,
    ];
    expect(range.kind).toBe("fixed");
    expect(range.endUs - range.startUs).toBe(3_600_000_000);
    expect(meta).toEqual({ source: "freeze", run: false });
    expect(wrapper!.vm.menuOpen).toBe(false);
  });

  it("hides Freeze and steppers' undo on a form", async () => {
    create({ preset: "form", defaultRelativeTime: "1h" });
    await flushPromises();
    expect(wrapper!.vm.showFreezeButton).toBe(false);
    expect(wrapper!.vm.showUndo).toBe(false);
  });
});
