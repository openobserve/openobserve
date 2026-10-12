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

// Card content is asserted on the builder (setupCard/content/nvidiaDcgm.spec.ts); this
// only proves the page resolves the DCGM slug and renders the exporter switch.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import GpuConfig from "./GpuConfig.vue";

const cardStub = {
  name: "DataSourceSetupCard",
  props: ["slug"],
  template: '<div data-test="card-stub"><slot name="hero-under-title" /></div>',
};

describe("GpuConfig", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => wrapper?.unmount());

  const mountPage = () =>
    mount(GpuConfig, {
      global: { plugins: [i18n], stubs: { DataSourceSetupCard: cardStub } },
    });

  it("renders the DCGM Exporter card by default", () => {
    wrapper = mountPage();
    expect(wrapper.findComponent({ name: "DataSourceSetupCard" }).props("slug")).toBe("nvidiaDcgm");
  });

  it("shows the exporter switch under the card title with DCGM selected", () => {
    wrapper = mountPage();
    expect(wrapper.find('[data-test="gpu-setup-exporter-group"]').exists()).toBe(true);
    const item = wrapper.find('[data-test="gpu-setup-exporter-dcgm"]');
    expect(item.exists()).toBe(true);
    expect(item.text()).toContain("DCGM Exporter");
    expect(item.attributes("data-state")).toBe("on");
  });
});
