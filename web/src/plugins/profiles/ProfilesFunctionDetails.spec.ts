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

import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/locales";
import ProfilesFunctionDetails from "./ProfilesFunctionDetails.vue";
import { formatPercent } from "./format";

enableAutoUnmount(afterEach);

const mountDetails = (name: string) =>
  mount(ProfilesFunctionDetails, {
    props: {
      name,
      self: 1,
      total: 3,
      grandTotal: 7,
      callPaths: 1,
      coverage: "",
      folded: false,
      callers: { name, total: 3, self: 0, children: [{ name: "main", total: 3, self: 0 }] },
      callees: null,
      valueFormatter: (value: number) => `${value} ns`,
    },
    global: {
      plugins: [i18n],
      stubs: { OButton: true, OTooltip: true },
    },
  });

describe("ProfilesFunctionDetails", () => {
  it("hides the Package row when the name has no package separator", () => {
    const wrapper = mountDetails("handle_order");
    expect(wrapper.find('[data-test="profiles-function-details-package"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Package");
  });

  it("shows the package when the name has one", () => {
    const wrapper = mountDetails("crypto/sha256.(*Digest).Sum");
    expect(wrapper.get('[data-test="profiles-function-details-package"]').text()).toBe(
      "crypto/sha256",
    );
  });

  it("formats shares with the same two decimals as the page's tables", () => {
    const wrapper = mountDetails("handle_order");
    expect(wrapper.get('[data-test="profiles-function-details-self"]').text()).toBe(
      `1 ns · ${formatPercent(1, 7)}`,
    );
    expect(formatPercent(1, 7)).toBe("14.29%");
    expect(wrapper.get('[data-test="profiles-function-details-called-by"]').text()).toContain(
      "100.00%",
    );
  });
});
