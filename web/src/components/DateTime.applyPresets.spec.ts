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

describe("DateTime applyPresets", () => {
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

  it("applies a relative chip at once when applyPresets is set", async () => {
    create({ applyPresets: true });
    await flushPromises();
    const before = changes();
    wrapper!.vm.pickRelativeChip("h", 6);
    await flushPromises();
    expect(changes()).toBe(before + 1);
    const payload = (wrapper!.emitted("on:date-change") as unknown[][]).at(-1)![0] as Record<
      string,
      unknown
    >;
    expect(payload.valueType).toBe("relative");
  });

  it("keeps a relative chip pending without applyPresets or autoApply", async () => {
    create({});
    await flushPromises();
    const before = changes();
    wrapper!.vm.pickRelativeChip("h", 6);
    await flushPromises();
    expect(changes()).toBe(before);
  });

  it("closes the menu after a preset is applied", async () => {
    create({ applyPresets: true });
    await flushPromises();
    wrapper!.vm.menuOpen = true;
    wrapper!.vm.pickRelativeChip("h", 6);
    await flushPromises();
    expect(wrapper!.vm.menuOpen).toBe(false);
  });

  it("keeps a custom relative value pending until Apply", async () => {
    create({ applyPresets: true });
    await flushPromises();
    const before = changes();
    wrapper!.vm.relativeValue = 7;
    wrapper!.vm.onCustomPeriodSelect();
    await flushPromises();
    expect(changes()).toBe(before);
    wrapper!.vm.applyAndClose();
    await flushPromises();
    expect(changes()).toBe(before + 1);
  });

  it("applies a parent-invoked setRelativeDate at once", async () => {
    create({ applyPresets: true });
    await flushPromises();
    const before = changes();
    wrapper!.vm.setRelativeDate("d", 1);
    await flushPromises();
    expect(changes()).toBe(before + 1);
  });

  it("keeps an absolute range pending until Apply", async () => {
    create({ applyPresets: true });
    await flushPromises();
    const before = changes();
    wrapper!.vm.setDateType("absolute");
    wrapper!.vm.selectedDate = { from: "2026/01/01", to: "2026/01/02" };
    wrapper!.vm.selectedTime = { startTime: "01:00", endTime: "02:00" };
    await flushPromises();
    expect(changes()).toBe(before);
  });
});
