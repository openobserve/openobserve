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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { shallowRef, type ShallowRef } from "vue";
import i18n from "@/locales";
import OAccessActionPopover from "@/components/access/OAccessActionPopover.vue";
import { viewDenial, type AccessActionNotice } from "@/composables/useAccessStore";

const state = vi.hoisted(() => ({
  notice: null as unknown as ShallowRef<AccessActionNotice | null>,
  dismissAction: null as unknown as () => void,
}));

vi.mock("@/composables/useAccessStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/useAccessStore")>();
  return {
    ...actual,
    useAccessBoundary: () => ({ actionNotice: state.notice, dismissAction: state.dismissAction }),
  };
});

let wrapper: VueWrapper | null = null;
let container: HTMLElement;
let anchor: HTMLButtonElement;

const card = () => document.querySelector<HTMLElement>('[data-test="access-action-error"]');
const settle = async () => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 20));
};
const press = (el: Element, key: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));

async function openCard(
  denials = [viewDenial("alerts", "delete", ["DELETE /api/default/alerts/a1"])],
): Promise<void> {
  wrapper = mount(OAccessActionPopover, { attachTo: document.body, global: { plugins: [i18n] } });
  state.notice.value = {
    el: anchor,
    permission: denials[0].permission,
    method: "DELETE",
    resource: denials[0].resource,
    denials,
    routeKey: "alerts",
    fallbacks: [],
  };
  await settle();
}

beforeEach(() => {
  state.notice = shallowRef(null);
  state.dismissAction = vi.fn(() => (state.notice.value = null));
  container = document.createElement("div");
  anchor = document.createElement("button");
  anchor.textContent = "Delete";
  container.appendChild(anchor);
  document.body.appendChild(container);
  anchor.focus();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  container.remove();
});

describe("OAccessActionPopover", () => {
  it("keeps focus on the pressed control when the card opens", async () => {
    await openCard();
    expect(card()).not.toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it("names every refused write the one action sent", async () => {
    await openCard([
      viewDenial("roles", "update", ["PUT /api/default/roles/viewer"]),
      viewDenial("groups", "update", ["PUT /api/default/groups/ops"]),
    ]);
    const text = card()!.textContent ?? "";
    expect(text).toContain("Roles");
    expect(text).toContain("Groups");
  });

  it("moves Tab from the pressed control into the card instead of closing it", async () => {
    await openCard();
    press(anchor, "Tab");
    await settle();
    expect(state.dismissAction).not.toHaveBeenCalled();
    expect(card()?.contains(document.activeElement)).toBe(true);
  });

  it("stays open when focus returns to the pressed control", async () => {
    await openCard();
    card()!.focus();
    anchor.focus();
    await settle();
    expect(state.dismissAction).not.toHaveBeenCalled();
    expect(card()).not.toBeNull();
  });

  it("returns to the pressed control when Tab leaves either end of the card", async () => {
    await openCard();
    card()!.focus();
    press(card()!, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(anchor);
    expect(state.dismissAction).not.toHaveBeenCalled();

    const copy = card()!.querySelector<HTMLElement>('[data-test="access-denied-copy"]')!;
    copy.focus();
    press(copy, "Tab");
    await settle();
    expect(document.activeElement).toBe(anchor);
    expect(state.dismissAction).toHaveBeenCalledTimes(1);
  });

  it("returns Shift+Tab from the first card button to the pressed control", async () => {
    await openCard();
    const copy = card()!.querySelector<HTMLElement>('[data-test="access-denied-copy"]')!;
    copy.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    copy.dispatchEvent(event);
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(anchor);
    expect(state.dismissAction).not.toHaveBeenCalled();
  });

  it("returns Shift+Tab from the first of several card buttons, and leaves the others to the browser", async () => {
    await openCard(
      ["dashboards", "alerts", "streams", "functions", "pipelines", "destinations"].map((key) =>
        viewDenial(key, "delete", [`DELETE /api/default/${key}/x`]),
      ),
    );
    const buttons = [...card()!.querySelectorAll<HTMLElement>("button")];
    expect(buttons[0].dataset.test).toBe("access-denied-more");
    expect(buttons.length).toBeGreaterThan(1);
    buttons[1].focus();
    const inner = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    buttons[1].dispatchEvent(inner);
    expect(inner.defaultPrevented).toBe(false);
    buttons[0].focus();
    press(buttons[0], "Tab", { shiftKey: true });
    await settle();
    expect(document.activeElement).toBe(anchor);
    expect(state.dismissAction).not.toHaveBeenCalled();
  });

  it("closes on Escape and gives focus back to the pressed control", async () => {
    await openCard();
    card()!.focus();
    press(card()!, "Escape");
    await settle();
    expect(state.dismissAction).toHaveBeenCalled();
    expect(document.activeElement).toBe(anchor);
  });

  it("stays open while the page under it scrolls", async () => {
    await openCard();
    container.dispatchEvent(new Event("scroll"));
    await settle();
    expect(state.dismissAction).not.toHaveBeenCalled();
    expect(card()).not.toBeNull();
  });
});
