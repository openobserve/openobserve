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

import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, inject, provide } from "vue";
import { flushPromises, mount } from "@vue/test-utils";

import OSheet from "@/lib/overlay/Sheet/OSheet.vue";
import { raw } from "@/types/i18n";

import ODialog from "./ODialog.vue";
import {
  DIALOG_DEPTH_KEY,
  DRAWER_DEPTH_KEY,
  countOpenOverlays,
  injectOverlayDepth,
  overlayLayerZIndex,
  provideDialogLayerAboveOpenOverlays,
  useOverlayLayer,
} from "./dialogStacking";

const overlay = (state: string) => {
  const el = document.createElement("div");
  el.setAttribute("role", "dialog");
  el.setAttribute("data-state", state);
  return el;
};

describe("dialogStacking", () => {
  it("counts only open dialog and drawer panels", () => {
    const root = document.createElement("div");
    root.append(overlay("open"), overlay("open"), overlay("closed"));
    expect(countOpenOverlays(root)).toBe(2);
  });

  it("provides a dialog layer one above each open overlay", () => {
    const root = document.createElement("div");
    root.append(overlay("open"), overlay("open"));
    const Child = defineComponent({
      setup: () => () => h("span", String(inject(DIALOG_DEPTH_KEY))),
    });
    const Parent = defineComponent({
      setup() {
        provideDialogLayerAboveOpenOverlays(root);
        return () => h(Child);
      },
    });
    expect(mount(Parent).text()).toBe("2");
  });
});

describe("one overlay ladder (N6)", () => {
  const zOf = (selector: string) =>
    Number(document.body.querySelector<HTMLElement>(selector)?.style.zIndex);

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("a confirm opened from a sheet dims the sheet: its scrim and panel stack above it", async () => {
    const wrapper = mount(
      defineComponent({
        components: { OSheet, ODialog },
        template: `<OSheet :open="true" snap="half" aria-label="Thread" data-test="sheet"
            :expand-label="label" :collapse-label="label">
            <ODialog :open="true" title="Cancel run?" data-test="confirm"><p>Body</p></ODialog>
          </OSheet>`,
        setup: () => ({ label: raw("More") }),
      }),
      { attachTo: document.body },
    );
    await flushPromises();
    const sheet = zOf('[data-test="sheet"]');
    expect(zOf("[data-o2-dialog]")).toBeGreaterThan(sheet);
    const scrim = [...document.body.querySelectorAll<HTMLElement>("[style]")]
      .map((el) => Number(el.style.zIndex))
      .filter((z) => z > 0 && z < zOf("[data-o2-dialog]"));
    expect(Math.max(...scrim)).toBeGreaterThan(sheet);
    wrapper.unmount();
  });

  it("a dialog inside a drawer, and a popover inside either, take the layer above it", () => {
    const seen: number[] = [];
    const Leaf = defineComponent({
      setup: () => {
        seen.push(injectOverlayDepth());
        return () => h("span");
      },
    });
    const Layer = defineComponent({
      setup: (_, { slots }) => {
        useOverlayLayer();
        return () => slots.default?.();
      },
    });
    const Drawer = defineComponent({
      setup: (_, { slots }) => {
        provide(DRAWER_DEPTH_KEY, 1);
        return () => slots.default?.();
      },
    });
    mount(defineComponent({ setup: () => () => h(Drawer, () => h(Layer, () => h(Leaf))) }));
    expect(seen).toEqual([2]);
    expect(overlayLayerZIndex(1)).toEqual({ overlayZIndex: 6999, contentZIndex: 7000 });
  });
});
