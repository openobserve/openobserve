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

import OnCallMembers from "@/components/oncall/OnCallMembers.vue";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import usersService from "@/services/users";
import store from "@/test/unit/helpers/store";
import type { OnCallTeamMember } from "@/ts/interfaces/oncall";

vi.mock("@/services/oncall", () => ({
  default: {
    addMembers: vi.fn(),
    setSchedule: vi.fn(),
    removeMember: vi.fn(),
    listUnavailability: vi.fn(),
    createUnavailability: vi.fn(),
    deleteUnavailability: vi.fn(),
    resolvedSchedule: vi.fn(),
  },
}));
vi.mock("@/services/users", () => ({ default: { orgUsers: vi.fn() } }));

const users = vi.mocked(usersService);
const oncall = vi.mocked(oncallService);

const ORG_USERS = [
  { email: "ana@o2.ai", first_name: "Ana", last_name: "Sharma" },
  { email: "bob@o2.ai", first_name: "Bob", last_name: "" },
  { email: "cara@o2.ai" },
];

const stubs = {
  // Renders the real cell slots, so the tests exercise what the page draws.
  OTable: {
    name: "OTable",
    props: ["data", "columns"],
    template: `<div>
      <slot name='toolbar' />
      <div v-for="(row, i) in (data || [])" :key="i" data-test="row">
        <slot v-for="c in (columns || [])" :key="c.id" :name="'cell-' + c.id" :row="row" />
      </div>
      <slot name='empty' />
    </div>`,
  },
  OEmptyState: { name: "OEmptyState", props: ["description"], template: "<div />" },
  // `open`, not `modelValue` — ODialog has no `modelValue`, and a stub that
  // invents one lets a dialog that can never open test green.
  ODialog: {
    name: "ODialog",
    props: ["open"],
    template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  },
  OUserCell: { name: "OUserCell", props: ["value"], template: "<span>{{ value }}</span>" },
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OButton: {
    name: "OButton",
    props: ["disabled"],
    // No `@click="$emit('click')"`: the parent's handler already falls through
    // to the native button, and re-emitting fires it twice.
    template: `<button :disabled="disabled"><slot /></button>`,
  },
  OInput: {
    name: "OInput",
    props: ["modelValue"],
    template: `<input :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
  // `multiple` mode emits an ARRAY, so the stub mirrors that rather than a
  // scalar — a scalar stub would let a broken payload shape pass.
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options", "multiple"],
    template: `<select multiple @change="$emit('update:modelValue', pick($event))">
      <option v-for="o in options" :key="String(o.value)" :value="o.value">{{ o.label }}</option>
    </select>`,
    methods: {
      pick(e: any) {
        return Array.from(e.target.selectedOptions).map((o: any) => o.value);
      },
    },
  },
};

interface RenderOpts {
  members?: OnCallTeamMember[];
  rotations?: any[];
  onCallNow?: any[];
  reachability?: any;
  load?: any;
}

function render(arg: OnCallTeamMember[] | RenderOpts = []) {
  const opts: RenderOpts = Array.isArray(arg) ? { members: arg } : arg;
  return mount(OnCallMembers, {
    props: {
      teamId: "team_1",
      members: opts.members ?? [],
      rotations: opts.rotations ?? [],
      timezone: "UTC",
      onCallNow: opts.onCallNow ?? [],
      reachability: opts.reachability ?? null,
      load: opts.load ?? null,
    },
    global: { plugins: [i18n, store], stubs },
  });
}

function member(email: string): OnCallTeamMember {
  return { id: email, team_id: "team_1", user_email: email };
}

describe("OnCallMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    oncall.listUnavailability.mockResolvedValue({ data: [] } as any);
    oncall.resolvedSchedule.mockResolvedValue({ data: [] } as any);
    users.orgUsers.mockResolvedValue({ data: { data: ORG_USERS } } as any);
    oncall.addMembers.mockResolvedValue({ data: [] } as any);
  });

  // Typing an email means a typo silently creates a member nobody can log in
  // as, and the page goes nowhere.
  it("offers the org's users instead of a free-text email", async () => {
    const wrapper = render();
    await flushPromises();

    const picker = wrapper.find('[data-test="oncall-members-user-select"]');
    expect(picker.exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-members-email-input"]').exists()).toBe(false);
    expect(picker.text()).toContain("Ana Sharma (ana@o2.ai)");
  });

  // A name is what a person recognises; the email disambiguates. A user with
  // neither name field still has to be selectable.
  it("falls back to the bare email when a user has no name", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-members-user-select"]').text()).toContain("cara@o2.ai");
  });

  // Losing the picker must not lose the ability to add anybody.
  it("degrades to a free-text field when the user list cannot be loaded", async () => {
    users.orgUsers.mockRejectedValue(new Error("boom"));
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-members-user-select"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-members-email-input"]').exists()).toBe(true);
  });

  // Already on the team means nothing left to add.
  it("hides people already on the team", async () => {
    const wrapper = render([member("ana@o2.ai")]);
    await flushPromises();

    const picker = wrapper.find('[data-test="oncall-members-user-select"]');
    expect(picker.text()).not.toContain("Ana Sharma");
    expect(picker.text()).toContain("Bob");
  });

  // The whole point of the change: adding six people is one action, not six.
  it("adds several people in a single request", async () => {
    const wrapper = render();
    await flushPromises();

    const picker = wrapper.find('[data-test="oncall-members-user-select"]');
    const options = picker.findAll("option");
    options[0].element.selected = true;
    options[1].element.selected = true;
    await picker.trigger("change");
    await wrapper.find('[data-test="oncall-members-add-btn"]').trigger("click");
    await flushPromises();

    expect(oncall.addMembers).toHaveBeenCalledTimes(1);
    expect(oncall.addMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        team_id: "team_1",
        data: { user_emails: ["ana@o2.ai", "bob@o2.ai"] },
      }),
    );
  });

  // Membership answers "who is on the team". Which rung they cover is a
  // property of the rotation, so no level is chosen here.
  it("asks for no level", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-members-level-select"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-members-next-step"]').text()).toContain("Schedule");
  });

  it("cannot submit with nobody selected", async () => {
    const wrapper = render();
    await flushPromises();
    expect(
      wrapper.find('[data-test="oncall-members-add-btn"]').attributes("disabled"),
    ).toBeDefined();
  });

  // A pasted list is the realistic fallback input, so it must not require
  // one-per-line discipline.
  it("splits a pasted list when the picker is unavailable", async () => {
    users.orgUsers.mockRejectedValue(new Error("boom"));
    const wrapper = render();
    await flushPromises();

    await wrapper
      .find('[data-test="oncall-members-email-input"]')
      .setValue("ana@o2.ai, bob@o2.ai;cara@o2.ai");
    await wrapper.find('[data-test="oncall-members-add-btn"]').trigger("click");
    await flushPromises();

    expect(oncall.addMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { user_emails: ["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"] },
      }),
    );
  });

  /// The single-team org is the usual starting point, and picking the same
  /// eight people one at a time was the whole of its setup.
  it("adds every org user who is not already on the team", async () => {
    const wrapper = render([member("ana@o2.ai")]);
    await flushPromises();

    const btn = wrapper.find('[data-test="oncall-members-add-everyone"]');
    expect(btn.text()).toContain("2");

    await btn.trigger("click");
    await flushPromises();

    expect(oncall.addMembers).toHaveBeenCalledWith(
      expect.objectContaining({ data: { user_emails: ["bob@o2.ai", "cara@o2.ai"] } }),
    );
  });

  // Nothing left to add is not a disabled button, it is no button.
  it("hides the button once everybody is on the team", async () => {
    const wrapper = render([member("ana@o2.ai"), member("bob@o2.ai"), member("cara@o2.ai")]);
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-members-add-everyone"]').exists()).toBe(false);
  });
  /// C5/C6: the rota already SKIPS an away member; the table says so where
  /// the people are listed, before somebody asks why the order changed.
  describe("absences", () => {
    const member = { id: "m1", team_id: "team_1", user_email: "ana@o2.ai" };

    it("chips a member whose absence overlaps the window", async () => {
      const now = Date.now() * 1000;
      oncall.listUnavailability.mockResolvedValue({
        data: [
          {
            id: "u1",
            org_id: "default",
            user_email: "ana@o2.ai",
            start_at: now - 1,
            end_at: now + 86_400_000_000,
            created_by: "ana@o2.ai",
            created_at: now,
          },
        ],
      } as any);
      const wrapper = render([member]);
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-members-away-m1"]').exists()).toBe(true);
    });

    it("records an absence for the chosen person and tells the schedule", async () => {
      oncall.createUnavailability.mockResolvedValue({ data: {} } as any);
      const wrapper = render([member]);
      await flushPromises();

      await wrapper.find('[data-test="oncall-members-mark-away-m1"]').trigger("click");
      await wrapper.find('[data-test="oncall-members-away-from"]').setValue("2026-09-01T09:00");
      await wrapper.find('[data-test="oncall-members-away-to"]').setValue("2026-09-08T09:00");
      await wrapper.find('[data-test="oncall-members-away-save"]').trigger("click");
      await flushPromises();

      expect(oncall.createUnavailability).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_email: "ana@o2.ai" }),
        }),
      );
      // The rota moves the away person's turn — the schedule tab's answer
      // changed with it.
      expect(wrapper.emitted("changed")).toBeTruthy();
    });
  });

  /// The roster answers three questions per person. Each is a column fed by a
  /// different endpoint, and a missing endpoint must cost only its own column.
  describe("the roster columns", () => {
    const ana = member("ana@o2.ai");
    const bob = member("bob@o2.ai");

    it("badges the person actually holding the pager", async () => {
      const wrapper = render({
        members: [ana, bob],
        onCallNow: [{ rotation: "Primary", user_email: "ana@o2.ai", next_user_email: "bob@o2.ai" }],
      });
      await flushPromises();

      const rows = wrapper.findAll('[data-test="row"]');
      // On call first, next up second — the tab's first question is who is
      // holding it, not whose name starts with A.
      expect(rows[0].text()).toContain("On call now");
      expect(rows[1].text()).toContain("Next up");
    });

    it("draws a chip per channel the server evaluated", async () => {
      const wrapper = render({
        members: [ana],
        reachability: {
          team_id: "team_1",
          team_name: "T",
          smtp_configured: true,
          reachable: 1,
          total: 1,
          unreachable_members: [],
          members: [
            {
              user_email: "ana@o2.ai",
              is_org_user: true,
              mailbox_shaped: true,
              deliverable_channels: ["email"],
              configured_but_unverified: [],
              would_a_page_land: true,
              channels: [
                { channel: "email", deliverable: true, configured_but_unverified: false },
                { channel: "sms", deliverable: false, configured_but_unverified: true },
              ],
            },
          ],
        },
      });
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-channel-ana@o2.ai-email"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-channel-ana@o2.ai-sms"]').exists()).toBe(true);
    });

    /// Somebody on the team that no page can reach is a paging outage nobody
    /// gets told about, so it is said once, in the server's own words.
    it("warns about a member no page can reach", async () => {
      const wrapper = render({
        members: [ana],
        reachability: {
          team_id: "team_1",
          team_name: "T",
          smtp_configured: true,
          reachable: 0,
          total: 1,
          unreachable_members: ["ana@o2.ai"],
          members: [
            {
              user_email: "ana@o2.ai",
              is_org_user: true,
              mailbox_shaped: false,
              deliverable_channels: [],
              configured_but_unverified: [],
              would_a_page_land: false,
              why_not: "root@example is not a mailbox",
              channels: [],
            },
          ],
        },
      });
      await flushPromises();

      const banner = wrapper.find('[data-test="oncall-members-unreachable-banner"]');
      expect(banner.exists()).toBe(true);
      expect(banner.text()).toContain("root@example is not a mailbox");
    });

    /// One `false` on the deployment explains every unreachable row, so the
    /// per-person warning must give way to it rather than repeat it.
    it("blames the deployment, not the people, when no transport exists", async () => {
      const wrapper = render({
        members: [ana],
        reachability: {
          team_id: "team_1",
          team_name: "T",
          smtp_configured: false,
          reachable: 0,
          total: 1,
          unreachable_members: ["ana@o2.ai"],
          members: [
            {
              user_email: "ana@o2.ai",
              is_org_user: true,
              mailbox_shaped: true,
              deliverable_channels: [],
              configured_but_unverified: [],
              would_a_page_land: false,
              channels: [],
            },
          ],
        },
      });
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-members-no-transport"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-members-unreachable-banner"]').exists()).toBe(false);
    });

    /// The load verdict sits next to the only control that changes it.
    it("calls out a lopsided pager share and points at the schedule", async () => {
      const wrapper = render({
        members: [ana, bob],
        load: {
          team_id: "team_1",
          from: 0,
          to: 0,
          days: 30,
          upcoming_from: 0,
          upcoming_to: 0,
          rotations: [],
          members: [
            { user_email: "ana@o2.ai", pages: 12, nights: 4, acks: 12 },
            { user_email: "bob@o2.ai", pages: 2, nights: 0, acks: 2 },
          ],
        },
      });
      await flushPromises();

      const load = wrapper.find('[data-test="oncall-members-load"]');
      expect(load.text()).toContain("Load is uneven");
      await wrapper.find('[data-test="oncall-members-rebalance"]').trigger("click");
      expect(wrapper.emitted("open-schedule")).toBeTruthy();
    });

    /// An even split is not a finding. Colouring it teaches people to ignore
    /// the line that matters.
    it("says nothing when the split is even", async () => {
      const wrapper = render({
        members: [ana, bob],
        load: {
          team_id: "team_1",
          from: 0,
          to: 0,
          days: 30,
          upcoming_from: 0,
          upcoming_to: 0,
          rotations: [],
          members: [
            { user_email: "ana@o2.ai", pages: 5, nights: 1, acks: 5 },
            { user_email: "bob@o2.ai", pages: 5, nights: 1, acks: 5 },
          ],
        },
      });
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-members-load"]').exists()).toBe(false);
    });

    /// A failed schedule fetch must cost the shift column, not the table.
    it("still names the rotation when the schedule cannot be resolved", async () => {
      oncall.resolvedSchedule.mockRejectedValue(new Error("boom"));
      const wrapper = render({
        members: [ana],
        rotations: [
          {
            id: "rot_primary",
            name: "Primary",
            shift_rules: [
              {
                name: "Primary",
                members: ["ana@o2.ai"],
                shift_micros: 604_800_000_000,
                anchor_micros: 0,
              },
            ],
          },
        ],
      });
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-members-shift-ana@o2.ai"]').text()).toContain(
        "In the rotation",
      );
    });
  });
});
