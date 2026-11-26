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
import { defineComponent, h } from "vue";

import { askLifecycle, resetLifecycleForTests } from "@/composables/assistant/lifecycle";
import { raw } from "@/types/i18n";

import AssistantLifecycleDialogs from "./AssistantLifecycleDialogs.vue";

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

function mountDialogs() {
  return mount(
    defineComponent({
      setup: () => () =>
        h("div", [
          h("button", { "data-test": "trigger" }, "Sign out"),
          h(AssistantLifecycleDialogs),
        ]),
    }),
    { attachTo: document.body },
  );
}

const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);

const buttonsOf = (id: string) =>
  Array.from(byTest(id)?.querySelectorAll("button") ?? []).map((b) => b.getAttribute("data-test"));

afterEach(() => {
  resetLifecycleForTests();
  document.body.innerHTML = "";
});

describe("AssistantLifecycleDialogs", () => {
  it("asks to stop and sign out with the count, focuses Stop and sign out, Cancel answers cancel", async () => {
    const wrapper = mountDialogs();
    const asked = askLifecycle({ kind: "sign_out", count: 2 });
    await flushPromises();
    await frame();
    const dialog = byTest("assistant-shell-sign-out-dialog")!;
    expect(dialog.textContent).toContain("Answers are still running");
    expect(dialog.textContent).toContain("2 answers are still running. Signing out stops them.");
    expect(buttonsOf("assistant-shell-sign-out-dialog")).toEqual(
      expect.arrayContaining(["assistant-shell-sign-out-cancel", "assistant-shell-sign-out-stop"]),
    );
    expect(document.activeElement?.getAttribute("data-test")).toBe("assistant-shell-sign-out-stop");
    byTest("assistant-shell-sign-out-cancel")!.click();
    await expect(asked).resolves.toBe("cancel");
    wrapper.unmount();
  });

  it("asks Stop · Keep · Cancel on an org switch with Keep focused, in that order", async () => {
    const wrapper = mountDialogs();
    const asked = askLifecycle({ kind: "org_switch", count: 1, waiting: 0, org: "checkout" });
    await flushPromises();
    await frame();
    const dialog = byTest("assistant-shell-org-switch-dialog")!;
    expect(dialog.textContent).toContain("Answers are still running in checkout");
    expect(dialog.textContent).toContain(
      "1 answer is still running in checkout. Stop it, or keep it running there?",
    );
    expect(
      buttonsOf("assistant-shell-org-switch-dialog").filter((id) => id?.startsWith("assistant")),
    ).toEqual([
      "assistant-shell-org-switch-stop",
      "assistant-shell-org-switch-keep",
      "assistant-shell-org-switch-cancel",
    ]);
    expect(document.activeElement?.getAttribute("data-test")).toBe(
      "assistant-shell-org-switch-keep",
    );
    byTest("assistant-shell-org-switch-stop")!.click();
    await expect(asked).resolves.toBe("stop");
    wrapper.unmount();
  });

  it("guards unsaved changes with Keep editing focused and Discard changes last, Escape keeping", async () => {
    const wrapper = mountDialogs();
    const asked = askLifecycle({ kind: "leave_guard", name: raw("checkout-latency") });
    await flushPromises();
    await frame();
    const dialog = byTest("assistant-shell-leave-guard")!;
    expect(dialog.textContent).toContain("Unsaved changes");
    expect(dialog.textContent).toContain("Leaving discards your changes to checkout-latency.");
    const ids = buttonsOf("assistant-shell-leave-guard").filter((id) =>
      id?.startsWith("assistant"),
    );
    expect(ids).toEqual([
      "assistant-shell-leave-guard-keep",
      "assistant-shell-leave-guard-discard",
    ]);
    expect(document.activeElement?.getAttribute("data-test")).toBe(
      "assistant-shell-leave-guard-keep",
    );
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await expect(asked).resolves.toBe("keep");
    wrapper.unmount();
  });

  it("returns focus to the control that asked once the question closes", async () => {
    const wrapper = mountDialogs();
    byTest("trigger")!.focus();
    const asked = askLifecycle({ kind: "leave_guard", name: raw("x") });
    await flushPromises();
    await frame();
    byTest("assistant-shell-leave-guard-discard")!.click();
    await expect(asked).resolves.toBe("discard");
    await flushPromises();
    await frame();
    expect(document.activeElement?.getAttribute("data-test")).toBe("trigger");
    wrapper.unmount();
  });

  it("says Keep withdraws waiting approvals, and returns focus to the menu's trigger once the item is gone", async () => {
    const wrapper = mountDialogs();
    const trigger = byTest("trigger")!;
    const item = document.createElement("button");
    document.body.appendChild(item);
    item.focus();
    const asked = askLifecycle({
      kind: "org_switch",
      count: 2,
      waiting: 1,
      org: "checkout",
      invoker: trigger,
    });
    await flushPromises();
    await frame();
    expect(byTest("assistant-shell-org-switch-dialog-note")!.textContent).toContain(
      "Keeping withdraws 1 waiting approval.",
    );
    item.remove();
    byTest("assistant-shell-org-switch-cancel")!.click();
    await expect(asked).resolves.toBe("cancel");
    await flushPromises();
    await frame();
    expect(document.activeElement).toBe(trigger);
    wrapper.unmount();
  });

  it("refuses an open question when the dialogs unmount, so nothing waits forever", async () => {
    const wrapper = mountDialogs();
    const asked = askLifecycle({ kind: "org_switch", count: 1, org: "o" });
    await flushPromises();
    wrapper.unmount();
    await expect(asked).resolves.toBe("cancel");
  });
});
