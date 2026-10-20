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

import { fakeEvidence } from "../__tests__/fakeEvidence";
import AssistantClaimChip from "./AssistantClaimChip.vue";

describe("AssistantClaimChip", () => {
  afterEach(() => (document.body.innerHTML = ""));

  it("is a button named by its number and step, which opens, focuses and rings the step", async () => {
    const { provide, sid, host } = fakeEvidence();
    const article = document.createElement("article");
    article.innerHTML = '<button data-step-header="call_3">step</button><div></div>';
    document.body.appendChild(article);
    const wrapper = mount(AssistantClaimChip, {
      props: { n: 1, callId: "call_3", available: true, label: raw("Queried default"), sid },
      attachTo: article.querySelector("div")!,
      global: { provide },
    });
    const chip = wrapper.get('[data-test="assistant-claim-1"]');
    expect(chip.element.tagName).toBe("BUTTON");
    expect(chip.attributes("aria-label")).toBe("Evidence 1, Queried default");
    await chip.trigger("click");
    await flushPromises();
    expect(host.dispatch).toHaveBeenCalledWith(sid, { kind: "open_step", callId: "call_3" });
    const header = article.querySelector<HTMLElement>('[data-step-header="call_3"]')!;
    expect(document.activeElement).toBe(header);
    expect(header.classList.contains("ring-2")).toBe(true);
  });

  it("is muted with the not-available reason and no action when the step is not in view", () => {
    const wrapper = mount(AssistantClaimChip, {
      props: { n: 2, callId: "x", available: false, label: raw("x") },
      attachTo: document.body,
    });
    const chip = wrapper.get('[data-test="assistant-claim-2"]');
    expect(chip.element.tagName).toBe("SPAN");
    expect(chip.attributes("aria-label")).toBe("Evidence 2, Evidence not available in this view");
    expect(chip.find("button").exists()).toBe(false);
  });
});
