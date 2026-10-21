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
import { defineComponent, h } from "vue";

import type { PendingProposal } from "@/composables/assistant";
import { resetAssistantShortcutsForTests } from "@/composables/assistant/shortcuts";

import AssistantDiffBlock from "./AssistantDiffBlock.vue";

vi.mock("monaco-editor/esm/vs/editor/editor.api", () => {
  throw new Error("Monaco is not loaded in unit specs");
});

function proposal(over: Partial<PendingProposal> = {}): PendingProposal {
  return {
    id: 1,
    hostId: "alert_query",
    before: 'SELECT * FROM "default"',
    after: '-- add a count\nSELECT count(*) FROM "default"',
    language: "sql",
    provenance: { prompt: "add a count" },
    canRun: true,
    accept: vi.fn(),
    acceptAndRun: vi.fn(),
    reject: vi.fn(),
    ...over,
  };
}

function setup(over: Partial<PendingProposal> = {}) {
  const pending = proposal(over);
  const outer = vi.fn();
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h("div", { onKeydown: outer }, [h(AssistantDiffBlock, { proposal: pending })]),
    }),
    { attachTo: document.body },
  );
  return { wrapper, pending, outer };
}

afterEach(() => {
  resetAssistantShortcutsForTests();
  document.body.innerHTML = "";
});

describe("AssistantDiffBlock", () => {
  it("is a region named for the host's object, masked, with Reject focused first", async () => {
    const { wrapper } = setup();
    await flushPromises();
    const root = wrapper.get('[data-test="assistant-diff-block"]');
    expect(root.element.tagName).toBe("SECTION");
    expect(root.attributes("aria-label")).toBe("Proposed change to the alert query");
    expect(root.attributes("data-dd-privacy")).toBe("mask");
    expect(document.activeElement?.getAttribute("data-test")).toBe("assistant-diff-reject");
    const order = wrapper.findAll("button").map((button) => button.attributes("data-test"));
    expect(order).toEqual([
      "assistant-diff-reject",
      "assistant-diff-accept",
      "assistant-diff-accept-run",
    ]);
    wrapper.unmount();
  });

  it("states the language, that nothing checked it, and the source on the bar", () => {
    const { wrapper } = setup({ language: "js", hostId: "function" });
    expect(wrapper.get('[data-test="assistant-diff-status"]').text()).toBe(
      "Proposed JavaScript · not checked · from O2 Assistant",
    );
    expect(wrapper.get('[data-test="assistant-diff-block"]').attributes("aria-label")).toBe(
      "Proposed change to the function",
    );
    wrapper.unmount();
  });

  it("rejects on Escape and keeps that Escape from the host's drawer", async () => {
    const { wrapper, pending, outer } = setup();
    await flushPromises();
    const reject = wrapper.get('[data-test="assistant-diff-reject"]').element as HTMLElement;
    reject.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(pending.reject).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    const composing = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      isComposing: true,
    });
    reject.dispatchEvent(composing);
    expect(pending.reject).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("calls the proposal's own Accept, Accept and run and Reject", async () => {
    const { wrapper, pending } = setup();
    await wrapper.get('[data-test="assistant-diff-accept"]').trigger("click");
    await wrapper.get('[data-test="assistant-diff-accept-run"]').trigger("click");
    await wrapper.get('[data-test="assistant-diff-reject"]').trigger("click");
    expect(pending.accept).toHaveBeenCalledTimes(1);
    expect(pending.acceptAndRun).toHaveBeenCalledTimes(1);
    expect(pending.reject).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("offers no Accept and run without a run action", () => {
    const { wrapper } = setup({ canRun: false });
    expect(wrapper.find('[data-test="assistant-diff-accept-run"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("reads as plain marked lines when Monaco is not there, the model text escaped", async () => {
    const { wrapper } = setup({ before: "a", after: "<img src=x onerror=alert(1)>" });
    await flushPromises();
    const lines = wrapper.findAll('[data-test="assistant-diff-lines"] li');
    expect(lines.map((line) => line.attributes("data-kind"))).toEqual(["removed", "added"]);
    expect(wrapper.find("img").exists()).toBe(false);
    expect(lines[1].text()).toContain("<img src=x onerror=alert(1)>");
    expect(lines[0].find(".sr-only").text()).toBe("removed:");
    expect(lines[1].find(".sr-only").text()).toBe("added:");
    wrapper.unmount();
  });

  it("marks each unknown field where it appears in the proposal, named for screen readers", async () => {
    const { wrapper } = setup({
      before: "a",
      after: "SELECT levl, levl_count FROM t",
      checks: { validated: "error", unknownFields: ["levl"] } as never,
    });
    await flushPromises();
    const added = wrapper.findAll('[data-test="assistant-diff-lines"] li')[1];
    const marks = added.findAll(".decoration-wavy");
    expect(marks).toHaveLength(1);
    expect(marks[0].text()).toContain("levl");
    expect(marks[0].find(".sr-only").text()).toBe("Unknown field");
    wrapper.unmount();
  });

  it("leaves room for the host's expand button only when asked", async () => {
    const plain = mount(AssistantDiffBlock, { props: { proposal: proposal() } });
    const reserved = mount(AssistantDiffBlock, {
      props: { proposal: proposal(), reserveEnd: true },
    });
    await flushPromises();
    expect(plain.html()).not.toContain("pe-10");
    expect(reserved.html()).toContain("pe-10");
    plain.unmount();
    reserved.unmount();
  });
});
