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

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import type { RecallEntry } from "@/composables/assistant";
import { raw } from "@/types/i18n";

import AssistantRecallSheet from "./AssistantRecallSheet.vue";

enableAutoUnmount(afterEach);

const ENTRIES: RecallEntry[] = [
  {
    text: "Why did checkout fail?",
    chips: [
      {
        id: "r",
        kind: "log_row",
        label: raw("Log row · cart"),
        sizeBytes: 1,
        provenance: "door",
        sent: "serialized",
      },
    ],
    at: 2,
  },
  { text: "Summarise default", chips: [], at: 1 },
];

describe("AssistantRecallSheet", () => {
  it("is the Recent prompts bottom sheet, one 2.75 rem row per entry with its chips (CT-11 AC 10)", async () => {
    mount(AssistantRecallSheet, {
      props: { open: true, entries: ENTRIES },
      attachTo: document.body,
    });
    await flushPromises();
    const sheet = document.body.querySelector('[data-test="assistant-recall-sheet"]')!;
    expect(sheet.textContent).toContain("Recent prompts");
    const rows = document.body.querySelectorAll<HTMLElement>(
      '[data-test^="assistant-recall-entry-"]',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].className).toContain("min-h-11");
    expect(rows[0].textContent).toContain("Log row · cart");
    expect(
      document.body
        .querySelector('[data-test="assistant-recall-sheet"] ul')
        ?.getAttribute("data-dd-privacy"),
    ).toBe("mask");
  });

  it("emits the tapped entry's index and closes from its named close button", async () => {
    const wrapper = mount(AssistantRecallSheet, {
      props: { open: true, entries: ENTRIES },
      attachTo: document.body,
    });
    await flushPromises();
    document.body
      .querySelectorAll<HTMLElement>('[data-test^="assistant-recall-entry-"]')[1]
      .click();
    const close = document.body.querySelector<HTMLElement>(
      '[data-test="assistant-recall-sheet-close"]',
    )!;
    expect(close.getAttribute("aria-label")).toBe("Close");
    close.click();
    expect(wrapper.emitted("select")).toEqual([[1]]);
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });
});
