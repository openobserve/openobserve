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
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent } from "vue";

import OnCallPeopleText from "@/components/oncall/OnCallPeopleText.vue";
import OnCallPersonName from "@/components/oncall/OnCallPersonName.vue";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import { orgUsersQuery } from "@/services/users.queries";
import store from "@/test/unit/helpers/store";

/// Renders the tooltip's content slot inline, so its two lines can be read.
const stubs = {
  OTooltip: { name: "OTooltip", template: "<span data-test='tip'><slot name='content' /></span>" },
};

function seedUsers() {
  queryClient.setQueryData(orgUsersQuery("default").queryKey, [
    { email: "bob@oncall.test", first_name: "Bob", last_name: "OnCall" },
  ]);
}

describe("OnCallPersonName", () => {
  afterEach(() => queryClient.clear());

  // Same two lines as an avatar's tooltip: name first, the email that tells namesakes apart under it.
  it("shows the display name with a two-line name and email tooltip", async () => {
    seedUsers();
    const wrapper = mount(OnCallPersonName, {
      props: { email: "bob@oncall.test" },
      global: { plugins: [i18n, store], stubs },
    });
    await flushPromises();

    const lines = wrapper.find('[data-test="oncall-person-name-tooltip"]').findAll(":scope > span");
    expect(lines.map((line) => line.text())).toEqual(["Bob OnCall", "bob@oncall.test"]);
    expect(lines[1].classes()).toContain("text-text-secondary");
  });

  it("says the address once when there is no display name", async () => {
    const wrapper = mount(OnCallPersonName, {
      props: { email: "nobody@o2.ai" },
      global: { plugins: [i18n, store], stubs },
    });
    await flushPromises();

    const lines = wrapper.find('[data-test="oncall-person-name-tooltip"]').findAll(":scope > span");
    expect(lines.map((line) => line.text())).toEqual(["nobody@o2.ai"]);
  });
});

describe("OnCallPeopleText", () => {
  afterEach(() => queryClient.clear());

  it("reads every address in a server sentence as the person's name", async () => {
    seedUsers();
    // Hosted in one element: the component is a fragment, and the sentence is read the way its host shows it.
    const Host = defineComponent({
      components: { OnCallPeopleText },
      template: `<p><OnCallPeopleText text="bob@oncall.test is on the P1 ladder — mail to bob@oncall.test is discarded." /></p>`,
    });
    const wrapper = mount(Host, {
      global: { plugins: [i18n, store], stubs: { OTooltip: { template: "<span />" } } },
    });
    await flushPromises();

    expect(wrapper.text()).toBe(
      "Bob OnCall is on the P1 ladder — mail to Bob OnCall is discarded.",
    );
    const names = wrapper.findAllComponents(OnCallPersonName);
    expect(names.map((name) => name.props("email"))).toEqual([
      "bob@oncall.test",
      "bob@oncall.test",
    ]);
  });
});
