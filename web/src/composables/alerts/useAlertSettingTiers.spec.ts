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
import { defineComponent, h, nextTick, reactive, ref } from "vue";
import { mount } from "@vue/test-utils";
import { useAlertSettingTiers, type AlertSettingTiers } from "./useAlertSettingTiers";
import type { AlertSettingId } from "@/components/alerts/alertSettingTiers";

const host = (set: Partial<Record<AlertSettingId, boolean>>) => {
  let api: AlertSettingTiers | null = null;
  mount(
    defineComponent({
      setup() {
        api = useAlertSettingTiers({
          available: () => true,
          isSet: (id) => set[id] === true,
          showAll: ref(false),
        });
        return () => h("div");
      },
    }),
  );
  return () => api!;
};

describe("useAlertSettingTiers", () => {
  it("a setting set from the start stays shown when its value is cleared", async () => {
    const set = reactive<Partial<Record<AlertSettingId, boolean>>>({ holdFor: true });
    const api = host(set);
    expect(api().isVisible("holdFor")).toBe(true);
    set.holdFor = false;
    await nextTick();
    expect(api().isVisible("holdFor")).toBe(true);
    expect(
      api()
        .view("condition")
        .more.map((d) => d.id),
    ).not.toContain("holdFor");
  });

  it("keeps a setting that gained a value during the session", async () => {
    const set = reactive<Partial<Record<AlertSettingId, boolean>>>({});
    const api = host(set);
    expect(api().isVisible("priority")).toBe(false);
    set.priority = true;
    await nextTick();
    set.priority = false;
    await nextTick();
    expect(api().isVisible("priority")).toBe(true);
  });

  it("showAll on expands every section without a click", () => {
    const showAll = ref(false);
    const tiers = useAlertSettingTiers({ available: () => true, isSet: () => false, showAll });
    expect(tiers.isVisible("priority")).toBe(false);
    showAll.value = true;
    expect(tiers.view("notify").expanded).toBe(true);
    expect(tiers.view("condition").more).toEqual([]);
    expect(tiers.isVisible("priority")).toBe(true);
    expect(tiers.isVisible("description")).toBe(true);
  });

  it("conceal returns a revealed setting to its link", () => {
    const tiers = useAlertSettingTiers({
      available: () => true,
      isSet: () => false,
      showAll: ref(false),
    });
    tiers.reveal("description");
    expect(tiers.isVisible("description")).toBe(true);
    tiers.conceal("description");
    expect(tiers.isVisible("description")).toBe(false);
    expect(tiers.view("notify").addLinks.map((d) => d.id)).toContain("description");
  });

  it("still hides an unset setting that was never shown", async () => {
    const set = reactive<Partial<Record<AlertSettingId, boolean>>>({ holdFor: true });
    const api = host(set);
    await nextTick();
    expect(api().isVisible("warning")).toBe(false);
    expect(api().isVisible("recovery")).toBe(false);
  });

  it("places only the rows the user brings in below the line, and keeps them there", async () => {
    const set = reactive<Partial<Record<AlertSettingId, boolean>>>({ priority: true });
    const showAll = ref(false);
    const tiers = useAlertSettingTiers({
      available: () => true,
      isSet: (id) => set[id] === true,
      showAll,
    });
    const below = () =>
      (["holdFor", "keepFiring", "priority", "tags", "description"] as AlertSettingId[]).filter(
        tiers.placedBelow,
      );
    expect(below()).toEqual([]);
    tiers.toggle("notify");
    expect(below()).toEqual(["keepFiring", "tags"]);
    set.tags = true;
    await nextTick();
    tiers.toggle("notify");
    tiers.bring("description");
    expect(below()).toEqual(["tags", "description"]);
    showAll.value = true;
    expect(below()).toEqual([]);
    showAll.value = false;
    set.tags = false;
    tiers.conceal("tags");
    expect(below()).toEqual(["description"]);
    expect(tiers.view("notify").more.map((d) => d.id)).toContain("tags");
  });
});
