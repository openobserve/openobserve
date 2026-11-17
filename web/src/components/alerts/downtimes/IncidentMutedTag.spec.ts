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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { raw } from "@/types/i18n";
import IncidentMutedTag from "./IncidentMutedTag.vue";

const router = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/downtimes/:id", name: "downtimeDetail", component: { template: "<div />" } },
    ],
  });

const props = { label: raw("Muted by INC-231"), tooltip: raw("Muted by INC-231") };

describe("IncidentMutedTag", () => {
  it("links to the downtime in its folder when the lookup has the row", () => {
    const to = {
      name: "downtimeDetail",
      params: { id: "d1" },
      query: { org_identifier: "acme", folder: "ops" },
    };
    const wrapper = mount(IncidentMutedTag, {
      props: { ...props, to },
      global: { plugins: [router()] },
    });
    const link = wrapper.get('[data-test="incident-list-muted-link"]');
    expect(link.attributes("href")).toBe("/downtimes/d1?org_identifier=acme&folder=ops");
    expect(link.text()).toContain("Muted by INC-231");
    wrapper.unmount();
  });

  it("stays a plain tag when the lookup has no row", () => {
    const wrapper = mount(IncidentMutedTag, {
      props: { ...props, to: null },
      global: { plugins: [router()] },
    });
    expect(wrapper.find('[data-test="incident-list-muted-link"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="incident-list-muted"]').text()).toContain("Muted by INC-231");
    wrapper.unmount();
  });
});
