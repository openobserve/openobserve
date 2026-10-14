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
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { useNow } from "@/composables/useNow";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";

const START = Date.UTC(2026, 0, 1, 12);

const Updated = defineComponent({
  props: { value: { type: Number, required: true } },
  setup(props) {
    const now = useNow();
    return () => h(OTimeCell, { value: props.value, unit: "ms", now: now.value });
  },
});

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(START);
  });

  afterEach(() => vi.useRealTimers());

  it("keeps a relative time current and stops ticking once nothing uses it", async () => {
    const w = mount(Updated, { props: { value: START - 5_000 } });
    expect(w.text()).toBe("5 seconds ago");

    vi.advanceTimersByTime(60_000);
    await nextTick();
    expect(w.text()).toBe("1 minute ago");

    w.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares one interval between every subscriber", () => {
    const a = mount(Updated, { props: { value: START } });
    const b = mount(Updated, { props: { value: START } });
    expect(vi.getTimerCount()).toBe(1);
    a.unmount();
    expect(vi.getTimerCount()).toBe(1);
    b.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
