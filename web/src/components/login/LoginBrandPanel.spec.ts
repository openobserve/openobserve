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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createStore } from "vuex";
import LoginBrandPanel from "@/components/login/LoginBrandPanel.vue";
import i18n from "@/locales";

describe("LoginBrandPanel", () => {
  const mountPanel = () =>
    mount(LoginBrandPanel, {
      global: { plugins: [i18n, createStore({ state: { theme: "light" } })] },
    });

  it("lists the four product points with their interpolated names", () => {
    const panel = mountPanel();
    const features = panel.findAll('[data-test^="login-brand-feature-"]');
    expect(features).toHaveLength(4);
    expect(panel.text()).toContain("140× lower storage cost");
    expect(panel.text()).toContain("Elasticsearch");
    expect(panel.text()).toContain("Built for OpenTelemetry");
  });

  it("links out to the product site in a new tab", () => {
    const link = mountPanel().find('[data-test="login-brand-site-link"]');
    expect(link.attributes("href")).toBe("https://openobserve.ai/");
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toContain("noopener");
    expect(link.text()).toBe("Learn more at openobserve.ai");
  });
});
