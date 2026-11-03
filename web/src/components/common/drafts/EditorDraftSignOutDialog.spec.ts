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
import EditorDraftSignOutDialog from "./EditorDraftSignOutDialog.vue";

let wrapper: VueWrapper | null = null;

const mountDialog = async (count: number) => {
  wrapper = mount(EditorDraftSignOutDialog, {
    attachTo: document.body,
    props: { open: true, count },
  });
  await flushPromises();
  return wrapper;
};

const inDialog = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="editor-draft-signout-dialog"] [data-test="${id}"]`,
  );

describe("EditorDraftSignOutDialog", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("says how many drafts signing out discards, in the plural", async () => {
    await mountDialog(3);
    expect(
      document.body.querySelector('[data-test="editor-draft-signout-message"]')?.textContent,
    ).toContain("You have 3 unsaved drafts in this browser. Signing out discards them.");
  });

  it("uses the singular for one draft", async () => {
    await mountDialog(1);
    expect(
      document.body.querySelector('[data-test="editor-draft-signout-message"]')?.textContent,
    ).toContain("You have 1 unsaved draft in this browser. Signing out discards it.");
  });

  it("confirms with Sign out and closes with Cancel", async () => {
    const dialog = await mountDialog(2);
    inDialog("editor-draft-signout-confirm")?.click();
    expect(dialog.emitted("confirm")).toHaveLength(1);
    expect(dialog.emitted("update:open")?.[0]).toEqual([false]);

    inDialog("o-dialog-secondary-btn")?.click();
    expect(dialog.emitted("confirm")).toHaveLength(1);
    expect(dialog.emitted("update:open")).toHaveLength(2);
  });
});
