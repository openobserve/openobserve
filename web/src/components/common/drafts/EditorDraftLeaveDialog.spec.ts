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

describe("EditorDraftLeaveDialog", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("asks about the entity and offers save, keep draft and discard", async () => {
    const dialog = await mountDialog();
    const root = document.body.querySelector('[data-test="editor-draft-leave-dialog"]');
    expect(root?.textContent).toContain("Leave with unsaved changes?");
    expect(root?.textContent).toContain("Save the report");
    expect(root?.textContent).toContain("in this browser until you sign out");

    button("editor-draft-leave-save")?.click();
    button("o-dialog-secondary-btn")?.click();
    button("o-dialog-neutral-btn")?.click();
    expect(dialog.emitted("choose")).toEqual([["save"], ["keep"], ["discard"]]);
  });

  it("says signing out discards drafts, and offers only save and discard", async () => {
    await mountDialog({ canKeepDraft: false, signingOut: true });
    const message = document.body.querySelector('[data-test="editor-draft-leave-message"]');
    expect(message?.textContent).toContain("Save the report or discard your changes.");
    expect(message?.textContent).not.toContain("draft");
    expect(
      document.body.querySelector('[data-test="editor-draft-leave-sign-out"]')?.textContent,
    ).toContain("Signing out discards the unsaved drafts kept in this browser.");
    expect(button("o-dialog-secondary-btn")).toBeNull();
    expect(button("o-dialog-neutral-btn")).not.toBeNull();
  });

  it("hides keep draft when drafts cannot be stored", async () => {
    await mountDialog({ canKeepDraft: false });
    expect(button("o-dialog-secondary-btn")).toBeNull();
    expect(button("editor-draft-leave-save")).not.toBeNull();
  });

  it("stays on close", async () => {
    const dialog = await mountDialog();
    button("o-dialog-close-btn")?.click();
    await flushPromises();
    expect(dialog.emitted("choose")).toEqual([["stay"]]);
  });

  it("is persistent and disables its buttons while saving", async () => {
    const dialog = await mountDialog({ saving: true });
    expect(dialog.findComponent({ name: "ODialog" }).props("persistent")).toBe(true);
    expect(button("o-dialog-neutral-btn")?.hasAttribute("disabled")).toBe(true);
    expect(button("o-dialog-secondary-btn")?.hasAttribute("disabled")).toBe(true);
  });
});
