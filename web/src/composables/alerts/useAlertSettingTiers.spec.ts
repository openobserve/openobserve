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

import { describe, it, expect } from "vitest";
import { defineComponent, h, nextTick, reactive } from "vue";
import { mount } from "@vue/test-utils";
import { useAlertSettingTiers, type AlertSettingTiers } from "./useAlertSettingTiers";
import type { AlertSettingId } from "@/components/alerts/alertSettingTiers";

const host = (set: Partial<Record<AlertSettingId, boolean>>) => {
  let api: AlertSettingTiers | null = null;
  mount(
    defineComponent({
      setup() {
        api = useAlertSettingTiers({ available: () => true, isSet: (id) => set[id] === true });
        return () => h("div");
      },
    }),
  );
  return () => api!;
};

describe("useAlertSettingTiers", () => {
  it("keeps a tucked setting on screen after its value is cleared", async () => {
    const set = reactive<Partial<Record<AlertSettingId, boolean>>>({ holdFor: true });
    const api = host(set);
    expect(api().isVisible("holdFor")).toBe(true);
    set.holdFor = false;
    await nextTick();
    expect(api().isVisible("holdFor")).toBe(true);
    expect(
      api()
        .view("condition")
        .tucked.map((d) => d.id),
    ).not.toContain("holdFor");
  });

  it("keeps a setting that gained a value during the session", async () => {
    const set = reactive<Partial<Record<AlertSettingId, boolean>>>({});
    const api = host(set);
    expect(api().isVisible("tags")).toBe(false);
    set.tags = true;
    await nextTick();
    set.tags = false;
    await nextTick();
    expect(api().isVisible("tags")).toBe(true);
  });

  it("still hides an unset setting that was never shown", async () => {
    const set = reactive<Partial<Record<AlertSettingId, boolean>>>({ holdFor: true });
    const api = host(set);
    await nextTick();
    expect(api().isVisible("warning")).toBe(false);
    expect(api().isVisible("recovery")).toBe(false);
  });
});
