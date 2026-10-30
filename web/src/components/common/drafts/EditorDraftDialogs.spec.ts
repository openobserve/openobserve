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

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive } from "vue";
import { raw } from "@/types/i18n";
import type { EditorDraftController } from "@/composables/useEditorDraft";
import EditorDraftDialogs from "./EditorDraftDialogs.vue";
import EditorDraftRestoreDialog from "./EditorDraftRestoreDialog.vue";
import EditorDraftLeaveDialog from "./EditorDraftLeaveDialog.vue";

const controller = (): EditorDraftController => ({
  start: vi.fn(),
  confirmLeave: vi.fn(),
  markSaved: vi.fn(),
  discard: vi.fn(),
  hasUnsavedChanges: vi.fn(() => false),
  storageAvailable: true,
  state: reactive({
    entityLabel: raw("pipeline"),
    restoreTitle: raw("Unsaved draft"),
    restoreOpen: true,
    restoreSavedAt: 42,
    changedOnServer: true,
    credentialsNotSaved: false,
    leaveOpen: false,
    leaveSaving: true,
    canKeepDraft: false,
  }),
  chooseRestore: vi.fn(),
  chooseLeave: vi.fn(),
});

describe("EditorDraftDialogs", () => {
  it("binds both dialogs to the controller's state and choices", async () => {
    const draft = controller();
    const wrapper = mount(EditorDraftDialogs, {
      props: { draft },
      global: { stubs: { EditorDraftRestoreDialog: true, EditorDraftLeaveDialog: true } },
    });

    const restore = wrapper.findComponent(EditorDraftRestoreDialog);
    expect(restore.props()).toMatchObject({
      open: true,
      savedAt: 42,
      entityLabel: "pipeline",
      title: "Unsaved draft",
      changedOnServer: true,
      credentialsNotSaved: false,
    });
    const leave = wrapper.findComponent(EditorDraftLeaveDialog);
    expect(leave.props()).toMatchObject({
      open: false,
      entityLabel: "pipeline",
      saving: true,
      canKeepDraft: false,
    });

    restore.vm.$emit("continue");
    restore.vm.$emit("fresh");
    restore.vm.$emit("dismiss");
    leave.vm.$emit("choose", "keep");
    expect(vi.mocked(draft.chooseRestore).mock.calls).toEqual([
      ["continue"],
      ["fresh"],
      ["dismiss"],
    ]);
    expect(draft.chooseLeave).toHaveBeenCalledWith("keep");
  });
});
