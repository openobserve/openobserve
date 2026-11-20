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

import ServicesCatalogNoDataState from "./ServicesCatalogNoDataState.vue";

// ---------------------------------------------------------------------------
// Stub OEmptyState — captures the props passed to it so tests can assert them.
// ---------------------------------------------------------------------------
const OEmptyStateStub = {
  name: "OEmptyState",
  template: '<div data-test="o-empty-state" />',
  props: ["kind", "size", "title", "text", "actionLabel"],
};

// ---------------------------------------------------------------------------
// Mount factory
// ---------------------------------------------------------------------------
function mountComponent(props: { noTraceStream?: boolean } = {}) {
  return mount(ServicesCatalogNoDataState, {
    props,
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
describe("ServicesCatalogNoDataState", () => {
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

    it("shows the no-services copy as a filtered (time range) state at page size", () => {
      const stub = wrapper.findComponent({ name: "OEmptyState" });
      expect(stub.props("kind")).toBe("filtered");
      expect(String(stub.props("title"))).toBe("No services found");
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

  describe("an org with no trace stream", () => {
    it("keeps the no-services state but drops the wider range and other stream advice", () => {
      wrapper.unmount();
      wrapper = mountComponent({ noTraceStream: true });
      const stub = wrapper.findComponent({ name: "OEmptyState" });
      expect(stub.props("kind")).toBeUndefined();
      expect(stub.props("actionLabel")).toBeUndefined();
      expect(String(stub.props("text"))).toBe(
        "No services were detected in the selected time range.",
      );
    });
  });
});
