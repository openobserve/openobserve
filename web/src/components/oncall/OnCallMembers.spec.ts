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
  default: { addMember: vi.fn(), removeMember: vi.fn() },
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
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OButton: {
    name: "OButton",
    props: ["disabled"],
    template: `<button :disabled="disabled" @click="$emit('click')"><slot /></button>`,
  },
  OInput: {
    name: "OInput",
    props: ["modelValue"],
    template: `<input :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options"],
    template: `<select :value="modelValue" @change="$emit('update:modelValue', $event.target.value)">
      <option v-for="o in options" :key="String(o.value)" :value="o.value">{{ o.label }}</option>
    </select>`,
  },
};

function render(members: OnCallTeamMember[] = []) {
  return mount(OnCallMembers, {
    props: { teamId: "team_1", members },
    global: { plugins: [i18n, store], stubs },
  });
}

function member(email: string, level: OnCallTeamMember["level"]): OnCallTeamMember {
  return { id: `${email}-${level}`, team_id: "team_1", user_email: email, level };
}

describe("OnCallMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    users.orgUsers.mockResolvedValue({ data: { data: ORG_USERS } } as any);
    oncall.addMember.mockResolvedValue({ data: {} } as any);
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

  // Someone already at this level would be a duplicate the server refuses;
  // hiding them keeps the failure out of the user's way entirely.
  it("hides people already holding the selected level", async () => {
    const wrapper = render([member("ana@o2.ai", "primary")]);
    await flushPromises();

    const picker = wrapper.find('[data-test="oncall-members-user-select"]');
    expect(picker.text()).not.toContain("Ana Sharma");
    expect(picker.text()).toContain("Bob");
  });

  // The same person CAN hold two levels — small teams do this constantly — so
  // they must still be offered for a level they do not hold.
  it("still offers someone who holds a different level", async () => {
    const wrapper = render([member("ana@o2.ai", "secondary")]);
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-members-user-select"]').text()).toContain(
      "Ana Sharma",
    );
  });

  it("sends the selected email to the API", async () => {
    const wrapper = render();
    await flushPromises();

    const picker = wrapper.find('[data-test="oncall-members-user-select"]');
    await picker.setValue("bob@o2.ai");
    await wrapper.find('[data-test="oncall-members-add-btn"]').trigger("click");
    await flushPromises();

    expect(oncall.addMember).toHaveBeenCalledWith(
      expect.objectContaining({
        team_id: "team_1",
        data: { user_email: "bob@o2.ai", level: "primary" },
      }),
    );
  });

  it("cannot submit with nobody selected", async () => {
    const wrapper = render();
    await flushPromises();
    expect(
      wrapper.find('[data-test="oncall-members-add-btn"]').attributes("disabled"),
    ).toBeDefined();
  });
});
