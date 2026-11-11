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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { ComponentPublicInstance } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetOnCallRoutingConfig } from "@/composables/useOnCallRoutingConfig";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import { resetListViewState, useListViewState } from "@/composables/useListViewState";
import oncallService from "@/services/oncall";
import { userKeys } from "@/services/users.querykeys";
import { orgUsersQuery } from "@/services/users.queries";
import { ok } from "@/test/unit/helpers/mockService";
import store from "@/test/unit/helpers/store";
import OnCallTeams from "@/views/OnCall/OnCallTeams.vue";
import {
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";

vi.mock("@/services/oncall", () => ({
  default: {
    listTeams: vi.fn(),
    whoIsOnCall: vi.fn(),
    deleteTeam: vi.fn(),
    getRoutingConfig: vi.fn(),
    setRoutingConfig: vi.fn(),
    coverageGaps: vi.fn(),
  },
}));

const push = vi.fn();
const replace = vi.fn();
const routeQuery: Record<string, string> = {};
vi.mock("vue-router", () => ({
  useRouter: () => ({ push, replace }),
  useRoute: () => ({ name: "onCallTeams", params: {}, query: routeQuery }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));

// setDefaultTeam awaits a confirm dialog that only resolves via user
// interaction with a rendered provider — unmocked, the call hangs until timeout.
const mockConfirm = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({
    currentDialog: { value: null },
    confirm: mockConfirm,
    handleConfirm: vi.fn(),
    handleCancel: vi.fn(),
    handleUpdateOpen: vi.fn(),
  }),
}));

const service = vi.mocked(oncallService);

// A selector lookup cannot know the component it lands on, so its props are read by name.
type AnyPropsWrapper = VueWrapper<ComponentPublicInstance<Record<string, unknown>>>;

const stubs = {
  OPageLayout: { name: "OPageLayout", template: "<div><slot name='actions' /><slot /></div>" },
  // Renders the real cell slots, so the tests exercise what the page actually
  // draws rather than a column-def function OTable never calls.
  OTable: {
    name: "OTable",
    props: [
      "data",
      "columns",
      "error",
      "forbidden",
      "currentPage",
      "pageSize",
      "sortBy",
      "sortOrder",
      "persistColumns",
    ],
    emits: ["update:currentPage", "update:pageSize", "update:sortBy", "update:sortOrder"],
    template: `<div>
      <slot name='toolbar' />
      <slot v-if="error" name='error' />
      <template v-else>
        <div v-for="(row, i) in (data || [])" :key="i" data-test="row">
          <slot v-for="c in (columns || [])" :key="c.id" :name="'cell-' + c.id" :row="row" />
        </div>
        <slot name='empty' />
      </template>
    </div>`,
  },
  // Renders its description and action so the error assertions test OUR
  // wiring rather than the stub swallowing both.
  OEmptyState: {
    name: "OEmptyState",
    props: ["description", "actionLabel"],
    emits: ["action"],
    template: `<div>{{ description }}<button @click="$emit('action')">{{ actionLabel }}</button></div>`,
  },
  OSearchInput: {
    name: "OSearchInput",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: "<input />",
  },
  // `props` declared deliberately: a stub that does not declare what it is
  // passed drops it silently, and an assertion about a tooltip then passes
  // with no tooltip mounted.
  OTooltip: {
    name: "OTooltip",
    props: ["content"],
    template: "<span>{{ content }}<slot /></span>",
  },
  OTag: { name: "OTag", props: ["variant", "type", "value"], template: "<span><slot /></span>" },
  OUserCell: { name: "OUserCell", props: ["value"], template: "<span>{{ value }}</span>" },
  // Renders the menu open, so a row action behind ⋯ can be found and clicked like any other.
  ODropdown: { name: "ODropdown", template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownItem: {
    name: "ODropdownItem",
    props: ["iconLeft", "variant", "disabled", "description", "focusableUnavailable"],
    emits: ["select"],
    template: `<button :data-icon="iconLeft" @click="$emit('select')"><slot /></button>`,
  },
  OnCallTeamForm: {
    name: "OnCallTeamForm",
    props: ["open", "team", "offerDefault", "isDefault"],
    emits: ["saved", "update:open"],
    template: "<div />",
  },
  ConfirmDialog: {
    name: "ConfirmDialog",
    props: ["modelValue", "message", "messageKeypath", "messageName", "okLabel", "okVariant"],
    emits: ["update:ok", "update:cancel"],
    template:
      "<div v-if='modelValue' data-test='confirm'>{{ messageKeypath ? $t(messageKeypath, { name: messageName }) : message }}</div>",
  },
  // Mirrors the real OButton: emits declared (otherwise the listener also
  // falls through and handlers run twice) and the event passed on.
  // `aria-label` is NOT declared: OButton has no such prop, it reaches the
  // element by attribute fall-through. Declaring it here would assert a
  // contract the real component does not have — the same mistake that hid
  // three buttonless dialogs — and fall-through puts it on this root anyway.
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: `<button @click="(e) => $emit('click', e)"><slot /></button>`,
  },
};

function team(id: string, name: string) {
  return { id, org_id: "default", name, timezone: "UTC", created_at: 0, updated_at: 0 };
}

function render() {
  return mount(OnCallTeams, { global: { plugins: [i18n, store], stubs } });
}

/// The rendered row, which is where the coverage signal lives.
function onCallCell(wrapper: ReturnType<typeof render>, _row?: unknown) {
  return wrapper.find('[data-test="row"]');
}

describe("OnCallTeams", () => {
  beforeEach(() => {
    __resetOnCallRoutingConfig();
    resetListViewState();
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    service.whoIsOnCall.mockResolvedValue(ok([]));
    service.getRoutingConfig.mockResolvedValue(ok({ default_team_id: null }));
  });

  /// Mounts the real page layout so the tag is proven to reach the rendered header.
  it("tags the page title as Beta", async () => {
    const wrapper = mount(OnCallTeams, {
      global: { plugins: [i18n, store], stubs: { ...stubs, OPageLayout: false } },
    });
    await flushPromises();
    const badge = wrapper.find('[data-test="beta-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe(String(i18n.global.t("common.beta")));
  });

  /// The setup checklist's first step sends somebody here already meaning to
  /// create a team. Landing them on the list to hunt for the button is the same
  /// click asked twice.
  describe("arriving with the intent to create", () => {
    it("opens the form straight away on ?action=add", async () => {
      service.listTeams.mockResolvedValue(ok([]));
      routeQuery.action = "add";
      const wrapper = mount(OnCallTeams, { global: { plugins: [i18n, store], stubs } });
      await flushPromises();

      const form = wrapper.findComponent({ name: "OnCallTeamForm" });
      expect(form.props("open")).toBe(true);
      expect(form.props("team")).toBe(null);
    });

    /// Consumed, not left behind: a refresh or a Back into this page would
    /// otherwise reopen a form the reader had deliberately closed.
    it("strips the parameter once it has acted on it", async () => {
      service.listTeams.mockResolvedValue(ok([]));
      routeQuery.action = "add";
      routeQuery.org_identifier = "default";
      mount(OnCallTeams, { global: { plugins: [i18n, store], stubs } });
      await flushPromises();

      expect(replace).toHaveBeenCalledWith(
        expect.objectContaining({ query: { org_identifier: "default" } }),
      );
    });

    it("leaves the form closed without it", async () => {
      service.listTeams.mockResolvedValue(ok([]));
      const wrapper = mount(OnCallTeams, { global: { plugins: [i18n, store], stubs } });
      await flushPromises();

      expect(wrapper.findComponent({ name: "OnCallTeamForm" }).props("open")).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });
  });

  // A create action reads as a button with its icon, like every other On-Call header action.
  it("gives New team its add icon", async () => {
    service.listTeams.mockResolvedValue(ok([]));
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-teams-add-btn"]').attributes("icon-left")).toBe("add");
  });

  // Search, columns and refresh have nothing to act on until a team exists.
  it("shows no search or refresh while the org has no teams", async () => {
    service.listTeams.mockResolvedValue(ok([]));
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-teams-search"]').exists()).toBe(false);
    expect(wrapper.findComponent({ name: "OTable" }).props("persistColumns")).toBe(false);
  });

  it("keeps search once there is a team to find", async () => {
    service.listTeams.mockResolvedValue(ok([team("team_1", "Platform")]));
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-teams-search"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: "OTable" }).props("persistColumns")).toBe(true);
  });

  it("shows who is on call for each team", async () => {
    service.listTeams.mockResolvedValue(ok([team("team_1", "Platform")]));
    service.whoIsOnCall.mockResolvedValue(
      ok([{ rotation_name: "Primary", user_email: "engineer@example.com" }]),
    );

    const wrapper = render();
    await flushPromises();

    expect(onCallCell(wrapper).findComponent({ name: "OnCallPersonName" }).props("email")).toBe(
      "engineer@example.com",
    );
  });

  // Names are what a responder recognises; the email rides in the tooltip because two people can share a name.
  it("names the people on call and keeps their email in a tooltip", async () => {
    queryClient.setQueryData(orgUsersQuery("default").queryKey, [
      { email: "engineer@example.com", first_name: "Ena", last_name: "Gineer" },
    ]);
    service.listTeams.mockResolvedValue(ok([team("team_1", "Platform")]));
    service.whoIsOnCall.mockResolvedValue(
      ok([{ rotation_id: "r1", rotation_name: "Primary", user_email: "engineer@example.com" }]),
    );

    const wrapper = render();
    await flushPromises();

    const person = wrapper.find('[data-test="oncall-teams-primary-team_1"]');
    expect(person.text()).toContain("Ena Gineer");
    // The tooltip's two lines are OnCallPersonName's own contract, covered in its spec.
    const name = wrapper
      .findAllComponents({ name: "OnCallPersonName" })
      .find((one) => one.attributes("data-test") === "oncall-teams-primary-team_1");
    expect(name?.props("email")).toBe("engineer@example.com");
    expect(person.attributes("title")).toBeUndefined();
    queryClient.removeQueries({ queryKey: orgUsersQuery("default").queryKey });
  });

  /// A team nobody staffs will page no one, so it earns the one colour on this
  /// page rather than an empty cell.
  it("flags a team with nobody on call", async () => {
    service.listTeams.mockResolvedValue(ok([team("team_1", "Platform")]));
    service.whoIsOnCall.mockResolvedValue(ok([]));

    const wrapper = render();
    await flushPromises();

    const cell = onCallCell(wrapper);
    expect(cell.findComponent({ name: "OTag" }).props("value")).toBe("gap");
  });

  /// The gap that used to hide: a team whose secondary is staffed but whose
  /// primary is empty filled the single shared cell and read as covered.
  /// **A rotation that resolves to nobody is ABSENT from the response**, so an
  /// empty array is the coverage gap — there is no "primary slot with a null
  /// holder" to look for. A team whose only rotation has a gap answers `[]`,
  /// and that is the page's one alarm.
  it("flags a team with nobody on call at all", async () => {
    service.listTeams.mockResolvedValue(ok([team("team_1", "Platform")]));
    service.whoIsOnCall.mockResolvedValue(ok([]));

    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-teams-primary-gap-team_1"]').exists()).toBe(true);
  });

  /// Two fixed columns must not silently drop a third rotation a team declared.
  /// The split is by POSITION in the response — there is no slot keyword left —
  /// so the first entry fills the first column and everything else stays on the
  /// page beside it.
  it("keeps a rotation neither column is named after", async () => {
    service.listTeams.mockResolvedValue(ok([team("team_1", "Platform")]));
    service.whoIsOnCall.mockResolvedValue(
      ok([
        {
          rotation_id: "rot_primary",
          rotation_name: "Primary",
          rule: "Base",
          user_email: "primary@example.com",
        },
        {
          rotation_id: "rot_db",
          rotation_name: "Database",
          rule: "Base",
          user_email: "dba@example.com",
        },
      ]),
    );

    const wrapper = render();
    await flushPromises();

    const emails = wrapper
      .findAllComponents({ name: "OnCallPersonName" })
      .map((cell) => cell.props("email"));
    expect(emails).toEqual(["primary@example.com", "dba@example.com"]);
    // It keeps its own name rather than being filed under "Secondary".
    expect(wrapper.find('[data-test="oncall-teams-rotation-team_1-rot_db"]').exists()).toBe(true);
  });

  /// "We could not load it" and "nobody is on call" are different claims, and
  /// showing the second for the first sends someone chasing a phantom gap.
  it("does not call a failed lookup a coverage gap", async () => {
    service.listTeams.mockResolvedValue(ok([team("team_1", "Platform")]));
    service.whoIsOnCall.mockRejectedValue(new Error("boom"));

    const wrapper = render();
    await flushPromises();

    // Undefined means "not loaded", which must not render as a coverage gap.
    expect(onCallCell(wrapper).findComponent({ name: "OTag" }).exists()).toBe(false);
  });

  it("looks up every team", async () => {
    service.listTeams.mockResolvedValue(
      ok([team("team_1", "Platform"), team("team_2", "Payments")]),
    );

    render();
    await flushPromises();

    expect(service.whoIsOnCall).toHaveBeenCalledTimes(2);
  });

  describe("list view state", () => {
    const seed = () =>
      useListViewState("oncall-teams", {
        search: "",
        currentPage: 1,
        pageSize: 20,
        sortBy: "",
        sortOrder: "asc" as "asc" | "desc",
      });

    it("restores search, page, page size and sort on mount", async () => {
      service.listTeams.mockResolvedValue(ok([team("team_1", "Platform")]));
      Object.assign(seed(), {
        search: "plat",
        currentPage: 2,
        pageSize: 50,
        sortBy: "name",
        sortOrder: "desc",
      });
      const wrapper = render();
      await flushPromises();

      expect(wrapper.findComponent({ name: "OSearchInput" }).props("modelValue")).toBe("plat");
      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.props("currentPage")).toBe(2);
      expect(table.props("pageSize")).toBe(50);
      expect(table.props("sortBy")).toBe("name");
      expect(table.props("sortOrder")).toBe("desc");
    });

    it("saves search, page and sort changes", async () => {
      service.listTeams.mockResolvedValue(ok([team("team_1", "Platform")]));
      const wrapper = render();
      await flushPromises();

      wrapper.findComponent({ name: "OSearchInput" }).vm.$emit("update:modelValue", "pay");
      await flushPromises();
      const table = wrapper.findComponent({ name: "OTable" });
      table.vm.$emit("update:currentPage", 3);
      table.vm.$emit("update:sortBy", "name");
      await flushPromises();

      const saved = seed();
      expect(saved.search).toBe("pay");
      expect(saved.currentPage).toBe(3);
      expect(saved.sortBy).toBe("name");
    });
  });

  it("opens a team on row click", async () => {
    service.listTeams.mockResolvedValue(ok([team("team_1", "Platform")]));
    const wrapper = render();
    await flushPromises();

    wrapper.findComponent({ name: "OTable" }).vm.$emit("row-click", team("team_1", "Platform"));
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "onCallTeamDetail" }));
  });

  // S1: a team just created is the one the reader wants to set up next.
  it("opens the new team after create", async () => {
    service.listTeams.mockResolvedValue(ok([]));
    const wrapper = render();
    await flushPromises();

    wrapper.findComponent({ name: "OnCallTeamForm" }).vm.$emit("saved", "team_new");
    await flushPromises();

    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ name: "onCallTeamDetail", params: { teamId: "team_new" } }),
    );
  });

  /// Named in review: every mistake was permanent, because the delete endpoint
  /// and its service method both existed and nothing called them.
  describe("deleting a team", () => {
    async function open() {
      service.listTeams.mockResolvedValue(ok([team("team_1", "Platform")]));
      const wrapper = render();
      await flushPromises();
      await wrapper.find('[data-test="oncall-team-delete-team_1"]').trigger("click");
      await flushPromises();
      return wrapper;
    }

    /// Deleting the wrong rotation silently stops paging, and the name is the
    /// only thing distinguishing two otherwise identical rows.
    it("names the team and the consequence before deleting", async () => {
      const wrapper = await open();
      const confirm = wrapper.find('[data-test="confirm"]');

      expect(confirm.exists()).toBe(true);
      const dialog = wrapper.findComponent({ name: "ConfirmDialog" });
      expect(dialog.props("messageKeypath")).toBe("oncall.deleteTeamMessageToUnrouted");
      expect(dialog.props("messageName")).toBe("Platform");
      expect(dialog.props("okVariant")).toBe("destructive");
      expect(service.deleteTeam).not.toHaveBeenCalled();
    });

    // S14: the button says what it does, and the message says where routed alerts go next.
    it("names the button and sends routed alerts to Unrouted when there is no default team", async () => {
      const wrapper = await open();
      const confirm = wrapper.findComponent({ name: "ConfirmDialog" });

      expect(confirm.props("okLabel")).toBe("Delete team");
      expect(confirm.props("okVariant")).toBe("destructive");
      expect(confirm.props("messageKeypath")).toBe("oncall.deleteTeamMessageToUnrouted");
      expect(confirm.props("messageName")).toBe("Platform");
    });

    it("sends routed alerts to the default team when one is set", async () => {
      service.getRoutingConfig.mockResolvedValue(
        ok({ default_team_id: "team_2", default_team_name: "Payments" }),
      );
      service.listTeams.mockResolvedValue(
        ok([team("team_1", "Platform"), team("team_2", "Payments")]),
      );
      const wrapper = render();
      await flushPromises();
      await wrapper.find('[data-test="oncall-team-delete-team_1"]').trigger("click");
      await flushPromises();

      expect(wrapper.findComponent({ name: "ConfirmDialog" }).props("messageKeypath")).toBe(
        "oncall.deleteTeamMessageToDefault",
      );
    });

    it("deletes on confirm and reloads", async () => {
      service.deleteTeam.mockResolvedValue(ok({}));
      const wrapper = await open();

      wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
      await flushPromises();

      expect(service.deleteTeam).toHaveBeenCalledWith(
        expect.objectContaining({ team_id: "team_1" }),
      );
      expect(service.listTeams).toHaveBeenCalledTimes(2);
    });

    it("does nothing on cancel", async () => {
      const wrapper = await open();

      wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:cancel");
      await flushPromises();

      expect(service.deleteTeam).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="confirm"]').exists()).toBe(false);
    });
  });
  /// I6. Delete was the only per-row control, so the one irreversible act was
  /// the one discoverable act, and editing was a whole-row click nothing on the
  /// screen announced.
  describe("row actions", () => {
    async function rendered() {
      service.listTeams.mockResolvedValue(ok([team("team_1", "Platform")]));
      const wrapper = render();
      await flushPromises();
      return wrapper;
    }

    it("offers edit beside delete", async () => {
      const wrapper = await rendered();
      expect(wrapper.find('[data-test="oncall-team-edit-team_1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-team-delete-team_1"]').exists()).toBe(true);
    });

    /// Icons and no words: without a name each, the row offers a destructive
    /// action and a glyph the reader has to guess at. The tooltip is the
    /// sighted reader's name and `aria-label` the other's, so both are
    /// asserted — and both must SAY something, not merely exist.
    it("names every icon-only action, on hover and to a screen reader", async () => {
      const wrapper = await rendered();
      const edit = wrapper.find('[data-test="oncall-team-edit-team_1"]');
      expect(edit.attributes("aria-label")).toBe("Edit team");
      expect(edit.text()).toContain("Edit team");
      expect(wrapper.find('[data-test="oncall-team-delete-team_1"]').text()).toBe("Delete team");
    });

    /// A row holds its actions as icons on desktop; setting the default lives in the Edit drawer.
    it("offers no set-default on the row, with no star", async () => {
      const wrapper = await rendered();
      expect(wrapper.find('[data-test="oncall-teams-row-more-actions"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-team-set-default-team_1"]').exists()).toBe(false);
      expect(wrapper.html()).not.toContain("star-outline");
    });

    /// On a phone the icons give way to one ⋯ holding both, so Delete is never cut off the pinned column.
    it("mirrors Edit and Delete in a phone-only menu", async () => {
      const wrapper = await rendered();
      expect(wrapper.find('[data-test="oncall-team-edit-team_1"]').classes()).toContain(
        "max-md:hidden",
      );
      expect(wrapper.find('[data-test="oncall-team-delete-team_1"]').classes()).toContain(
        "max-md:hidden",
      );
      expect(wrapper.find('[data-test="oncall-team-more-team_1"]').classes()).toContain(
        "md:hidden",
      );

      await wrapper.find('[data-test="oncall-team-edit-team_1-menu"]').trigger("click");
      expect(wrapper.findComponent({ name: "OnCallTeamForm" }).props("team")).toEqual(
        expect.objectContaining({ id: "team_1" }),
      );
      await wrapper.find('[data-test="oncall-team-delete-team_1-menu"]').trigger("click");
      expect(wrapper.find('[data-test="confirm"]').text()).toContain("Platform");
    });

    it("keeps the default team's phone Delete off, with the reason", async () => {
      service.getRoutingConfig.mockResolvedValue(ok({ default_team_id: "team_1" }));
      const wrapper = await rendered();
      const item = wrapper.findComponent(
        '[data-test="oncall-team-delete-team_1-menu"]',
      ) as AnyPropsWrapper;
      expect(item.props("disabled")).toBe(true);
      expect(String(item.props("description"))).toBe("Make another team the default first");
    });

    /// The destructive one last, so the mouse does not pass over it on the way
    /// to the safe action.
    it("puts the irreversible action last", async () => {
      const html = (await rendered()).html();
      expect(html.indexOf("oncall-team-edit-team_1")).toBeLessThan(
        html.indexOf("oncall-team-delete-team_1"),
      );
    });

    it("opens the form on that team rather than an empty one", async () => {
      const wrapper = await rendered();
      await wrapper.find('[data-test="oncall-team-edit-team_1"]').trigger("click");
      await flushPromises();

      expect(wrapper.findComponent({ name: "OnCallTeamForm" }).props("team")).toEqual(
        expect.objectContaining({ id: "team_1" }),
      );
      // The row click navigates; the edit button must not do both.
      expect(push).not.toHaveBeenCalled();
    });
  });

  /// The routing screen was the only place this fact lived — a reader had to
  /// leave the list to learn who catches everything it can't place.
  describe("default team", () => {
    it("badges the team the routing config names as default", async () => {
      service.getRoutingConfig.mockResolvedValue(ok({ default_team_id: "team_2" }));
      service.listTeams.mockResolvedValue(
        ok([team("team_1", "Platform"), team("team_2", "Payments")]),
      );

      const wrapper = render();
      await flushPromises();

      const badge = wrapper.find('[data-test="oncall-team-default-badge-team_2"]');
      expect(badge.exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-team-default-badge-team_1"]').exists()).toBe(false);
      // It says what being the default means.
      expect(badge.text()).toContain("Gets every alert no team owns");
    });

    /// Every row keeps the same Edit and Delete slots, the default team's included.
    it("gives the default row the same Edit and Delete slots as every other row", async () => {
      service.getRoutingConfig.mockResolvedValue(ok({ default_team_id: "team_2" }));
      service.listTeams.mockResolvedValue(
        ok([team("team_1", "Platform"), team("team_2", "Payments")]),
      );
      const wrapper = render();
      await flushPromises();

      for (const id of ["team_1", "team_2"]) {
        expect(wrapper.find(`[data-test="oncall-team-edit-${id}"]`).exists()).toBe(true);
        expect(wrapper.find(`[data-test="oncall-team-delete-${id}"]`).exists()).toBe(true);
      }
    });

    // The server refuses to delete the default team, so its Delete is shown disabled with the reason.
    it("disables Delete on the default team's row and says why", async () => {
      service.getRoutingConfig.mockResolvedValue(ok({ default_team_id: "team_2" }));
      service.listTeams.mockResolvedValue(
        ok([team("team_1", "Platform"), team("team_2", "Payments")]),
      );

      const wrapper = render();
      await flushPromises();

      const blocked = wrapper.findComponent('[data-test="oncall-team-delete-team_2"]');
      expect(blocked.attributes("disabled")).toBeDefined();
      expect(blocked.attributes("focusable-unavailable")).toBeDefined();
      expect(blocked.element.parentElement?.textContent).toContain(
        "Make another team the default first",
      );
      const open = wrapper.find('[data-test="oncall-team-delete-team_1"]');
      expect(open.attributes("disabled")).toBeUndefined();
      await open.trigger("click");
      expect(wrapper.find('[data-test="confirm"]').text()).toContain("Platform");
    });

    it("keeps the default team's Delete focusable and describes it by why it is off", async () => {
      service.getRoutingConfig.mockResolvedValue(ok({ default_team_id: "team_2" }));
      service.listTeams.mockResolvedValue(
        ok([team("team_1", "Platform"), team("team_2", "Payments")]),
      );
      const wrapper = mount(OnCallTeams, {
        global: { plugins: [i18n, store], stubs: { ...stubs, OButton: false } },
      });
      await flushPromises();

      const blocked = wrapper.find('[data-test="oncall-team-delete-team_2"]');
      expect(blocked.attributes("disabled")).toBeUndefined();
      expect(blocked.attributes("aria-disabled")).toBe("true");
      const reason = wrapper.find(`[id="${blocked.attributes("aria-describedby")}"]`);
      expect(reason.text()).toBe("Make another team the default first");
      await blocked.trigger("click");
      expect(wrapper.find('[data-test="confirm"]').exists()).toBe(false);
    });

    it("tells the Edit drawer whether the team is already the default", async () => {
      service.getRoutingConfig.mockResolvedValue(ok({ default_team_id: "team_2" }));
      service.listTeams.mockResolvedValue(
        ok([team("team_1", "Platform"), team("team_2", "Payments")]),
      );
      const wrapper = render();
      await flushPromises();
      const form = () => wrapper.findComponent({ name: "OnCallTeamForm" });

      await wrapper.find('[data-test="oncall-team-edit-team_2"]').trigger("click");
      expect(form().props("offerDefault")).not.toBe(false);
      expect(form().props("isDefault")).toBe(true);
      await wrapper.find('[data-test="oncall-team-edit-team_1"]').trigger("click");
      expect(form().props("isDefault")).toBe(false);
    });

    async function savedAsDefault(wrapper: ReturnType<typeof render>) {
      await wrapper.find('[data-test="oncall-team-edit-team_1"]').trigger("click");
      wrapper.findComponent({ name: "OnCallTeamForm" }).vm.$emit("saved", "team_1", true);
      await flushPromises();
    }

    it("nominates the team when the Edit drawer saves with Default team on", async () => {
      service.listTeams.mockResolvedValue(ok([team("team_1", "Platform")]));
      service.setRoutingConfig.mockResolvedValue(ok({ default_team_id: "team_1" }));
      const wrapper = render();
      await flushPromises();

      await savedAsDefault(wrapper);

      expect(service.setRoutingConfig).toHaveBeenCalledWith({
        org_identifier: "default",
        data: { default_team_id: "team_1" },
      });
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "success", message: "Default team nominated" }),
      );
    });

    /// Mirrors the routing screen's own guard: nominating a team is the one
    /// moment "nobody is on call" is still avoidable.
    it("warns before nominating a team with nobody on it", async () => {
      service.listTeams.mockResolvedValue(ok([team("team_1", "Platform")]));
      service.coverageGaps.mockResolvedValue(ok({ teams: [{ id: "team_1" }], total: 1 }));
      mockConfirm.mockResolvedValue(false);
      const wrapper = render();
      await flushPromises();

      await savedAsDefault(wrapper);

      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: "This team is unstaffed" }),
      );
      // Declined: must not have saved.
      expect(service.setRoutingConfig).not.toHaveBeenCalled();
    });
  });

  /// E9/§G.8.1: the teams list IS the capability probe. This state had no test
  /// and never rendered — it was a second `<template #empty>` on the same slot,
  /// which is a lint error and, at runtime, a branch Vue never reached. A
  /// deployment without on-call was told its org had no teams yet.
  it.each([
    { response: { status: 404 } },
    { response: { status: 403, data: { message: "Not Supported" } } },
  ])("says on-call is not available here rather than showing an empty org (%#)", async (err) => {
    service.listTeams.mockRejectedValueOnce(err);
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-teams-not-available"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-teams-empty"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-teams-error"]').exists()).toBe(false);
  });

  it("shows a license denial as the license state, not an error with retry", async () => {
    service.listTeams.mockRejectedValueOnce({
      response: { status: 403, data: { code: 40001, error_detail: "oncall", message: "denied" } },
    });
    const wrapper = render();
    await flushPromises();

    const table = wrapper.findComponent({ name: "OTable" });
    expect(table.props("forbidden")).toEqual(["oncall"]);
    expect(wrapper.find('[data-test="oncall-teams-error"]').exists()).toBe(false);
  });

  /// B8. A toast evaporates; what stayed on screen was "no teams" — the exact
  /// look of an unconfigured org, on a failed read.
  it("renders a failed load as an error with retry, never as an empty org", async () => {
    service.listTeams.mockRejectedValueOnce({ response: { data: { message: "boom" } } });
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-teams-error"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("boom");

    service.listTeams.mockResolvedValue(ok([]));
    await wrapper.find('[data-test="oncall-teams-error"] button').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-teams-error"]').exists()).toBe(false);
  });

  // The New team drawer's member picker belongs to this page, so the page's refresh must expire it too.
  it("expires the users entry on a refresh, and leaves it alone on mount", async () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const usersExpiry = {
      queryKey: userKeys.users("default"),
      exact: true,
      refetchType: "none",
    };
    service.listTeams.mockRejectedValueOnce({ response: { data: { message: "boom" } } });
    const wrapper = render();
    await flushPromises();
    expect(spy).not.toHaveBeenCalledWith(usersExpiry);

    // Retry and the toolbar's Refresh are the same `refreshTeams` handler.
    service.listTeams.mockResolvedValue(ok([]));
    await wrapper.find('[data-test="oncall-teams-error"] button').trigger("click");
    await flushPromises();
    expect(spy).toHaveBeenCalledWith(usersExpiry);
    spy.mockRestore();
  });
});

describe("OnCallTeams - editor drafts", () => {
  const scopeOf = (
    kind: "oncall_schedule" | "oncall_policy",
    entityId: string,
  ): EditorDraftScope => ({
    kind,
    org: store.state.selectedOrganization.identifier,
    entityId,
    userEmail: store.state.userInfo.email,
  });

  beforeEach(() => {
    localStorage.clear();
    __resetOnCallRoutingConfig();
    resetListViewState();
    vi.clearAllMocks();
    service.whoIsOnCall.mockResolvedValue(ok([]));
    service.getRoutingConfig.mockResolvedValue(ok({ default_team_id: null }));
    service.listTeams.mockResolvedValue(
      ok([team("team_1", "Platform"), team("team_2", "Payments")]),
    );
  });

  it("dots a team whose rotation or escalation policy has an unsaved draft", async () => {
    writeEditorDraft(scopeOf("oncall_schedule", "team_1/rot_a"), { data: {} });
    writeEditorDraft(scopeOf("oncall_policy", "team_2"), { data: {} });
    // The dot sits inside its tooltip's trigger, which the list stub swallows.
    const wrapper = mount(OnCallTeams, {
      global: {
        plugins: [i18n, store],
        stubs: { ...stubs, OTooltip: { name: "OTooltip", template: "<span><slot /></span>" } },
      },
    });
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-teams-team_1-draft-dot"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-teams-team_2-draft-dot"]').exists()).toBe(true);
  });

  it("dots a team by its own rotation drafts, new and duplicated ones included, never by a team whose id it prefixes", async () => {
    service.listTeams.mockResolvedValue(
      ok([team("team_1", "Platform"), team("team_10", "Search"), team("team_2", "Payments")]),
    );
    writeEditorDraft(scopeOf("oncall_schedule", "team_10/rot_a"), { data: {} });
    writeEditorDraft(
      { ...scopeOf("oncall_schedule", "team_2"), entityId: null, variant: "team_2/clone:rot_b" },
      { data: {} },
    );
    const wrapper = mount(OnCallTeams, {
      global: {
        plugins: [i18n, store],
        stubs: { ...stubs, OTooltip: { name: "OTooltip", template: "<span><slot /></span>" } },
      },
    });
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-teams-team_1-draft-dot"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-teams-team_10-draft-dot"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-teams-team_2-draft-dot"]').exists()).toBe(true);

    writeEditorDraft(scopeOf("oncall_policy", "team_1"), { data: {} });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-teams-team_1-draft-dot"]').exists()).toBe(true);
  });

  it("drops a deleted team's policy and rotation drafts, and keeps another team's", async () => {
    const newRotation: EditorDraftScope = {
      ...scopeOf("oncall_schedule", "team_1"),
      entityId: null,
      variant: "team_1/new",
    };
    writeEditorDraft(scopeOf("oncall_schedule", "team_1/rot_a"), { data: {} });
    writeEditorDraft(newRotation, { data: {} });
    const othersNewRotation = { ...newRotation, userEmail: "teammate@x.io" };
    writeEditorDraft(othersNewRotation, { data: {} });
    writeEditorDraft(scopeOf("oncall_schedule", "team_10/rot_a"), { data: {} });
    writeEditorDraft(scopeOf("oncall_policy", "team_1"), { data: {} });
    writeEditorDraft(scopeOf("oncall_policy", "team_2"), { data: {} });
    service.deleteTeam.mockResolvedValue(ok({}));
    const wrapper = render();
    await flushPromises();
    await wrapper.find('[data-test="oncall-team-delete-team_1"]').trigger("click");
    await flushPromises();
    wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
    await flushPromises();

    expect(readEditorDraft(scopeOf("oncall_schedule", "team_1/rot_a"))).toBeNull();
    expect(readEditorDraft(newRotation)).toBeNull();
    expect(readEditorDraft(othersNewRotation)).toBeNull();
    expect(readEditorDraft(scopeOf("oncall_schedule", "team_10/rot_a"))).not.toBeNull();
    expect(readEditorDraft(scopeOf("oncall_policy", "team_1"))).toBeNull();
    expect(readEditorDraft(scopeOf("oncall_policy", "team_2"))).not.toBeNull();
  });

  it("keeps the drafts when the delete fails", async () => {
    writeEditorDraft(scopeOf("oncall_schedule", "team_1/rot_a"), { data: {} });
    service.deleteTeam.mockRejectedValue({ response: { status: 500 } });
    const wrapper = render();
    await flushPromises();
    await wrapper.find('[data-test="oncall-team-delete-team_1"]').trigger("click");
    await flushPromises();
    wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
    await flushPromises();

    expect(readEditorDraft(scopeOf("oncall_schedule", "team_1/rot_a"))).not.toBeNull();
  });
  /// With no team the empty state is already the next step; once one exists the setup bar takes over.
  describe("setup bar and first-run empty state", () => {
    const withBanner = () =>
      mount(OnCallTeams, {
        global: {
          plugins: [i18n, store],
          stubs: {
            ...stubs,
            OnCallSetupBanner: {
              name: "OnCallSetupBanner",
              emits: ["create-team"],
              template: "<div data-test='setup-banner' />",
            },
          },
        },
      });

    it("shows the setup bar over a list that has teams, and lets it open the create form", async () => {
      service.listTeams.mockResolvedValue(ok([team("team_1", "Checkout")]));
      const wrapper = withBanner();
      await flushPromises();

      const banner = wrapper.findComponent({ name: "OnCallSetupBanner" });
      expect(banner.exists()).toBe(true);
      banner.vm.$emit("create-team");
      await flushPromises();
      expect(wrapper.findComponent({ name: "OnCallTeamForm" }).props("open")).toBe(true);
    });

    it("leaves the bar out while the org has no team, and the empty state says no more than its title", async () => {
      service.listTeams.mockResolvedValue(ok([]));
      const wrapper = withBanner();
      await flushPromises();

      expect(wrapper.find('[data-test="setup-banner"]').exists()).toBe(false);
      const empty = wrapper.findComponent('[data-test="oncall-teams-empty"]') as AnyPropsWrapper;
      expect(empty.exists()).toBe(true);
      expect(empty.props("description")).toBeUndefined();
      expect(empty.text()).not.toContain("A team decides who gets woken");
    });
  });
});
