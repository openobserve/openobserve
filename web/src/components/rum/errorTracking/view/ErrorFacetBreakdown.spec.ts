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

import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import ErrorFacetBreakdown from "@/components/rum/errorTracking/view/ErrorFacetBreakdown.vue";
import type { FacetKey, FacetValue } from "@/utils/rum/errorDetailQueries";
import i18n from "@/locales";

const emptyFacets = (): Record<FacetKey, FacetValue[]> => ({
  browser: [],
  os: [],
  release: [],
  page: [],
});

const facetsWith = (overrides: Partial<Record<FacetKey, FacetValue[]>>) => ({
  ...emptyFacets(),
  ...overrides,
});

describe("ErrorFacetBreakdown", () => {
  let wrapper: VueWrapper<any>;

  const mountComponent = (props: Record<string, unknown> = {}) =>
    mount(ErrorFacetBreakdown, {
      props: { facets: emptyFacets(), ...props },
      global: { plugins: [i18n] },
    });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("lists each value in a populated facet", () => {
      wrapper = mountComponent({
        facets: facetsWith({
          browser: [
            { value: "Chrome", events: 8, share: 0.8 },
            { value: "Safari", events: 2, share: 0.2 },
          ],
        }),
      });

      const values = wrapper
        .findAll('[data-test="rum-error-facet-browser-value"]')
        .map((node) => node.text());
      expect(values).toEqual(["Chrome", "Safari"]);
    });

    it("shows each value's share as a whole percentage", () => {
      wrapper = mountComponent({
        facets: facetsWith({
          release: [
            { value: "2.4.1", events: 7, share: 0.666 },
            { value: "2.4.0", events: 3, share: 0.334 },
          ],
        }),
      });

      const shares = wrapper
        .findAll('[data-test="rum-error-facet-release-share"]')
        .map((node) => node.text());
      expect(shares).toEqual(["67%", "33%"]);
    });

    it("omits facets that have no values", () => {
      wrapper = mountComponent({
        facets: facetsWith({ os: [{ value: "Mac", events: 4, share: 1 }] }),
      });

      expect(wrapper.find('[data-test="rum-error-facet-os"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="rum-error-facet-browser"]').exists()).toBe(false);
    });

    it("shows an empty state when no facet has values", () => {
      wrapper = mountComponent();

      expect(wrapper.find('[data-test="rum-error-facet-breakdown-empty"]').exists()).toBe(true);
    });

    it("shows skeletons instead of the empty state while loading", () => {
      wrapper = mountComponent({ loading: true });

      expect(wrapper.find('[data-test="rum-error-facet-breakdown-loading"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="rum-error-facet-breakdown-empty"]').exists()).toBe(false);
    });
  });

  describe("dominant-value insight", () => {
    it("calls out a value that owns most of the traffic", () => {
      wrapper = mountComponent({
        facets: facetsWith({
          browser: [
            { value: "Safari", events: 94, share: 0.94 },
            { value: "Chrome", events: 6, share: 0.06 },
          ],
        }),
      });

      const insight = wrapper.find('[data-test="rum-error-facet-breakdown-insight"]');
      expect(insight.exists()).toBe(true);
      expect(insight.text()).toContain("94%");
      expect(insight.text()).toContain("Safari");
    });

    it("stays silent when the traffic is spread across values", () => {
      wrapper = mountComponent({
        facets: facetsWith({
          browser: [
            { value: "Chrome", events: 6, share: 0.6 },
            { value: "Safari", events: 4, share: 0.4 },
          ],
        }),
      });

      expect(wrapper.find('[data-test="rum-error-facet-breakdown-insight"]').exists()).toBe(false);
    });

    it("stays silent when the facet has only one value to concentrate in", () => {
      wrapper = mountComponent({
        facets: facetsWith({ browser: [{ value: "Chrome", events: 10, share: 1 }] }),
      });

      expect(wrapper.find('[data-test="rum-error-facet-breakdown-insight"]').exists()).toBe(false);
    });

    it("reports the strongest concentration when several qualify", () => {
      wrapper = mountComponent({
        facets: facetsWith({
          browser: [
            { value: "Safari", events: 85, share: 0.85 },
            { value: "Chrome", events: 15, share: 0.15 },
          ],
          release: [
            { value: "2.4.1", events: 97, share: 0.97 },
            { value: "2.4.0", events: 3, share: 0.03 },
          ],
        }),
      });

      const insight = wrapper.find('[data-test="rum-error-facet-breakdown-insight"]');
      expect(insight.text()).toContain("97%");
      expect(insight.text()).toContain("2.4.1");
    });
  });
});
