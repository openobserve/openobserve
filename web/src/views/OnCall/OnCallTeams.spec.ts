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
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import OnCallTeams from "@/views/OnCall/OnCallTeams.vue";

vi.mock("@/services/oncall", () => ({
  default: {
    listTeams: vi.fn(),
    whoIsOnCall: vi.fn(),
    deleteTeam: vi.fn(),
    testPage: vi.fn(),
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

const service = vi.mocked(oncallService);

const stubs = {
  OPageLayout: { name: "OPageLayout", template: "<div><slot name='actions' /><slot /></div>" },
  // Renders the real cell slots, so the tests exercise what the page actually
  // draws rather than a column-def function OTable never calls.
  OTable: {
    name: "OTable",
    props: ["data", "columns", "error"],
    template: `<div>
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
  OSearchInput: { name: "OSearchInput", template: "<input />" },
  // `props` declared deliberately: a stub that does not declare what it is
  // passed drops it silently, and an assertion about a tooltip then passes
  // with no tooltip mounted.
  OTooltip: { name: "OTooltip", props: ["content"], template: "<span>{{ content }}</span>" },
  OTag: { name: "OTag", props: ["variant", "type", "value"], template: "<span><slot /></span>" },
  OUserCell: { name: "OUserCell", props: ["value"], template: "<span>{{ value }}</span>" },
  OnCallTeamForm: { name: "OnCallTeamForm", props: ["open", "team"], template: "<div />" },
  ConfirmDialog: {
    name: "ConfirmDialog",
    props: ["modelValue", "message"],
    emits: ["update:ok", "update:cancel"],
    template: "<div v-if='modelValue' data-test='confirm'>{{ message }}</div>",
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
function onCallCell(wrapper: any, _row?: unknown) {
  return wrapper.find('[data-test="row"]');
}

describe("OnCallTeams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    service.whoIsOnCall.mockResolvedValue({ data: [] } as any);
  });

  /// The setup checklist's first step sends somebody here already meaning to
  /// create a team. Landing them on the list to hunt for the button is the same
  /// click asked twice.
  describe("arriving with the intent to create", () => {
    it("opens the form straight away on ?action=add", async () => {
      service.listTeams.mockResolvedValue({ data: [] } as any);
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
      service.listTeams.mockResolvedValue({ data: [] } as any);
      routeQuery.action = "add";
      routeQuery.org_identifier = "default";
      mount(OnCallTeams, { global: { plugins: [i18n, store], stubs } });
      await flushPromises();

      expect(replace).toHaveBeenCalledWith(
        expect.objectContaining({ query: { org_identifier: "default" } }),
      );
    });

    it("leaves the form closed without it", async () => {
      service.listTeams.mockResolvedValue({ data: [] } as any);
      const wrapper = mount(OnCallTeams, { global: { plugins: [i18n, store], stubs } });
      await flushPromises();

      expect(wrapper.findComponent({ name: "OnCallTeamForm" }).props("open")).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });
  });

  it("shows who is on call for each team", async () => {
    service.listTeams.mockResolvedValue({ data: [team("team_1", "Platform")] } as any);
    service.whoIsOnCall.mockResolvedValue({
      data: [{ level: "primary", user_email: "engineer@example.com" }],
    } as any);

    const wrapper = render();
    await flushPromises();

    expect(onCallCell(wrapper).findComponent({ name: "OUserCell" }).props("value")).toBe(
      "engineer@example.com",
    );
  });

  /// A team nobody staffs will page no one, so it earns the one colour on this
  /// page rather than an empty cell.
  it("flags a team with nobody on call", async () => {
    service.listTeams.mockResolvedValue({ data: [team("team_1", "Platform")] } as any);
    service.whoIsOnCall.mockResolvedValue({ data: [] } as any);

    const wrapper = render();
    await flushPromises();

    const cell = onCallCell(wrapper);
    expect(cell.findComponent({ name: "OTag" }).props("value")).toBe("gap");
  });

  /// The gap that used to hide: a team whose secondary is staffed but whose
  /// primary is empty filled the single shared cell and read as covered.
  it("flags a missing primary even when the secondary is staffed", async () => {
    service.listTeams.mockResolvedValue({ data: [team("team_1", "Platform")] } as any);
    service.whoIsOnCall.mockResolvedValue({
      data: [{ slot: "secondary", rotation: "r1", user_email: "backup@example.com" }],
    } as any);

    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-teams-primary-gap-team_1"]').exists()).toBe(true);
    expect(onCallCell(wrapper).findComponent({ name: "OUserCell" }).props("value")).toBe(
      "backup@example.com",
    );
  });

  /// `slot` is an open vocabulary, so two fixed columns must not silently drop
  /// the third pool a team declared.
  it("keeps a pool neither column is named after", async () => {
    service.listTeams.mockResolvedValue({ data: [team("team_1", "Platform")] } as any);
    service.whoIsOnCall.mockResolvedValue({
      data: [
        { slot: "primary", rotation: "r1", user_email: "primary@example.com" },
        { slot: "db-oncall", rotation: "r2", user_email: "dba@example.com" },
      ],
    } as any);

    const wrapper = render();
    await flushPromises();

    const emails = wrapper
      .findAllComponents({ name: "OUserCell" })
      .map((cell: any) => cell.props("value"));
    expect(emails).toEqual(["primary@example.com", "dba@example.com"]);
    // The pool keeps its own name rather than being filed under "Secondary".
    expect(wrapper.find('[data-test="oncall-teams-slot-team_1-db-oncall"]').exists()).toBe(true);
  });

  /// "We could not load it" and "nobody is on call" are different claims, and
  /// showing the second for the first sends someone chasing a phantom gap.
  it("does not call a failed lookup a coverage gap", async () => {
    service.listTeams.mockResolvedValue({ data: [team("team_1", "Platform")] } as any);
    service.whoIsOnCall.mockRejectedValue(new Error("boom"));

    const wrapper = render();
    await flushPromises();

    // Undefined means "not loaded", which must not render as a coverage gap.
    expect(onCallCell(wrapper).findComponent({ name: "OTag" }).exists()).toBe(false);
  });

  it("looks up every team", async () => {
    service.listTeams.mockResolvedValue({
      data: [team("team_1", "Platform"), team("team_2", "Payments")],
    } as any);

    render();
    await flushPromises();

    expect(service.whoIsOnCall).toHaveBeenCalledTimes(2);
  });

  it("opens a team on row click", async () => {
    service.listTeams.mockResolvedValue({ data: [team("team_1", "Platform")] } as any);
    const wrapper = render();
    await flushPromises();

    wrapper.findComponent({ name: "OTable" }).vm.$emit("row-click", team("team_1", "Platform"));
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "onCallTeamDetail" }));
  });

  /// Named in review: every mistake was permanent, because the delete endpoint
  /// and its service method both existed and nothing called them.
  describe("deleting a team", () => {
    async function open() {
      service.listTeams.mockResolvedValue({ data: [team("team_1", "Platform")] } as any);
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
      expect(confirm.text()).toContain("Platform");
      expect(confirm.text()).toContain("page nobody");
      expect(service.deleteTeam).not.toHaveBeenCalled();
    });

    it("deletes on confirm and reloads", async () => {
      service.deleteTeam.mockResolvedValue({ data: {} } as any);
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
      service.listTeams.mockResolvedValue({ data: [team("team_1", "Platform")] } as any);
      const wrapper = render();
      await flushPromises();
      return wrapper;
    }

    it("offers edit and a test page beside delete", async () => {
      const wrapper = await rendered();
      expect(wrapper.find('[data-test="oncall-team-edit-team_1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-team-test-page-team_1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-team-delete-team_1"]').exists()).toBe(true);
    });

    /// Three icons and no words: without a name each, the row offers a
    /// destructive action and two glyphs the reader has to guess at. The
    /// tooltip is the sighted reader's name and `aria-label` the other's, so
    /// both are asserted — and both must SAY something, not merely exist.
    it("names every icon-only action, on hover and to a screen reader", async () => {
      const wrapper = await rendered();
      for (const [id, name] of [
        ["edit", "Edit team"],
        ["test-page", "Send test page"],
        ["delete", "Delete team"],
      ] as const) {
        const button = wrapper.find(`[data-test="oncall-team-${id}-team_1"]`);
        expect(button.attributes("aria-label")).toBe(name);
        expect(button.text()).toContain(name);
      }
    });

    /// The destructive one last, so the mouse does not pass over it on the way
    /// to either safe action.
    it("puts the irreversible action last", async () => {
      const html = (await rendered()).html();
      expect(html.indexOf("oncall-team-edit-team_1")).toBeLessThan(
        html.indexOf("oncall-team-test-page-team_1"),
      );
      expect(html.indexOf("oncall-team-test-page-team_1")).toBeLessThan(
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

    /// G6: "would a page actually land" cost a drill-in to ask. `test-page`
    /// runs the real transports and writes no record, so a list may offer it.
    ///
    /// The count comes from `attempts`. Reading a `recipients` field the wire
    /// has never had made every delivered page report "Nothing was sent".
    it("sends a real test page from the row and says who it reached", async () => {
      service.testPage.mockResolvedValue({
        data: {
          reached_anyone: true,
          channels: ["email"],
          attempts: [
            {
              channel: "email",
              recipient: "engineer@example.com",
              reason: "on call now",
              delivered: true,
            },
          ],
        },
      } as any);
      const wrapper = await rendered();

      await wrapper.find('[data-test="oncall-team-test-page-team_1"]').trigger("click");
      await flushPromises();

      expect(service.testPage).toHaveBeenCalledWith(expect.objectContaining({ team_id: "team_1" }));
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "success", message: expect.stringContaining("1") }),
      );
      expect(push).not.toHaveBeenCalled();
    });

    /// The server's own reason for reaching nobody is the answer; re-wording it
    /// in the UI is how the two screens start disagreeing about the same team.
    it("reports reaching nobody without calling it a failure", async () => {
      service.testPage.mockResolvedValue({
        data: {
          reached_anyone: false,
          channels: [],
          attempts: [],
          not_sent_because: "no transport configured",
        },
      } as any);
      const wrapper = await rendered();

      await wrapper.find('[data-test="oncall-team-test-page-team_1"]').trigger("click");
      await flushPromises();

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "warning",
          message: expect.stringContaining("no transport configured"),
        }),
      );
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

  /// B8. A toast evaporates; what stayed on screen was "no teams" — the exact
  /// look of an unconfigured org, on a failed read.
  it("renders a failed load as an error with retry, never as an empty org", async () => {
    service.listTeams.mockRejectedValueOnce({ response: { data: { message: "boom" } } });
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-teams-error"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("boom");

    service.listTeams.mockResolvedValue({ data: [] } as any);
    await wrapper.find('[data-test="oncall-teams-error"] button').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-teams-error"]').exists()).toBe(false);
  });

  /// On-Call owns one rail entry, so a sub-page with no Back is a dead end.
  /// Mounted through the REAL page layout: the button lives in OPageHeader, and
  /// a stubbed layout would report success while nothing rendered.
  it("offers a way back to the On-Call pages it was opened from", async () => {
    const { OPageLayout: _stubbedLayout, ...realLayout } = stubs;
    const wrapper = mount(OnCallTeams, {
      global: { plugins: [i18n, store], stubs: realLayout },
    });
    await flushPromises();

    const back = wrapper.find('[data-test="oncall-teams-back-btn"]');
    expect(back.exists()).toBe(true);
    await back.trigger("click");

    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "onCallResponses" }));
  });
});
