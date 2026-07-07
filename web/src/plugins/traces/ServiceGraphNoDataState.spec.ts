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
  props: ["preset", "size", "hideAction"],
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

    it("passes preset='no-service-graph' to OEmptyState", () => {
      const stub = wrapper.findComponent({ name: "OEmptyState" });
      expect(stub.props("preset")).toBe("no-service-graph");
    });

    it("passes size='hero' to OEmptyState so it matches the other traces empty states", () => {
      const stub = wrapper.findComponent({ name: "OEmptyState" });
      expect(stub.props("size")).toBe("hero");
    });

    it("hides the action when the stream has no data to jump to", () => {
      // No stream selected in the default mount → no jump target → hide-action.
      const stub = wrapper.findComponent({ name: "OEmptyState" });
      // hideAction (camelCase) corresponds to hide-action prop binding
      expect(stub.props("hideAction")).toBe(true);
    });

    it("does not emit widen-range (feature removed)", () => {
      expect(wrapper.emitted("widen-range")).toBeUndefined();
    });
  });
});
