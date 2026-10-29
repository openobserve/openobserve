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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import type { ContextChip } from "@/composables/assistant";
import { raw } from "@/types/i18n";

import AssistantChipPopover from "./AssistantChipPopover.vue";

const PLANTED = "<img src=x onerror=alert(1)>";

const ROW: ContextChip = {
  id: "row-1",
  kind: "log_row",
  label: raw("Log row · cart · 13:57"),
  secondary: raw("default"),
  data: { message: PLANTED, _o2_id: "7", _original: "{}" },
  sizeBytes: 280,
  provenance: "door",
  sent: "serialized",
};

async function open(props: Record<string, unknown> = {}) {
  const wrapper = mount(AssistantChipPopover, {
    props: { chip: ROW, open: true, ...props },
    slots: { anchor: '<button data-test="anchor">chip</button>' },
    attachTo: document.body,
  });
  await flushPromises();
  const popover = () =>
    document.body.querySelector<HTMLElement>('[data-test="assistant-chip-popover"]');
  return { wrapper, popover };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AssistantChipPopover: Open in {page}", () => {
  it("offers Open when the tray names a page, and emits it", async () => {
    const { wrapper, popover } = await open({ openLabel: raw("Open in Logs") });
    const button = popover()!.querySelector<HTMLElement>(
      '[data-test="assistant-chip-open-source"]',
    )!;
    expect(button.textContent?.trim()).toBe("Open in Logs");
    button.click();
    expect(wrapper.emitted("open-source")).toHaveLength(1);
  });

  it("offers no Open without a page to open", async () => {
    const { popover } = await open();
    expect(popover()!.querySelector('[data-test="assistant-chip-open-source"]')).toBeNull();
  });
});

describe("AssistantChipPopover", () => {
  it("shows provenance, the fields with internal ones greyed, and never renders HTML (CT-03 AC 1, 6)", async () => {
    const { popover } = await open();
    expect(popover()!.querySelector('[data-test="assistant-chip-provenance"]')?.textContent).toBe(
      `Added to this chat · default · ${JSON.stringify(ROW.data).length} characters`,
    );
    expect(popover()!.querySelectorAll("img")).toHaveLength(0);
    expect(popover()!.textContent).toContain(PLANTED);
    const internal = popover()!.querySelectorAll("[data-internal]");
    expect([...internal].map((el) => el.textContent?.trim().split(" ")[0])).toEqual([
      "_o2_id",
      "_original",
    ]);
    expect(popover()!.getAttribute("data-dd-privacy")).toBe("mask");
  });

  it("toggles Hide internal fields to send them too (CT-03 AC 2)", async () => {
    const { wrapper, popover } = await open();
    const toggle = popover()!.querySelector<HTMLElement>(
      '[data-test="assistant-chip-trim-internal"] button, [data-test="assistant-chip-trim-internal"] [role="switch"]',
    );
    toggle!.click();
    await flushPromises();
    expect(wrapper.emitted("trim")).toEqual([[true]]);
  });

  it("removes the chip, or all rows of a multi-row chip with a per-row remove (CT-03 AC 7)", async () => {
    const { wrapper, popover } = await open({
      chip: {
        ...ROW,
        count: 2,
        data: [{ _timestamp: 1, service_name: "cart" }, { _timestamp: 2 }],
      },
    });
    expect(popover()!.querySelectorAll('[data-test="assistant-chip-remove-row"]')).toHaveLength(2);
    expect(
      popover()!.querySelector('[data-test="assistant-chip-remove"]')?.textContent?.trim(),
    ).toBe("Remove all");
    popover()!.querySelectorAll<HTMLElement>('[data-test="assistant-chip-remove-row"]')[1].click();
    popover()!.querySelector<HTMLElement>('[data-test="assistant-chip-remove"]')!.click();
    expect(wrapper.emitted("remove-row")).toEqual([[1]]);
    expect(wrapper.emitted("remove")).toHaveLength(1);
  });

  it("shows an image at up to 20 rem with its name (CT-03 AC 8)", async () => {
    const image: ContextChip = { ...ROW, kind: "image", label: raw("shot.png"), data: undefined };
    const { popover } = await open({ chip: image, imageSrc: "data:image/png;base64,aGk=" });
    const img = popover()!.querySelector<HTMLImageElement>('[data-test="assistant-chip-image"]')!;
    expect(img.alt).toBe("shot.png");
    expect(img.className).toContain("max-h-80");
  });

  it("offers Use page time only once the time is custom, and Apply only after a pick (CT-01 AC 4–5)", async () => {
    const time: ContextChip = {
      ...ROW,
      kind: "time",
      label: raw("Time · last 15 min"),
      data: undefined,
      provenance: "page",
    };
    const { wrapper } = await open({
      chip: time,
      window: { from: 0, to: 900_000, period: "15m", source: "page" },
    });
    const picker = () =>
      document.body.querySelector('[data-test="assistant-context-time-picker"]')!;
    expect(
      picker().querySelector<HTMLButtonElement>('[data-test="assistant-context-time-page"]')!
        .disabled,
    ).toBe(true);
    expect(
      picker().querySelector<HTMLButtonElement>('[data-test="assistant-context-time-apply"]')!
        .disabled,
    ).toBe(true);
    await wrapper.setProps({ window: { from: 0, to: 3_600_000, period: "1h", source: "custom" } });
    picker().querySelector<HTMLElement>('[data-test="assistant-context-time-page"]')!.click();
    expect(wrapper.emitted("apply-time")).toEqual([[null]]);
  });

  it("says why the default applies on a page without a range (CT-01 AC 2)", async () => {
    const time: ContextChip = {
      ...ROW,
      kind: "time",
      label: raw("Time · last 15 min · default"),
      data: undefined,
      provenance: "page",
    };
    await open({ chip: time, window: { from: 0, to: 900_000, period: "15m", source: "default" } });
    expect(
      document.body.querySelector('[data-test="assistant-context-time-default-note"]')?.textContent,
    ).toContain("this page has no time range");
  });

  it("opens on its first action, and Tab at either edge hands focus back to the tray (CT-03 AC 5, U3)", async () => {
    const big = { ...ROW, data: { message: "z".repeat(2_000), _o2_id: "1" } };
    const { wrapper } = await open({ chip: big });
    const actions = document.body.querySelector("[data-chip-actions]")!;
    expect(actions.contains(document.activeElement)).toBe(true);
    const tabbable = [
      ...document.body.querySelectorAll<HTMLElement>(
        '[data-test="assistant-chip-popover"] [tabindex="0"], [data-test="assistant-chip-popover"] button',
      ),
    ];
    tabbable[0].focus();
    tabbable[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    tabbable.at(-1)!.focus();
    tabbable.at(-1)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(wrapper.emitted("tab-out")).toHaveLength(1);
  });

  it("states the size as characters in the locale's digits (U15)", async () => {
    const { popover } = await open({ chip: { ...ROW, data: { message: "q".repeat(1_500) } } });
    expect(
      popover()!.querySelector('[data-test="assistant-chip-provenance"]')?.textContent,
    ).toContain("1,514 characters");
  });
});
