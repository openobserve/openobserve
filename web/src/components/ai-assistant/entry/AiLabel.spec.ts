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
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiLabelState } from "@/composables/assistant";

import AiLabel from "./AiLabel.vue";

const { md } = vi.hoisted(() => ({ md: { value: true } }));

vi.mock("@/composables/useBreakpoint", async () => {
  const { computed, reactive } = await import("vue");
  const state = reactive(md);
  return {
    default: () => ({ mdUp: computed(() => state.value), lgUp: computed(() => state.value) }),
    __state: state,
  };
});

const state = (over: Partial<AiLabelState> = {}): AiLabelState => ({
  status: "written",
  assistantText: "SELECT 2",
  originalText: "SELECT 1",
  provenance: {
    prompt: "count the rows",
    stream: "default",
    range: { from: Date.UTC(2026, 9, 14, 13, 42), to: Date.UTC(2026, 9, 14, 13, 57) },
  },
  acceptedAt: Date.UTC(2026, 9, 14, 13, 58),
  note: null,
  ...over,
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AiLabel", () => {
  it("says the assistant wrote it and offers one Revert to my original", async () => {
    const wrapper = mount(AiLabel, { props: { state: state() }, attachTo: document.body });
    expect(wrapper.get('[data-test="ai-label-tag"]').text()).toContain("Written by O2 Assistant");
    const revert = wrapper.get('[data-test="ai-label-revert"]');
    expect(revert.attributes("aria-label")).toBe("Revert assistant's change");
    await revert.trigger("click");
    expect(wrapper.emitted("revert")).toEqual([["original"]]);
    wrapper.unmount();
  });

  it("after an edit, reverts to the assistant's version or to my original from a menu", async () => {
    const wrapper = mount(AiLabel, {
      props: { state: state({ status: "edited" }) },
      attachTo: document.body,
    });
    expect(wrapper.get('[data-test="ai-label-tag"]').text()).toContain("Edited after O2 Assistant");
    await wrapper.get('[data-test="ai-label-revert"]').trigger("click");
    await flushPromises();
    expect(document.body.querySelector('[data-test="ai-label-revert-ai"]')?.textContent).toContain(
      "Revert to the assistant's version",
    );
    expect(
      document.body.querySelector('[data-test="ai-label-revert-mine"]')?.textContent,
    ).toContain("Revert to my original");
    wrapper.unmount();
  });

  it("shows the provenance on demand and asks again with the prompt, naming no model", async () => {
    const wrapper = mount(AiLabel, { props: { state: state() }, attachTo: document.body });
    await wrapper.get('[data-test="ai-label-tag"]').trigger("click");
    await flushPromises();
    const popover = document.body.querySelector('[data-test="ai-label-popover"]');
    expect(popover?.textContent).toContain("count the rows");
    expect(popover?.textContent).toContain("Stream · default");
    expect(popover?.textContent).toContain("Accepted");
    (document.body.querySelector('[data-test="ai-label-ask-again"]') as HTMLElement).click();
    expect(wrapper.emitted("ask-again")).toEqual([["count the rows"]]);
    wrapper.unmount();
  });

  it("names what the editor kept back", () => {
    const wrapper = mount(AiLabel, {
      props: { state: state({ note: "assistant.editor.protectedFields" }) },
    });
    expect(wrapper.get('[data-test="ai-label-kept"]').text()).toBe(
      "Kept the saved name, organization and id",
    );
  });

  it("shortens to AI on a phone and starts its accessible name with that word", async () => {
    const breakpoint = await import("@/composables/useBreakpoint");
    (breakpoint as unknown as { __state: { value: boolean } }).__state.value = false;
    const wrapper = mount(AiLabel, { props: { state: state() } });
    const tag = wrapper.get('[data-test="ai-label-tag"]');
    expect(tag.text()).toContain("AI");
    expect(tag.text()).not.toContain("Written by");
    expect(tag.attributes("aria-label")).toBe("AI, Written by O2 Assistant");
    (breakpoint as unknown as { __state: { value: boolean } }).__state.value = true;
  });
});
