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
  default: { addMembers: vi.fn(), removeMember: vi.fn() },
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

function render(members: OnCallTeamMember[] = []) {
  return mount(OnCallMembers, {
    props: { teamId: "team_1", members },
    global: { plugins: [i18n, store], stubs },
  });
}

function member(email: string): OnCallTeamMember {
  return { id: email, team_id: "team_1", user_email: email };
}

describe("OnCallMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(wrapper.find('[data-test="oncall-members-user-select"]').text()).toContain(
      "cara@o2.ai",
    );
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
    expect(wrapper.find('[data-test="oncall-members-next-step"]').text()).toContain(
      "Schedule",
    );
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
});
