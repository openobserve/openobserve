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
import { createStore } from "vuex";
import { raw } from "@/types/i18n";
import EditorDraftRestoreDialog from "./EditorDraftRestoreDialog.vue";

const store = createStore({ state: { timezone: "UTC" } });
let wrapper: VueWrapper | null = null;

const savedAt = Date.UTC(2026, 9, 21, 14, 32);

const mountDialog = async (props: Record<string, unknown> = {}) => {
  wrapper = mount(EditorDraftRestoreDialog, {
    attachTo: document.body,
    props: { open: true, savedAt, entityLabel: raw("alert template"), ...props },
    global: { plugins: [store] },
  });
  await flushPromises();
  return wrapper;
};

const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);

describe("EditorDraftRestoreDialog", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("names the entity and the draft time to the minute", async () => {
    await mountDialog();
    expect(byTest("editor-draft-restore-dialog")?.textContent).toContain("Unsaved draft");
    const message = byTest("editor-draft-restore-message")?.textContent ?? "";
    expect(message).toContain("unsaved changes to this alert template from");
    expect(message).toContain("2026");
    expect(message).toMatch(/2:32|14:32/);
  });

  it("emits continue and fresh from its buttons", async () => {
    const dialog = await mountDialog();
    byTest("editor-draft-continue")?.click();
    document.body
      .querySelector<HTMLElement>(
        '[data-test="editor-draft-restore-dialog"] [data-test="o-dialog-secondary-btn"]',
      )
      ?.click();
    expect(dialog.emitted("continue")).toHaveLength(1);
    expect(dialog.emitted("fresh")).toHaveLength(1);
  });

  it("emits dismiss when closed", async () => {
    const dialog = await mountDialog();
    byTest("o-dialog-close-btn")?.click();
    await flushPromises();
    expect(dialog.emitted("dismiss")).toHaveLength(1);
  });

  it("shows the server-change and credentials notes only when set", async () => {
    await mountDialog();
    expect(byTest("editor-draft-changed-on-server")).toBeNull();
    expect(byTest("editor-draft-credentials-not-saved")).toBeNull();
    wrapper?.unmount();

    await mountDialog({ changedOnServer: true, credentialsNotSaved: true });
    expect(byTest("editor-draft-changed-on-server")?.textContent).toContain(
      "This alert template was changed",
    );
    expect(byTest("editor-draft-credentials-not-saved")).not.toBeNull();
  });

  it("uses a custom title", async () => {
    await mountDialog({ title: raw("Unsaved local changes") });
    expect(byTest("editor-draft-restore-dialog")?.textContent).toContain("Unsaved local changes");
  });

  it("lists every notice in one banner, a warning when the item changed on the server", async () => {
    await mountDialog({ changedOnServer: true, credentialsNotSaved: true });
    const banners = document.body.querySelectorAll(
      '[data-test="editor-draft-restore-dialog"] [role="alert"], [data-test="editor-draft-restore-dialog"] [role="status"]',
    );
    expect(banners).toHaveLength(1);
    expect(byTest("editor-draft-restore-notices")?.querySelectorAll("li")).toHaveLength(2);
    expect(byTest("editor-draft-restore-notices")?.getAttribute("role")).toBe("alert");
    wrapper?.unmount();

    await mountDialog({ credentialsNotSaved: true });
    expect(byTest("editor-draft-restore-notices")?.getAttribute("role")).toBe("status");
    expect(byTest("editor-draft-restore-notices")?.querySelectorAll("li")).toHaveLength(1);
  });

  it("puts the editor's note behind an info icon beside the message", async () => {
    await mountDialog({ note: raw("Continuing generates a new key.") });
    const hint = byTest("editor-draft-restore-note");
    expect(hint?.tagName).toBe("BUTTON");
    expect(hint?.getAttribute("aria-label")).toBe("Continuing generates a new key.");
    expect(byTest("editor-draft-restore-notices")).toBeNull();
    expect(byTest("editor-draft-restore-dialog")?.textContent).not.toContain(
      "Continuing generates a new key.",
    );
  });

  it("avoids the word draft in its notices for an item with a server-side draft", async () => {
    await mountDialog({ changedOnServer: true, credentialsNotSaved: true, serverDraftItem: true });
    const notices = byTest("editor-draft-restore-notices")?.textContent ?? "";
    expect(notices).toContain("after your changes were kept in this browser");
    expect(notices).toContain("are not kept in this browser");
    expect(notices).not.toContain("draft");
  });

  it("names the changed fields that were not kept", async () => {
    await mountDialog({
      credentialsNotSaved: true,
      notKeptFields: [raw("token"), raw("X-Api-Key header")],
    });
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain(
      "Your changes to the token and X-Api-Key header were not kept.",
    );
  });
});
