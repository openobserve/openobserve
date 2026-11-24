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
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { AlertLeaseView } from "@/ts/interfaces/alert";
import LeaseChip from "./LeaseChip.vue";

const NOW_MS = Date.parse("2026-11-20T12:00:00Z");
// 18:00 UTC the same day, in microseconds.
const ENDS_AT = Date.parse("2026-11-20T18:00:00Z") * 1000;

const store = createStore({ state: { timezone: "UTC" } });

const chip = (lease: Partial<AlertLeaseView>) =>
  mount(LeaseChip, {
    props: {
      lease: {
        kind: "created",
        set_value: true,
        ends_at_us: ENDS_AT,
        set_by_name: "AutoObserve",
        reason: "checkout stopped receiving data",
        ...lease,
      },
    },
    global: { plugins: [store] },
  });

// Intl may join the time and AM/PM with a narrow no-break space.
const plain = (s: string | undefined) => (s ?? "").replace(/\s/g, " ");

describe("LeaseChip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    ["created", true, "Temporary, created by AutoObserve, ends at Nov 20, 2026, 6:00 PM"],
    [
      "creates_incident",
      true,
      "Incident creation turned on by AutoObserve until Nov 20, 2026, 6:00 PM",
    ],
    [
      "creates_incident",
      false,
      "Incident creation turned off by AutoObserve until Nov 20, 2026, 6:00 PM",
    ],
  ] as [AlertLeaseView["kind"], boolean, string][])(
    "says what a %s lease (value %s) does, who set it and when it ends",
    (kind, setValue, text) => {
      expect(plain(chip({ kind, set_value: setValue }).text())).toBe(text);
    },
  );

  it("repeats the whole chip and the reason in the hover, since the list cell truncates it", () => {
    const tooltip = plain(chip({}).findComponent(OTooltip).props("content"));
    expect(tooltip).toBe(
      "Temporary, created by AutoObserve, ends at Nov 20, 2026, 6:00 PM. Why: checkout stopped receiving data",
    );
  });

  it("disappears when the lease ends, without a refetch", async () => {
    const wrapper = chip({});
    expect(wrapper.find('[data-test="lease-chip"]').exists()).toBe(true);
    vi.setSystemTime(ENDS_AT / 1000 + 1000);
    await vi.advanceTimersByTimeAsync(6 * 3600 * 1000 + 1000);
    expect(wrapper.find('[data-test="lease-chip"]').exists()).toBe(false);
  });
});
