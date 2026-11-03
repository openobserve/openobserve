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

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import OPageLayout from "./OPageLayout.vue";

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));

const i18n = createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false });

const mountLayout = () =>
  mount(OPageLayout, {
    props: { title: "Page" },
    slots: { default: '<div data-test="page-body-content" />' },
    global: { plugins: [i18n] },
  });

describe("OPageLayout entrance", () => {
  it("slides the body in while the header stays still", () => {
    const wrapper = mountLayout();
    const body = wrapper.find('[data-test="page-body-content"]').element.parentElement!;

    expect(body.className).toContain("motion-safe:slide-in-from-bottom-1");
    expect(wrapper.find("header, [data-test*='header']").classes()).not.toContain(
      "motion-safe:slide-in-from-bottom-1",
    );
  });
});
