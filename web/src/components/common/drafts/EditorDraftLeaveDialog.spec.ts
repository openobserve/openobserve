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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { raw } from "@/types/i18n";
import EditorDraftLeaveDialog from "./EditorDraftLeaveDialog.vue";

let wrapper: VueWrapper | null = null;

const mountDialog = async (props: Record<string, unknown> = {}) => {
  wrapper = mount(EditorDraftLeaveDialog, {
    attachTo: document.body,
    props: { open: true, entityLabel: raw("report"), canKeepDraft: true, ...props },
  });
  await flushPromises();
  return wrapper;
};

const button = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="editor-draft-leave-dialog"] [data-test="${id}"]`,
  );

const click = (id: string) => {
  const target = button(id);
  if (!target) throw new Error(`no ${id} in the leave dialog`);
  target.click();
};

const messageText = () =>
  document.body.querySelector('[data-test="editor-draft-leave-message"]')?.textContent ?? "";

const pressEscape = async () => {
  const content = document.body.querySelector('[data-test="editor-draft-leave-dialog"]');
  content?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await flushPromises();
};

describe("EditorDraftLeaveDialog", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("asks about the entity and offers save, keep draft and discard", async () => {
    const dialog = await mountDialog();
    const root = document.body.querySelector('[data-test="editor-draft-leave-dialog"]');
    expect(root?.textContent).toContain("Leave with unsaved changes?");
    expect(messageText()).toContain("Save the report");
    expect(messageText()).toContain("in this browser until you sign out");

    click("editor-draft-leave-save");
    click("o-dialog-secondary-btn");
    click("o-dialog-neutral-btn");
    expect(dialog.emitted("choose")).toEqual([["save"], ["keep"], ["discard"]]);
    expect(button("o-dialog-neutral-btn")?.textContent?.trim()).toBe("Discard");
  });

  it("says in the dialog text that signing out discards the other drafts, and explains it behind the info icon", async () => {
    await mountDialog({ canKeepDraft: false, signingOut: true, otherDraftCount: 2 });
    expect(messageText()).toContain("Save the report or discard your changes.");
    expect(messageText()).not.toContain("draft");
    expect(
      document.body.querySelector('[data-test="editor-draft-leave-sign-out-others"]')?.textContent,
    ).toContain("Signing out also discards 2 other unsaved drafts in this browser.");
    const hint = document.body.querySelector('[data-test="editor-draft-leave-sign-out"]');
    expect(hint?.tagName).toBe("BUTTON");
    expect(hint?.getAttribute("aria-label")).toBe("Drafts are not kept when you sign out.");
    expect(button("o-dialog-secondary-btn")).toBeNull();
    expect(button("o-dialog-neutral-btn")).not.toBeNull();
  });

  it("says why there is no Keep when the sign-out leaves no other draft", async () => {
    await mountDialog({ canKeepDraft: false, signingOut: true });
    expect(
      document.body
        .querySelector('[data-test="editor-draft-leave-sign-out"]')
        ?.getAttribute("aria-label"),
    ).toBe("Drafts are not kept when you sign out.");
    expect(
      document.body.querySelector('[data-test="editor-draft-leave-sign-out-others"]'),
    ).toBeNull();
  });

  it("hides keep draft when drafts cannot be stored", async () => {
    await mountDialog({ canKeepDraft: false });
    expect(button("o-dialog-secondary-btn")).toBeNull();
    expect(button("editor-draft-leave-save")).not.toBeNull();
    expect(document.body.querySelector('[data-test="editor-draft-leave-sign-out"]')).toBeNull();
  });

  it("offers a Stay button beside Discard when the item cannot be saved", async () => {
    const dialog = await mountDialog({ canKeepDraft: false, canSave: false, signingOut: true });
    expect(messageText()).toContain("or stay on this page");
    expect(button("editor-draft-leave-save")).toBeNull();
    expect(button("o-dialog-secondary-btn")?.textContent?.trim()).toBe("Stay");
    click("o-dialog-secondary-btn");
    click("o-dialog-neutral-btn");
    expect(dialog.emitted("choose")).toEqual([["stay"], ["discard"]]);
  });

  it("cannot be closed or stayed in during a forced sign-out", async () => {
    const dialog = await mountDialog({
      canKeepDraft: false,
      canSave: false,
      forced: true,
      signingOut: true,
      otherDraftCount: 2,
    });
    expect(messageText()).toBe(
      "Your session has ended, so this report cannot be saved. Discard your changes to sign out.",
    );
    expect(button("o-dialog-close-btn")).toBeNull();
    expect(button("o-dialog-secondary-btn")).toBeNull();
    expect(button("editor-draft-leave-save")).toBeNull();
    expect(document.body.querySelector('[data-test="editor-draft-leave-sign-out"]')).toBeNull();
    expect(
      document.body.querySelector('[data-test="editor-draft-leave-sign-out-others"]'),
    ).toBeNull();
    await pressEscape();
    expect(dialog.emitted("choose")).toBeUndefined();
    expect(document.body.querySelector('[data-test="editor-draft-leave-dialog"]')).not.toBeNull();
    click("o-dialog-neutral-btn");
    expect(dialog.emitted("choose")).toEqual([["discard"]]);
  });

  it("shows the host's own message in place of the default copy", async () => {
    await mountDialog({ canKeepDraft: false, message: raw("Save it as a server draft.") });
    expect(messageText().trim()).toBe("Save it as a server draft.");
  });

  it("stays on close", async () => {
    const dialog = await mountDialog();
    click("o-dialog-close-btn");
    await flushPromises();
    expect(dialog.emitted("choose")).toEqual([["stay"]]);
  });

  it("stays on Escape when the sign-out is not forced", async () => {
    const dialog = await mountDialog({ canSave: false, canKeepDraft: false });
    await pressEscape();
    expect(dialog.emitted("choose")?.at(-1)).toEqual(["stay"]);
  });

  it("is persistent and disables its buttons while saving", async () => {
    const dialog = await mountDialog({ saving: true });
    expect(dialog.findComponent({ name: "ODialog" }).props("persistent")).toBe(true);
    expect(button("o-dialog-neutral-btn")?.hasAttribute("disabled")).toBe(true);
    expect(button("o-dialog-secondary-btn")?.hasAttribute("disabled")).toBe(true);
  });
});
