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

import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import {
  HEADER_TIME_ROW_QUERY,
  headerCollapse,
  useHeaderActionsRoom,
  useHeaderTimeInRow,
} from "./useHeaderTitleRoom";

const savings = { share: 70, edit: 30, auto: 50 };
const none = { share: false, edit: false, auto: false };

describe("headerCollapse", () => {
  it("keeps every label while the header fits", () => {
    expect(headerCollapse({ deficit: 0, triggerSave: 100, savings })).toEqual({
      triggerSqueeze: 0,
      iconOnly: none,
    });
  });

  it("takes room from the trigger's own forms before any action loses its label", () => {
    expect(headerCollapse({ deficit: 40, triggerSave: 100, savings })).toEqual({
      triggerSqueeze: 40,
      iconOnly: none,
    });
  });

  it("then drops Share, Edit and Auto labels one at a time, in that order", () => {
    const stage = (deficit: number) =>
      headerCollapse({ deficit, triggerSave: 100, savings }).iconOnly;
    expect(stage(150)).toEqual({ share: true, edit: false, auto: false });
    expect(stage(171)).toEqual({ share: true, edit: true, auto: false });
    expect(stage(201)).toEqual({ share: true, edit: true, auto: true });
    expect(stage(170)).toEqual({ share: true, edit: false, auto: false });
    expect(stage(-10)).toEqual(none);
  });

  it("goes straight to the actions when the trigger cannot narrow", () => {
    expect(headerCollapse({ deficit: 20, triggerSave: 0, savings })).toEqual({
      triggerSqueeze: 0,
      iconOnly: { share: true, edit: false, auto: false },
    });
  });
});

describe("useHeaderActionsRoom", () => {
  type Rect = { width: number; height?: number; right?: number };
  const rect = (el: HTMLElement, box: Rect) => {
    el.getBoundingClientRect = () =>
      ({ width: box.width, height: box.height ?? 32, right: box.right ?? 0 }) as DOMRect;
  };

  // header > row > block(flex-1) > column > h1 > title; the actions sit beside the block.
  const buildHeader = () => {
    const header = document.createElement("header");
    const row = document.createElement("div");
    const block = document.createElement("div");
    block.className = "flex min-w-0 flex-1";
    const column = document.createElement("div");
    const h1 = document.createElement("h1");
    const title = document.createElement("span");
    title.textContent = "Checkout health";
    h1.appendChild(title);
    column.appendChild(h1);
    block.appendChild(column);
    const actions = document.createElement("div");
    const button = (label: string) => {
      const el = document.createElement("button");
      el.textContent = label;
      actions.appendChild(el);
      return el;
    };
    const trigger = document.createElement("div");
    actions.appendChild(trigger);
    const auto = button("Auto: Off");
    const edit = button("Edit");
    const share = button("Share Link");
    row.append(block, actions);
    header.appendChild(row);
    document.body.appendChild(header);
    return { header, block, column, h1, title, trigger, share, edit, auto };
  };

  let onResize: () => void = () => {};
  const stubObservers = () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          onResize = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("narrows the trigger, then drops Share's label, and hands both back when the header widens", async () => {
    stubObservers();
    const dom = buildHeader();
    const sizes = { trigger: 300, share: 110, edit: 70, auto: 100 };
    const lay = (titleRoom: number, freeAfter: number) => {
      Object.defineProperty(dom.h1, "clientWidth", { configurable: true, value: titleRoom });
      rect(dom.title, { width: 144 });
      rect(dom.column, { width: titleRoom, right: 400 });
      rect(dom.block, { width: titleRoom + freeAfter, right: 400 + freeAfter });
      rect(dom.trigger, { width: sizes.trigger });
      rect(dom.share, { width: sizes.share });
      rect(dom.edit, { width: sizes.edit });
      rect(dom.auto, { width: sizes.auto });
    };

    const scope = effectScope();
    const titleEl = ref<HTMLElement | null>(null);
    const els = {
      trigger: ref<HTMLElement | null>(dom.trigger),
      share: ref<HTMLElement | null>(dom.share),
      edit: ref<HTMLElement | null>(dom.edit),
      auto: ref<HTMLElement | null>(dom.auto),
    };
    const { iconOnly, triggerMaxWidth } = scope.run(() =>
      useHeaderActionsRoom(titleEl, els, { shortestTriggerWidth: () => 240 }),
    )!;

    lay(144, 20);
    titleEl.value = dom.title;
    await nextTick();
    expect(iconOnly.value).toEqual(none);
    expect(triggerMaxWidth.value).toBeNull();

    // 104px short: the trigger gives its 60px first, Share's label the rest.
    lay(40, 0);
    onResize();
    expect(triggerMaxWidth.value).toBe(240);
    expect(iconOnly.value).toEqual({ share: true, edit: false, auto: false });

    // The new layout is measured again and gives the same plan, so it never flips back and forth.
    sizes.trigger = 240;
    sizes.share = 32;
    lay(144, 14);
    onResize();
    expect(triggerMaxWidth.value).toBe(240);
    expect(iconOnly.value).toEqual({ share: true, edit: false, auto: false });

    // Wider header: room for every label again.
    lay(144, 200);
    onResize();
    expect(iconOnly.value).toEqual(none);
    expect(triggerMaxWidth.value).toBeNull();

    scope.stop();
  });

  it("keeps every label while disabled", async () => {
    stubObservers();
    const dom = buildHeader();
    Object.defineProperty(dom.h1, "clientWidth", { configurable: true, value: 10 });
    rect(dom.title, { width: 300 });
    rect(dom.column, { width: 10, right: 100 });
    rect(dom.block, { width: 10, right: 100 });
    for (const el of [dom.trigger, dom.share, dom.edit, dom.auto]) rect(el, { width: 100 });
    const scope = effectScope();
    const enabled = ref(false);
    const titleEl = ref<HTMLElement | null>(dom.title);
    const els = {
      trigger: ref<HTMLElement | null>(dom.trigger),
      share: ref<HTMLElement | null>(dom.share),
      edit: ref<HTMLElement | null>(dom.edit),
      auto: ref<HTMLElement | null>(dom.auto),
    };
    const { iconOnly } = scope.run(() => useHeaderActionsRoom(titleEl, els, { enabled }))!;
    await nextTick();
    onResize();
    expect(iconOnly.value).toEqual(none);

    enabled.value = true;
    await nextTick();
    expect(iconOnly.value).toEqual({ share: true, edit: true, auto: true });
    scope.stop();
  });
});

describe("useHeaderTimeInRow", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("follows the 1280px viewport query", () => {
    let listener: (event: { matches: boolean }) => void = () => {};
    const spy = vi.fn(
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener: (_: string, cb: any) => (listener = cb),
          removeEventListener: vi.fn(),
        }) as any,
    );
    vi.stubGlobal("matchMedia", spy);
    const scope = effectScope();
    const inRow = scope.run(() => useHeaderTimeInRow())!;
    expect(spy).toHaveBeenCalledWith(HEADER_TIME_ROW_QUERY);
    expect(inRow.value).toBe(false);
    listener({ matches: true });
    expect(inRow.value).toBe(true);
    scope.stop();
  });
});
