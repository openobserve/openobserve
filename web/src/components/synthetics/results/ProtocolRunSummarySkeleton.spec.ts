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

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

vi.mock("@/lib/feedback/Skeleton/OSkeleton.vue", () => ({
  default: {
    name: "OSkeleton",
    template: '<div data-test="oskeleton">Loading...</div>',
  },
}));

import ProtocolRunSummarySkeleton from "./ProtocolRunSummarySkeleton.vue";

describe("ProtocolRunSummarySkeleton", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  function mountComponent() {
    return mount(ProtocolRunSummarySkeleton);
  }

  it("should render the root status container with correct aria attributes and data-test", () => {
    wrapper = mountComponent();

    const root = wrapper.find('[data-test="synthetics-protocol-run-skeleton"]');
    expect(root.exists()).toBe(true);
    expect(root.attributes("role")).toBe("status");
    expect(root.attributes("aria-label")).toBe("synthetics.protocolRun.loading");
    expect(root.attributes("aria-live")).toBe("polite");
  });

  it("should render exactly 4 grid cells", () => {
    wrapper = mountComponent();

    const grid = wrapper.find(".grid-cols-2");
    expect(grid.exists()).toBe(true);
    expect(grid.element.children.length).toBe(4);
  });

  it("should render the accent-strip header element", () => {
    wrapper = mountComponent();

    const accentStrip = wrapper.find(".bg-accent");
    expect(accentStrip.exists()).toBe(true);
  });
});
