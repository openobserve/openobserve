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
import PanelLeaveDialog from "./PanelLeaveDialog.vue";

let wrapper: VueWrapper | null = null;

const mountDialog = async (props: Record<string, unknown> = {}) => {
  wrapper = mount(PanelLeaveDialog, {
    attachTo: document.body,
    props: { open: true, canKeepDraft: true, ...props },
  });
  await flushPromises();
  return wrapper;
};

const inDialog = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="dashboard-panel-leave-dialog"] [data-test="${id}"]`,
  );

describe("PanelLeaveDialog", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("matches the editor's leave copy and buttons", async () => {
    const dialog = await mountDialog();
    expect(inDialog("dashboard-panel-leave-message")?.textContent?.trim()).toBe(
      "Save the panel, keep your changes as a draft in this browser until you sign out, or discard them.",
    );
    expect(inDialog("o-dialog-neutral-btn")?.textContent?.trim()).toBe("Discard");
    inDialog("o-dialog-secondary-btn")!.click();
    expect(dialog.emitted("choose")).toEqual([["keep"]]);
  });

  it("puts the sign-out note behind an info icon that counts the other drafts", async () => {
    await mountDialog({ canKeepDraft: false, signingOut: true, otherDraftCount: 3 });
    expect(inDialog("o-dialog-secondary-btn")).toBeNull();
    expect(inDialog("dashboard-panel-leave-sign-out")?.getAttribute("aria-label")).toBe(
      "Signing out also discards 3 other unsaved drafts in this browser.",
    );
  });

  it("offers Stay beside Discard when the panel cannot be saved", async () => {
    const dialog = await mountDialog({ canKeepDraft: false, canSave: false, signingOut: true });
    expect(inDialog("dashboard-panel-leave-save")).toBeNull();
    const stay = inDialog("o-dialog-secondary-btn");
    expect(stay?.textContent?.trim()).toBe("Stay");
    stay!.click();
    inDialog("o-dialog-neutral-btn")!.click();
    expect(dialog.emitted("choose")).toEqual([["stay"], ["discard"]]);
  });
});
