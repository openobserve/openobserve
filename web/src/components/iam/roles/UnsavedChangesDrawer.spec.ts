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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import UnsavedChangesDrawer, {
  type PendingChange,
  type PendingGroup,
} from "@/components/iam/roles/UnsavedChangesDrawer.vue";
import type { CompanionGap } from "@/components/iam/roles/roleCompanions";

const ORG = "default";
const ALL = `_all_${ORG}`;

const LABELS: Record<string, string> = {
  stream: "Streams",
  destination: "Destinations",
  template: "Templates",
  afolder: "Alert Folders",
  dfolder: "Dash Folders",
};

const ACTION_LABELS: Record<string, string> = { AllowList: "List", AllowGet: "Get" };

// The real drawer portals its lazy body; the stub renders it in place with the footer buttons it is given.
const ODrawerStub = {
  props: [
    "open",
    "secondaryButtonLabel",
    "secondaryButtonDisabled",
    "primaryButtonLabel",
    "primaryButtonDataTest",
  ],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `<div>
    <slot />
    <button data-test="o-drawer-secondary-btn" :disabled="secondaryButtonDisabled" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
    <button :data-test="primaryButtonDataTest" @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
  </div>`,
};

const change = (id: string, overrides: Partial<PendingChange> = {}): PendingChange => ({
  id,
  state: "added",
  label: raw(id),
  moduleLabel: raw("Streams"),
  moduleKey: "stream",
  actions: [{ action: "AllowGet", label: raw("Get") }],
  keys: [`${id}:AllowGet`],
  effect: raw(`effect of ${id}`),
  notes: [],
  ...overrides,
});

const group = (key: string, changes: PendingChange[]): PendingGroup => ({
  key,
  label: raw(LABELS[key] ?? key),
  icon: "window",
  changes,
});

const gap = (module: string, actions: CompanionGap["actions"], by = "afolder"): CompanionGap => ({
  module,
  actions,
  neededBy: [{ module: by, reasonKey: "iam.editRole.companionReasonAlertDestinations" }],
});

const mountDrawer = (
  props: { groups?: PendingGroup[]; gaps?: CompanionGap[]; saving?: boolean } = {},
) =>
  mount(UnsavedChangesDrawer, {
    props: {
      open: true,
      groups: [],
      gaps: [],
      orgId: ORG,
      moduleLabel: (key: string) => raw(LABELS[key] ?? key),
      summaryActions: (actions: string[]) =>
        actions.map((action) => ({ action, label: raw(ACTION_LABELS[action] ?? action) })),
      ...props,
    },
    global: { plugins: [i18n], stubs: { ODrawer: ODrawerStub } },
  });

const find = (wrapper: ReturnType<typeof mountDrawer>, dataTest: string) =>
  wrapper.find(`[data-test="${dataTest}"]`);

describe("UnsavedChangesDrawer - Not Added Yet", () => {
  it("shows nothing missing when every module is in place", () => {
    const wrapper = mountDrawer({ groups: [group("stream", [change("logs-app-added")])] });

    expect(find(wrapper, "edit-role-companions").exists()).toBe(false);
  });

  it("opens the list for one or two missing modules", () => {
    const wrapper = mountDrawer({
      gaps: [gap("destination", ["AllowList"]), gap("template", ["AllowList"])],
    });

    expect(find(wrapper, "edit-role-companions").text()).toContain("Not Added Yet · 2 modules");
    expect(find(wrapper, "edit-role-companion-destination").exists()).toBe(true);
    expect(find(wrapper, "edit-role-companions-toggle").attributes("aria-expanded")).toBe("true");
    expect(find(wrapper, "edit-role-companions-names").exists()).toBe(false);
  });

  it("closes the list for three or more, still naming them on one line", async () => {
    const wrapper = mountDrawer({
      gaps: [
        gap("stream", ["AllowList", "AllowGet"]),
        gap("destination", ["AllowList"]),
        gap("template", ["AllowList"]),
      ],
    });

    expect(find(wrapper, "edit-role-companion-stream").exists()).toBe(false);
    expect(find(wrapper, "edit-role-companions-names").text()).toBe(
      "Streams: List and Get, Destinations: List, Templates: List",
    );

    await find(wrapper, "edit-role-companions-toggle").trigger("click");

    expect(find(wrapper, "edit-role-companion-stream").exists()).toBe(true);
  });

  it("returns to the default each time the drawer opens", async () => {
    const wrapper = mountDrawer({ gaps: [gap("destination", ["AllowList"])] });
    await find(wrapper, "edit-role-companions-toggle").trigger("click");
    expect(find(wrapper, "edit-role-companion-destination").exists()).toBe(false);

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });

    expect(find(wrapper, "edit-role-companion-destination").exists()).toBe(true);
  });

  it("says which module needs a missing one, and why", () => {
    const wrapper = mountDrawer({ gaps: [gap("destination", ["AllowList"])] });

    expect(find(wrapper, "edit-role-companion-destination").text()).toContain(
      "Alert Folders needs it to choose where alerts send.",
    );
  });

  it("adds the module-wide grant for one row", async () => {
    const wrapper = mountDrawer({ gaps: [gap("destination", ["AllowList"])] });

    await find(wrapper, "edit-role-companion-add-destination").trigger("click");

    expect(wrapper.emitted("add")).toEqual([[[`destination:${ALL}:AllowList`]]]);
  });

  // Streams Get is picked per stream (D1), so its row opens Streams and never adds a module-wide read.
  it("offers Open Streams instead of Add when Streams Get is missing", async () => {
    const wrapper = mountDrawer({ gaps: [gap("stream", ["AllowList", "AllowGet"], "dfolder")] });

    expect(find(wrapper, "edit-role-companion-add-stream").exists()).toBe(false);
    await find(wrapper, "edit-role-companion-open-stream").trigger("click");

    expect(wrapper.emitted("open-module")).toEqual([["stream"]]);
    expect(wrapper.emitted("add")).toBeUndefined();
  });

  it("offers Add when Streams lacks only List", () => {
    const wrapper = mountDrawer({ gaps: [gap("stream", ["AllowList"], "dfolder")] });

    expect(find(wrapper, "edit-role-companion-add-stream").exists()).toBe(true);
    expect(find(wrapper, "edit-role-companion-open-stream").exists()).toBe(false);
  });

  it("adds every gap at once but leaves Streams Get to be picked", async () => {
    const wrapper = mountDrawer({
      gaps: [
        gap("stream", ["AllowList", "AllowGet"], "dfolder"),
        gap("destination", ["AllowList"]),
      ],
    });

    await find(wrapper, "edit-role-companions-add-all").trigger("click");

    expect(wrapper.emitted("add")).toEqual([
      [[`stream:${ALL}:AllowList`, `destination:${ALL}:AllowList`]],
    ]);
  });

  it("offers Add All only for two or more gaps", () => {
    const wrapper = mountDrawer({ gaps: [gap("destination", ["AllowList"])] });

    expect(find(wrapper, "edit-role-companions-add-all").exists()).toBe(false);
  });
});

describe("UnsavedChangesDrawer - Your Changes", () => {
  it("counts the changes and the modules they touch", () => {
    const wrapper = mountDrawer({
      groups: [
        group("stream", [change("logs-app-added"), change("metrics-cpu-added")]),
        group("other", [change("mystery-x1-added", { moduleKey: "other" })]),
      ],
    });

    expect(find(wrapper, "edit-role-unsaved-summary").text()).toBe("· 3 changes in 2 modules");
  });

  it("reads None Yet with only missing modules to show", () => {
    const wrapper = mountDrawer({ gaps: [gap("destination", ["AllowList"])] });

    expect(find(wrapper, "edit-role-unsaved-summary").text()).toBe("· None Yet");
  });

  it("lists each change under its module group, the Other group included", () => {
    const wrapper = mountDrawer({
      groups: [
        group("stream", [change("logs-app-added")]),
        group("other", [change("mystery-x1-added", { moduleKey: "other" })]),
      ],
    });

    expect(
      find(wrapper, "edit-role-unsaved-group-stream")
        .find('[data-test="edit-role-unsaved-logs-app-added"]')
        .exists(),
    ).toBe(true);
    expect(
      find(wrapper, "edit-role-unsaved-group-other")
        .find('[data-test="edit-role-unsaved-mystery-x1-added"]')
        .exists(),
    ).toBe(true);
  });

  it("shows a change's effect and notes", () => {
    const wrapper = mountDrawer({
      groups: [
        group("stream", [
          change("stream-all-added", {
            effect: raw("Can see the list of every stream."),
            notes: [raw("Dash Folders needs this to load panel data.")],
          }),
        ]),
      ],
    });

    const row = find(wrapper, "edit-role-unsaved-stream-all-added");
    expect(row.text()).toContain("Can see the list of every stream.");
    expect(row.text()).toContain("Dash Folders needs this to load panel data.");
  });

  it("undoes one change with its own keys", async () => {
    const wrapper = mountDrawer({
      groups: [group("stream", [change("logs-app-added", { keys: ["logs:app:AllowGet"] })])],
    });

    await find(wrapper, "edit-role-unsaved-undo-logs-app-added").trigger("click");

    expect(wrapper.emitted("undo")).toEqual([[["logs:app:AllowGet"]]]);
  });

  it("undoes every change from the footer", async () => {
    const wrapper = mountDrawer({
      groups: [
        group("stream", [change("logs-app-added", { keys: ["logs:app:AllowGet"] })]),
        group("dfolder", [change("dfolder-f1-removed", { keys: ["dfolder:f1:AllowGet"] })]),
      ],
    });

    await find(wrapper, "o-drawer-secondary-btn").trigger("click");

    expect(wrapper.emitted("undo")).toEqual([[["logs:app:AllowGet", "dfolder:f1:AllowGet"]]]);
  });

  it("disables Undo All with nothing to undo", () => {
    const wrapper = mountDrawer({ gaps: [gap("destination", ["AllowList"])] });

    expect(find(wrapper, "o-drawer-secondary-btn").attributes("disabled")).toBeDefined();
  });

  it("saves from the footer, even with no change", async () => {
    const wrapper = mountDrawer({ gaps: [gap("destination", ["AllowList"])] });

    await find(wrapper, "edit-role-unsaved-save").trigger("click");

    expect(wrapper.emitted("save")).toHaveLength(1);
  });
});

describe("UnsavedChangesDrawer - while a save is in flight", () => {
  // A key staged before the PUT settles would be committed as saved without being sent.
  it("disables every button that stages or opens a module", async () => {
    const wrapper = mountDrawer({
      saving: true,
      groups: [group("stream", [change("logs-app-added")])],
      gaps: [
        gap("destination", ["AllowList"]),
        gap("template", ["AllowList"]),
        gap("stream", ["AllowList", "AllowGet"], "dfolder"),
      ],
    });
    await find(wrapper, "edit-role-companions-toggle").trigger("click");

    [
      "edit-role-companions-add-all",
      "edit-role-companion-add-destination",
      "edit-role-companion-open-stream",
      "edit-role-unsaved-undo-logs-app-added",
      "o-drawer-secondary-btn",
    ].forEach((dataTest) =>
      expect(find(wrapper, dataTest).attributes("disabled"), dataTest).toBeDefined(),
    );
  });
});
