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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";

// The component derives its optional "jump to latest data" action from the
// shared useTraces singleton via useJumpToLatestData. With no stream selected
// (default mount) there is no jump target, so it renders the plain empty state.

import ServiceGraphNoDataState from "./ServiceGraphNoDataState.vue";

// ---------------------------------------------------------------------------
// Stub OEmptyState — captures the props passed to it so tests can assert them.
// ---------------------------------------------------------------------------
const OEmptyStateStub = {
  name: "OEmptyState",
  template: '<div data-test="o-empty-state" />',
  props: ["kind", "size", "title", "actionLabel"],
};

// ---------------------------------------------------------------------------
// Mount factory
// ---------------------------------------------------------------------------
function mountComponent() {
  return mount(ServiceGraphNoDataState, {
    global: {
      plugins: [i18n],
      stubs: {
        OEmptyState: OEmptyStateStub,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("ServiceGraphNoDataState", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    wrapper = mountComponent();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("mounts without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the OEmptyState component", () => {
      expect(wrapper.find('[data-test="o-empty-state"]').exists()).toBe(true);
    });

    it("shows the no-service-graph copy as a filtered (time range) state at page size", () => {
      const stub = wrapper.findComponent({ name: "OEmptyState" });
      expect(stub.props("kind")).toBe("filtered");
      expect(String(stub.props("title"))).toBe("No service graph data");
      expect(stub.props("size")).toBeUndefined();
    });

    it("offers no action when the stream has no data to jump to", () => {
      const stub = wrapper.findComponent({ name: "OEmptyState" });
      expect(stub.props("actionLabel")).toBeUndefined();
    });

    it("does not emit widen-range (feature removed)", () => {
      expect(wrapper.emitted("widen-range")).toBeUndefined();
    });
  });
});
