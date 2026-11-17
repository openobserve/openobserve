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

import { describe, it, expect, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h, KeepAlive, nextTick, ref } from "vue";
import OTable from "./OTable.vue";
import type { OTableColumnDef } from "./OTable.types";
import { PAGE_ENTRANCE_KEY } from "@/lib/core/PageLayout/pageEntrance";
import { ENTER_FADE } from "@/lib/styles/motion";

const i18n = createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false });
const FADE = ENTER_FADE.split(" ");
const BODY = '[data-test="o2-table-body"]';

const columns: OTableColumnDef<any>[] = [
  { id: "id", header: "ID", accessorKey: "id", size: 60 },
  { id: "name", header: "Name", accessorKey: "name", size: 200 },
];
const rows = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }));

const SHAPES: Record<string, Record<string, unknown>> = {
  plain: {},
  draggable: { enableRowReorder: true },
  virtual: { virtualScroll: true },
};

let wrapper: VueWrapper<any> | null = null;

function mountTable(extra: Record<string, unknown>, entering?: () => boolean) {
  wrapper = mount(OTable as any, {
    props: { data: rows, columns, ...extra },
    global: { plugins: [i18n], provide: entering ? { [PAGE_ENTRANCE_KEY]: entering } : {} },
    attachTo: document.body,
  });
  return wrapper;
}

const bodyClasses = (w: VueWrapper<any>) => w.find(BODY).classes();

describe("OTable rows entrance", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it.each(Object.keys(SHAPES))("%s body fades in on a fresh navigation", (shape) => {
    expect(bodyClasses(mountTable(SHAPES[shape], () => true))).toEqual(
      expect.arrayContaining(FADE),
    );
  });

  it.each(Object.keys(SHAPES))("%s body stays still on a Back/Forward restore", (shape) => {
    const classes = bodyClasses(mountTable(SHAPES[shape], () => false));
    for (const c of FADE) expect(classes).not.toContain(c);
  });

  it("keeps today's fade outside a routed page (dialogs, drawers)", () => {
    expect(bodyClasses(mountTable({}))).toEqual(expect.arrayContaining(FADE));
  });

  it("fades on a kept view's first visit, not on its keep-alive return", async () => {
    let entering = true;
    const shown = ref(true);
    const Page = defineComponent({
      name: "KeptTablePage",
      render: () => h(OTable as any, { data: rows, columns }),
    });
    wrapper = mount(
      defineComponent({ render: () => h(KeepAlive, null, [shown.value ? h(Page) : h("div")]) }),
      { global: { plugins: [i18n], provide: { [PAGE_ENTRANCE_KEY]: () => entering } } },
    );
    expect(bodyClasses(wrapper)).toEqual(expect.arrayContaining(FADE));

    shown.value = false;
    await nextTick();
    entering = false;
    shown.value = true;
    await nextTick();
    await nextTick();
    for (const c of FADE) expect(bodyClasses(wrapper)).not.toContain(c);
  });
});
