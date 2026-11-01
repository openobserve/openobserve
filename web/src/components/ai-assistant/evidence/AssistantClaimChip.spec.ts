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

import { raw } from "@/types/i18n";

import AssistantClaimChip from "./AssistantClaimChip.vue";

describe("AssistantClaimChip", () => {
  afterEach(() => (document.body.innerHTML = ""));

  it("is a button named by its citation, which focuses and rings the row and leaves it closed", async () => {
    const article = document.createElement("article");
    article.innerHTML = '<button><span data-step-header="call_3">row</span></button><div></div>';
    document.body.appendChild(article);
    const opened: string[] = [];
    article.addEventListener("o2-assistant-open-step", (event) =>
      opened.push((event as CustomEvent<{ callId: string }>).detail.callId),
    );
    const wrapper = mount(AssistantClaimChip, {
      props: { n: 1, callId: "call_3", available: true, label: raw("Citation 1, query 1, 3 rows") },
      attachTo: article.querySelector("div")!,
    });
    const chip = wrapper.get('[data-test="assistant-claim-1"]');
    expect(chip.element.tagName).toBe("BUTTON");
    expect(chip.attributes("aria-label")).toBe("Citation 1, query 1, 3 rows");
    await chip.trigger("click");
    await flushPromises();
    expect(opened).toEqual(["call_3"]);
    const row = article.querySelector("button")!;
    expect(document.activeElement).toBe(row);
    expect(row.classList.contains("ring-2")).toBe(true);
  });

  it("mutes an unavailable citation: no button and no Tab stop", () => {
    const wrapper = mount(AssistantClaimChip, {
      props: { n: 2, callId: "gone", available: false, label: raw("Not available") },
    });
    const chip = wrapper.get('[data-test="assistant-claim-2"]');
    expect(chip.element.tagName).not.toBe("BUTTON");
    expect(chip.attributes("tabindex")).toBeUndefined();
    expect(chip.attributes("aria-hidden")).toBe("true");
  });
});
