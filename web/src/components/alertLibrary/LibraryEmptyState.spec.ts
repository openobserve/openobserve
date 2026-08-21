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

import LibraryEmptyState from "./LibraryEmptyState.vue";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

const mountBanner = (props: Record<string, unknown> = {}) =>
  mount(LibraryEmptyState, {
    props: { label: raw("Kafka"), count: 86, ...props },
    global: { plugins: [i18n] },
  });

describe("LibraryEmptyState", () => {
  it("names the telemetry to send and the number of alerts that cannot run", () => {
    const text = mountBanner().text();
    expect(text).toContain("86");
    expect(text).toContain("Kafka");
  });

  it("stays neutral — an unusable alert is inert, not urgent", () => {
    // A saturated error/warning banner would make the calm case shout.
    const banner = mountBanner().find('[data-test="alert-library-empty-state"]');
    expect(banner.exists()).toBe(true);
    expect(banner.classes().join(" ")).not.toMatch(/banner-(error|warning)/);
  });

  it("offers the ingestion guide as the way out", () => {
    const cta = mountBanner().find('[data-test="alert-library-empty-state-action"]');
    expect(cta.exists()).toBe(true);
    expect(cta.text()).toContain("Ingestion guide");
  });

  it("emits action rather than navigating itself", async () => {
    const wrapper = mountBanner();
    await wrapper.find('[data-test="alert-library-empty-state-action"]').trigger("click");
    expect(wrapper.emitted("action")).toHaveLength(1);
  });
});
