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
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import OTable from "./OTable.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import type { OTableColumnDef } from "./OTable.types";
import { LOADER_REVEAL } from "@/lib/styles/motion";

interface Row {
  id: number;
  name: string;
}

const columns: OTableColumnDef<Row>[] = [
  { id: "id", header: "ID", accessorKey: "id" },
  { id: "name", header: "Name", accessorKey: "name" },
];

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }));

const SKELETON = '[data-test="o2-table-skeleton-body"]';
const BODY = '[data-test="o2-table-body"]';
const SHOW_AFTER_MS = 300;
const MIN_HOLD_MS = 300;
const DIM_AFTER_MS = 150;

let wrapper: VueWrapper<any> | undefined;

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await nextTick();
}

describe("loading per the rulings", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.useRealTimers();
  });

  describe("OTable", () => {
    it("never shows the skeleton to a load that lands inside 300 ms", async () => {
      wrapper = mount(OTable as any, { props: { data: [], columns, loading: true } });
      await advance(SHOW_AFTER_MS - 1);
      expect(wrapper.find(SKELETON).exists()).toBe(false);
      await wrapper.setProps({ data: rows(3), loading: false });
      await advance(SHOW_AFTER_MS);
      expect(wrapper.find(SKELETON).exists()).toBe(false);
      expect(wrapper.findAll(`${BODY} tr[data-test^="o2-table-row-"]`)).toHaveLength(3);
    });

    it("shows the skeleton at 300 ms and holds it for 300 ms once shown", async () => {
      wrapper = mount(OTable as any, { props: { data: [], columns, loading: true } });
      await advance(SHOW_AFTER_MS);
      expect(wrapper.find(SKELETON).exists()).toBe(true);

      await advance(50);
      await wrapper.setProps({ data: rows(3), loading: false });
      await advance(MIN_HOLD_MS - 51);
      expect(wrapper.find(SKELETON).exists()).toBe(true);
      await advance(1);
      expect(wrapper.find(SKELETON).exists()).toBe(false);
    });

    it("releases a skeleton that has been up 300 ms as soon as the data lands", async () => {
      wrapper = mount(OTable as any, { props: { data: [], columns, loading: true } });
      await advance(SHOW_AFTER_MS + MIN_HOLD_MS);
      await wrapper.setProps({ data: rows(2), loading: false });
      await nextTick();
      expect(wrapper.find(SKELETON).exists()).toBe(false);
    });

    it("dims kept rows to 60% in both themes", async () => {
      wrapper = mount(OTable as any, { props: { data: rows(3), columns, loading: false } });
      await wrapper.setProps({ loading: true });
      await advance(DIM_AFTER_MS);
      const classes = wrapper.find(BODY).classes();
      expect(classes).toContain("opacity-60");
      expect(classes.filter((name) => name.startsWith("dark:opacity"))).toEqual([]);
    });
  });

  describe("OSpinner", () => {
    const reveal = () => LOADER_REVEAL.split(" ");

    function mountShownWhen(visible: { value: boolean }) {
      return mount({
        components: { OSpinner },
        setup: () => ({ visible }),
        template: `<div v-show="visible.value"><OSpinner /></div>`,
      });
    }

    it("waits 300 ms in CSS, so the wait restarts whenever the browser shows it", async () => {
      expect(reveal()).toEqual(
        expect.arrayContaining([`delay-${SHOW_AFTER_MS}`, "fill-mode-backwards", "fade-in-0"]),
      );
      wrapper = mount(OSpinner);
      const status = () => wrapper!.find('[role="status"]');
      const before = status().classes();
      expect(before).toEqual(expect.arrayContaining(reveal()));
      await advance(SHOW_AFTER_MS * 3);
      expect(status().classes()).toEqual(before);
    });

    it("still waits when it was mounted hidden long before its first show", async () => {
      const visible = reactive({ value: false });
      wrapper = mountShownWhen(visible);
      await advance(SHOW_AFTER_MS * 3);
      visible.value = true;
      await nextTick();
      expect(wrapper.find('[role="status"]').classes()).toEqual(expect.arrayContaining(reveal()));
    });

    it("waits again on each later load of a spinner kept mounted under v-show", async () => {
      const visible = reactive({ value: true });
      wrapper = mountShownWhen(visible);
      for (const shown of [false, true, false, true]) {
        await advance(SHOW_AFTER_MS * 2);
        visible.value = shown;
        await nextTick();
      }
      expect(wrapper.find('[role="status"]').classes()).toEqual(expect.arrayContaining(reveal()));
    });

    it("shows at once for a host that already waited", () => {
      wrapper = mount(OSpinner, { props: { instant: true } });
      const classes = wrapper.find('[role="status"]').classes();
      expect(classes.filter((name) => reveal().includes(name))).toEqual([]);
    });
  });

  describe("OInnerLoading", () => {
    it("waits 300 ms before it shows, and never blocks a click meanwhile", async () => {
      wrapper = mount(OInnerLoading, { props: { showing: true } });
      const overlay = () => wrapper!.find('[role="status"]');
      const layer = () => wrapper!.find('[role="status"] > div');
      expect(overlay().classes()).toContain("pointer-events-none");
      expect(layer().classes()).toContain("opacity-0");
      await advance(SHOW_AFTER_MS - 1);
      expect(layer().classes()).toContain("opacity-0");
      await advance(1);
      expect(layer().classes()).not.toContain("opacity-0");
      expect(overlay().classes()).not.toContain("pointer-events-none");
    });

    it("starts the wait again on the next show", async () => {
      wrapper = mount(OInnerLoading, { props: { showing: true } });
      await advance(SHOW_AFTER_MS);
      await wrapper.setProps({ showing: false });
      await advance(500);
      await wrapper.setProps({ showing: true });
      await nextTick();
      expect(wrapper.find('[role="status"] > div').classes()).toContain("opacity-0");
    });
  });
});
