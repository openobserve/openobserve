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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import OnCallScheduleEditor from "@/components/oncall/OnCallScheduleEditor.vue";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import { fillField } from "@/test/unit/helpers/fillField";
import type { OnCallSchedule, Rotation, ScheduleEditorIntent } from "@/ts/interfaces/oncall";
import { MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import {
  hashDraftValue,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { byTest, clickIn } from "@/test/unit/helpers/draftDom";

vi.mock("@/services/oncall", () => ({
  default: { setSchedule: vi.fn(), listUnavailability: vi.fn(), previewResolvedSchedule: vi.fn() },
}));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/users", () => ({
  default: { orgUsers: vi.fn(() => Promise.resolve({ data: { data: [] } })) },
}));

const service = vi.mocked(oncallService);

const primary: Rotation = {
  id: "rot_primary",
  name: "Primary",
  shift_rules: [
    {
      name: "Base",
      members: ["ana@o2.ai"],
      shift_micros: MICROS_PER_WEEK,
      anchor_micros: 1_700_000_000_000_000,
      priority: 0,
      restrictions: [],
    },
  ],
};

const secondary: Rotation = { ...primary, id: "rot_secondary", name: "Secondary" };

const stored: OnCallSchedule = {
  id: "sch_1",
  org_id: "default",
  team_id: "team_1",
  timezone: "UTC",
  rotations: [primary, secondary],
  created_at: 0,
  updated_at: 0,
};

const scope: EditorDraftScope = {
  kind: "oncall_schedule",
  org: "default",
  entityId: "team_1/rot_primary",
  userEmail: "example@gmail.com",
};
const newScope: EditorDraftScope = { ...scope, entityId: null, variant: "team_1/new" };
const cloneScope: EditorDraftScope = {
  ...scope,
  entityId: null,
  variant: "team_1/clone:rot_primary",
};

const intent = ref<ScheduleEditorIntent | null>(null);
let saved = 0;
let router: Router;
let wrapper: VueWrapper | null = null;

const Host = defineComponent({
  setup() {
    return () =>
      h(OnCallScheduleEditor, {
        drawerOnly: true,
        teamId: "team_1",
        timezone: "UTC",
        schedule: stored,
        members: [
          { id: "a", team_id: "team_1", user_email: "ana@o2.ai" },
          { id: "b", team_id: "team_1", user_email: "bob@o2.ai" },
        ],
        intent: intent.value,
        onSaved: () => saved++,
        "onIntent-handled": () => (intent.value = null),
      });
  },
});

const mountEditor = async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/oncall/teams/team_1", name: "team", component: Host },
      { path: "/oncall/teams", name: "teams", component: { render: () => h("div") } },
    ],
  });
  await router.push("/oncall/teams/team_1");
  wrapper = mount(
    { render: () => h(RouterView) },
    { attachTo: document.body, global: { plugins: [i18n, store, router] } },
  );
  await flushPromises();
};

const openRotation = async (next: ScheduleEditorIntent = { mode: "edit", id: "rot_primary" }) => {
  intent.value = next;
  await flushPromises();
};

const nameField = () =>
  document.body.querySelector<HTMLInputElement>('[data-test="oncall-schedule-name"] input');
const drawerOpen = () => byTest("oncall-rotation-drawer") !== null;
const choose = async (dialog: string, id: string) => {
  clickIn(dialog, id);
  await flushPromises();
};
const footerButton = (label: string) =>
  [...document.body.querySelectorAll<HTMLElement>("button")].find(
    (button) => button.textContent?.trim() === label,
  )!;

const seedDraft = (name: string) =>
  writeEditorDraft(scope, {
    data: { rotation: { ...primary, name }, isNew: false, ruleTab: "0" },
    baseHash: hashDraftValue(primary),
  });

describe("OnCallScheduleEditor drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    intent.value = null;
    saved = 0;
    service.setSchedule.mockResolvedValue({ data: {} } as never);
    service.listUnavailability.mockResolvedValue({ data: [] } as never);
    service.previewResolvedSchedule.mockResolvedValue({ data: [] } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("a name filled programmatically inside the teleported drawer is drafted under the team's key", async () => {
    await mountEditor();
    await openRotation();
    expect(drawerOpen()).toBe(true);

    await fillField("oncall-schedule-name", "Platform");
    await vi.advanceTimersByTimeAsync(1100);

    const draft = readEditorDraft<{ rotation: Rotation; isNew: boolean }>(scope);
    expect(draft?.data.rotation.name).toBe("Platform");
    expect(draft?.data.isNew).toBe(false);
    expect(draft?.baseHash).toBe(hashDraftValue(primary));
  });

  it("Cancel with edits asks; Discard closes and keeps nothing", async () => {
    await mountEditor();
    await openRotation();
    await fillField("oncall-schedule-name", "Platform");

    footerButton("Cancel").click();
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    expect(drawerOpen()).toBe(true);

    await choose("editor-draft-leave-dialog", "o-dialog-neutral-btn");
    expect(drawerOpen()).toBe(false);
    expect(readEditorDraft(scope)).toBeNull();
  });

  it("Keep draft closes; the next open offers it and Continue brings the edit back", async () => {
    await mountEditor();
    await openRotation();
    await fillField("oncall-schedule-name", "Platform");
    footerButton("Cancel").click();
    await flushPromises();
    await choose("editor-draft-leave-dialog", "o-dialog-secondary-btn");
    expect(drawerOpen()).toBe(false);

    await openRotation();
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
    await choose("editor-draft-restore-dialog", "editor-draft-continue");

    expect(nameField()?.value).toBe("Platform");
  });

  it("opening another rotation does not offer this rotation's draft", async () => {
    seedDraft("Platform");
    await mountEditor();
    await openRotation({ mode: "edit", id: "rot_secondary" });

    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(nameField()?.value).toBe("Secondary");
    expect(readEditorDraft(scope)).not.toBeNull();
  });

  it("a new rotation keeps its draft in the team's new slot, which editing a stored rotation never offers", async () => {
    await mountEditor();
    await openRotation({ mode: "new" });
    await fillField("oncall-schedule-name", "Platform");
    footerButton("Cancel").click();
    await flushPromises();
    await choose("editor-draft-leave-dialog", "o-dialog-secondary-btn");
    expect(readEditorDraft<{ isNew: boolean }>(newScope)?.data.isNew).toBe(true);

    await openRotation({ mode: "edit", id: "rot_primary" });
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    footerButton("Cancel").click();
    await flushPromises();

    await openRotation({ mode: "new" });
    await choose("editor-draft-restore-dialog", "editor-draft-continue");
    expect(nameField()?.value).toBe("Platform");
  });

  it("a duplicate keeps its own slot per source rotation", async () => {
    writeEditorDraft(newScope, {
      data: { rotation: { ...primary, id: "rot_new", name: "Fresh" }, isNew: true, ruleTab: "0" },
    });
    await mountEditor();
    await openRotation({ mode: "duplicate", id: "rot_primary" });
    expect(byTest("editor-draft-restore-dialog")).toBeNull();

    await fillField("oncall-schedule-name", "Primary copy edited");
    await vi.advanceTimersByTimeAsync(1100);
    expect(readEditorDraft<{ rotation: Rotation }>(cloneScope)?.data.rotation.name).toBe(
      "Primary copy edited",
    );
    expect(readEditorDraft<{ rotation: Rotation }>(newScope)?.data.rotation.name).toBe("Fresh");
  });

  it("removing a rotation from its drawer drops every user's draft of it and of its duplicates", async () => {
    const teammate = { ...scope, userEmail: "teammate@o2.ai" };
    const teammateClone = { ...cloneScope, userEmail: "teammate@o2.ai" };
    const secondaryScope = { ...scope, entityId: "team_1/rot_secondary" };
    for (const draftScope of [teammate, cloneScope, teammateClone, secondaryScope, newScope]) {
      writeEditorDraft(draftScope, {
        data: { rotation: { ...primary, name: "Edited" }, isNew: false, ruleTab: "0" },
      });
    }
    await mountEditor();
    await openRotation();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();

    byTest("oncall-rotation-delete")!.click();
    await flushPromises();
    wrapper!.findComponent({ name: "OnCallRemoveRotationDialog" }).vm.$emit("confirm");
    await flushPromises();

    expect(service.setSchedule).toHaveBeenCalledTimes(1);
    expect(readEditorDraft(teammate)).toBeNull();
    expect(readEditorDraft(cloneScope)).toBeNull();
    expect(readEditorDraft(teammateClone)).toBeNull();
    expect(readEditorDraft(secondaryScope)).not.toBeNull();
    expect(readEditorDraft(newScope)).not.toBeNull();
  });

  it("a rotation whose removal fails keeps its drafts", async () => {
    service.setSchedule.mockRejectedValue({ response: { data: { message: "nope" } } } as never);
    const teammate = { ...scope, userEmail: "teammate@o2.ai" };
    writeEditorDraft(teammate, {
      data: { rotation: { ...primary, name: "Edited" }, isNew: false, ruleTab: "0" },
    });
    await mountEditor();
    await openRotation();

    byTest("oncall-rotation-delete")!.click();
    await flushPromises();
    wrapper!.findComponent({ name: "OnCallRemoveRotationDialog" }).vm.$emit("confirm");
    await flushPromises();

    expect(readEditorDraft(teammate)).not.toBeNull();
  });

  it("Start fresh drops the draft and shows the stored rotation", async () => {
    seedDraft("Platform");
    await mountEditor();
    await openRotation();
    await choose("editor-draft-restore-dialog", "o-dialog-secondary-btn");

    expect(readEditorDraft(scope)).toBeNull();
    expect(nameField()?.value).toBe("Primary");
  });

  it("Escape keeps the draft and leaves the stored rotation on screen", async () => {
    seedDraft("Platform");
    await mountEditor();
    await openRotation();
    byTest("editor-draft-restore-dialog")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();

    expect(readEditorDraft(scope)).not.toBeNull();
    expect(nameField()?.value).toBe("Primary");
  });

  it("the leave dialog's Save stores the schedule and closes without navigating", async () => {
    await mountEditor();
    await openRotation();
    await fillField("oncall-schedule-name", "Platform");
    footerButton("Cancel").click();
    await flushPromises();

    await choose("editor-draft-leave-dialog", "editor-draft-leave-save");

    expect(service.setSchedule).toHaveBeenCalledTimes(1);
    expect(saved).toBe(1);
    expect(drawerOpen()).toBe(false);
    expect(router.currentRoute.value.name).toBe("team");
    expect(readEditorDraft(scope)).toBeNull();
  });

  it("a route leave with edits asks; Keep draft stores them and the navigation goes on", async () => {
    await mountEditor();
    await openRotation();
    await fillField("oncall-schedule-name", "Platform");

    void router.push("/oncall/teams");
    await flushPromises();
    await choose("editor-draft-leave-dialog", "o-dialog-secondary-btn");

    expect(router.currentRoute.value.name).toBe("teams");
    expect(readEditorDraft<{ rotation: Rotation }>(scope)?.data.rotation.name).toBe("Platform");
  });

  it("an unedited drawer closes at once", async () => {
    await mountEditor();
    await openRotation();
    footerButton("Cancel").click();
    await flushPromises();

    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(drawerOpen()).toBe(false);
  });
});
