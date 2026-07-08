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

// ---------------------------------------------------------------------------
// Component analysis
// ---------------------------------------------------------------------------
// Component: ErrorsKpiCards
// Path: src/components/rum/errorTracking/list/ErrorsKpiCards.vue
// Props:
//   kpis: ErrorKpis — { totalErrors, uniqueIssues, issuesTruncated,
//          errorSessions, totalSessions, crashFreePct, usersAffected,
//          totalUsers, newIssues, deployVersion }
//   loading?: boolean
// Emits: none
// Slots: none
// Store deps: none
// Service deps: none
// Child components: OTag (badge), OSkeleton
// Conditional states:
//   - loading → OSkeleton in each card, values absent
//   - crashFreePct null → value "—", no badge
//   - crashFreePct < 95 → badge "Poor" (error-soft)
//   - 95 ≤ crashFreePct < 99 → badge "Fair" (warning-soft)
//   - crashFreePct ≥ 99 → badge "Good" (success-soft)
//   - issuesTruncated → "+" appended to uniqueIssues count
//   - deployVersion non-null → "first seen since the {version} deploy"
//   - deployVersion null → "first seen in the selected window"
// Four card data-tests:
//   rum-errors-kpi-total-errors-card / -value / -caption
//   rum-errors-kpi-crash-free-card / -value / -caption / -badge
//   rum-errors-kpi-users-affected-card / -value / -caption
//   rum-errors-kpi-new-issues-card / -value / -caption
// ---------------------------------------------------------------------------

import ErrorsKpiCards from "./ErrorsKpiCards.vue";
import type { ErrorKpis } from "./ErrorsKpiCards.vue";

const baseKpis: ErrorKpis = {
  totalErrors: 16_300,
  uniqueIssues: 62,
  issuesTruncated: false,
  errorSessions: 40,
  totalSessions: 42,
  crashFreePct: 99.5,
  usersAffected: 218,
  totalUsers: 604,
  newIssues: 3,
  deployVersion: "v1.0.6",
};

function mountCards(
  kpis: ErrorKpis = baseKpis,
  loading = false,
): VueWrapper {
  return mount(ErrorsKpiCards, {
    props: { kpis, loading },
    global: { plugins: [i18n] },
  });
}

describe("ErrorsKpiCards", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    wrapper = mountCards();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // rendering — root element and structure
  // -------------------------------------------------------------------------

  describe("rendering", () => {
    it("renders the root section element", () => {
      expect(wrapper.find('[data-test="rum-errors-kpi-cards"]').exists()).toBe(
        true,
      );
    });

    it("renders all four article cards", () => {
      expect(
        wrapper.find('[data-test="rum-errors-kpi-total-errors-card"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="rum-errors-kpi-crash-free-card"]').exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="rum-errors-kpi-users-affected-card"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="rum-errors-kpi-new-issues-card"]').exists(),
      ).toBe(true);
    });

    it("renders each card as an article element for semantic correctness", () => {
      const articles = wrapper.findAll("article");
      expect(articles).toHaveLength(4);
    });
  });

  // -------------------------------------------------------------------------
  // total errors card
  // -------------------------------------------------------------------------

  describe("total errors card", () => {
    it("formats totalErrors 16300 as '16.3K'", () => {
      expect(
        wrapper.find('[data-test="rum-errors-kpi-total-errors-value"]').text(),
      ).toBe("16.3K");
    });

    it("renders totalErrors caption with uniqueIssues count", () => {
      expect(
        wrapper
          .find('[data-test="rum-errors-kpi-total-errors-caption"]')
          .text(),
      ).toContain("62");
    });

    it("renders totalErrors caption containing 'unique issues'", () => {
      expect(
        wrapper
          .find('[data-test="rum-errors-kpi-total-errors-caption"]')
          .text(),
      ).toContain("unique issues");
    });

    it("appends '+' to uniqueIssues count when issuesTruncated is true", () => {
      const kpis = { ...baseKpis, uniqueIssues: 200, issuesTruncated: true };
      const w = mountCards(kpis);

      expect(
        w.find('[data-test="rum-errors-kpi-total-errors-caption"]').text(),
      ).toContain("200+");

      w.unmount();
    });

    it("does not append '+' when issuesTruncated is false", () => {
      expect(
        wrapper
          .find('[data-test="rum-errors-kpi-total-errors-caption"]')
          .text(),
      ).not.toContain("+");
    });

    it("formats large totalErrors (1 million) as '1.0M'", () => {
      const kpis = { ...baseKpis, totalErrors: 1_000_000 };
      const w = mountCards(kpis);

      expect(
        w.find('[data-test="rum-errors-kpi-total-errors-value"]').text(),
      ).toBe("1.0M");

      w.unmount();
    });

    it("renders small totalErrors (42) without abbreviation", () => {
      const kpis = { ...baseKpis, totalErrors: 42 };
      const w = mountCards(kpis);

      expect(
        w.find('[data-test="rum-errors-kpi-total-errors-value"]').text(),
      ).toBe("42");

      w.unmount();
    });

    it("renders zero totalErrors as '0'", () => {
      const kpis = { ...baseKpis, totalErrors: 0 };
      const w = mountCards(kpis);

      expect(
        w.find('[data-test="rum-errors-kpi-total-errors-value"]').text(),
      ).toBe("0");

      w.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // crash-free sessions card
  // -------------------------------------------------------------------------

  describe("crash-free sessions card", () => {
    it("renders crashFreePct 5.1 as '5.1%' value", () => {
      const kpis = { ...baseKpis, crashFreePct: 5.1 };
      const w = mountCards(kpis);

      expect(
        w.find('[data-test="rum-errors-kpi-crash-free-value"]').text(),
      ).toBe("5.1%");

      w.unmount();
    });

    it("shows 'Poor' badge when crashFreePct < 95", () => {
      const kpis = { ...baseKpis, crashFreePct: 5.1 };
      const w = mountCards(kpis);

      const badge = w.find('[data-test="rum-errors-kpi-crash-free-badge"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("Poor");

      w.unmount();
    });

    it("shows 'Fair' badge when crashFreePct is 96.5 (between 95 and 99)", () => {
      const kpis = { ...baseKpis, crashFreePct: 96.5 };
      const w = mountCards(kpis);

      const badge = w.find('[data-test="rum-errors-kpi-crash-free-badge"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("Fair");

      w.unmount();
    });

    it("shows 'Good' badge when crashFreePct is 99.5 (>= 99)", () => {
      // Default wrapper has crashFreePct = 99.5
      const badge = wrapper.find('[data-test="rum-errors-kpi-crash-free-badge"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("Good");
    });

    it("shows 'Good' badge at the boundary value of exactly 99", () => {
      const kpis = { ...baseKpis, crashFreePct: 99 };
      const w = mountCards(kpis);

      expect(
        w.find('[data-test="rum-errors-kpi-crash-free-badge"]').text(),
      ).toBe("Good");

      w.unmount();
    });

    it("shows 'Fair' badge at the boundary value of exactly 95", () => {
      const kpis = { ...baseKpis, crashFreePct: 95 };
      const w = mountCards(kpis);

      expect(
        w.find('[data-test="rum-errors-kpi-crash-free-badge"]').text(),
      ).toBe("Fair");

      w.unmount();
    });

    it("shows 'Poor' badge at 94.9 (just below 95)", () => {
      const kpis = { ...baseKpis, crashFreePct: 94.9 };
      const w = mountCards(kpis);

      expect(
        w.find('[data-test="rum-errors-kpi-crash-free-badge"]').text(),
      ).toBe("Poor");

      w.unmount();
    });

    it("renders value '—' and no badge when crashFreePct is null", () => {
      const kpis = { ...baseKpis, crashFreePct: null };
      const w = mountCards(kpis);

      expect(
        w.find('[data-test="rum-errors-kpi-crash-free-value"]').text(),
      ).toBe("—");
      expect(
        w.find('[data-test="rum-errors-kpi-crash-free-badge"]').exists(),
      ).toBe(false);

      w.unmount();
    });

    it("renders crash-free caption with errorSessions and totalSessions", () => {
      // errorSessions 40 / totalSessions 42
      const caption = wrapper
        .find('[data-test="rum-errors-kpi-crash-free-caption"]')
        .text();

      expect(caption).toContain("40");
      expect(caption).toContain("42");
    });

    it("renders crash-free caption containing 'sessions hit an error'", () => {
      const caption = wrapper
        .find('[data-test="rum-errors-kpi-crash-free-caption"]')
        .text();

      expect(caption).toContain("sessions hit an error");
    });
  });

  // -------------------------------------------------------------------------
  // users affected card
  // -------------------------------------------------------------------------

  describe("users affected card", () => {
    it("formats usersAffected 218 with no abbreviation (< 1000)", () => {
      expect(
        wrapper
          .find('[data-test="rum-errors-kpi-users-affected-value"]')
          .text(),
      ).toBe("218");
    });

    it("renders usersAffected caption with totalUsers and percentage", () => {
      // usersAffected=218, totalUsers=604 → 218/604 ≈ 36%
      const caption = wrapper
        .find('[data-test="rum-errors-kpi-users-affected-caption"]')
        .text();

      expect(caption).toContain("604");
      expect(caption).toContain("36%");
    });

    it("renders usersAffected caption containing 'active users'", () => {
      expect(
        wrapper
          .find('[data-test="rum-errors-kpi-users-affected-caption"]')
          .text(),
      ).toContain("active users");
    });

    it("shows 0% when totalUsers is 0", () => {
      const kpis = { ...baseKpis, usersAffected: 0, totalUsers: 0 };
      const w = mountCards(kpis);

      expect(
        w.find('[data-test="rum-errors-kpi-users-affected-caption"]').text(),
      ).toContain("0%");

      w.unmount();
    });

    it("rounds percentage to nearest integer", () => {
      // 1 / 3 = 33.33% → rounds to 33%
      const kpis = { ...baseKpis, usersAffected: 1, totalUsers: 3 };
      const w = mountCards(kpis);

      const caption = w
        .find('[data-test="rum-errors-kpi-users-affected-caption"]')
        .text();

      expect(caption).toContain("33%");

      w.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // new issues card
  // -------------------------------------------------------------------------

  describe("new issues card", () => {
    it("renders newIssues value as plain number string", () => {
      expect(
        wrapper.find('[data-test="rum-errors-kpi-new-issues-value"]').text(),
      ).toBe("3");
    });

    it("renders 'first seen since the v1.0.6 deploy' caption when deployVersion is set", () => {
      const caption = wrapper
        .find('[data-test="rum-errors-kpi-new-issues-caption"]')
        .text();

      expect(caption).toContain("first seen since the v1.0.6 deploy");
    });

    it("renders 'first seen in the selected window' when deployVersion is null", () => {
      const kpis = { ...baseKpis, deployVersion: null };
      const w = mountCards(kpis);

      const caption = w
        .find('[data-test="rum-errors-kpi-new-issues-caption"]')
        .text();

      expect(caption).toContain("first seen in the selected window");

      w.unmount();
    });

    it("renders zero newIssues as '0'", () => {
      const kpis = { ...baseKpis, newIssues: 0 };
      const w = mountCards(kpis);

      expect(
        w.find('[data-test="rum-errors-kpi-new-issues-value"]').text(),
      ).toBe("0");

      w.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // loading state
  // -------------------------------------------------------------------------

  describe("loading state", () => {
    it("shows loading skeleton elements when loading is true", () => {
      const w = mountCards(baseKpis, true);

      // OSkeleton is rendered inside each card; the component renders
      // 4 cards × 1 skeleton each.
      // We verify by checking the value elements are absent.
      expect(
        w.find('[data-test="rum-errors-kpi-total-errors-value"]').exists(),
      ).toBe(false);
      expect(
        w.find('[data-test="rum-errors-kpi-crash-free-value"]').exists(),
      ).toBe(false);
      expect(
        w.find('[data-test="rum-errors-kpi-users-affected-value"]').exists(),
      ).toBe(false);
      expect(
        w.find('[data-test="rum-errors-kpi-new-issues-value"]').exists(),
      ).toBe(false);

      w.unmount();
    });

    it("hides caption elements when loading is true", () => {
      const w = mountCards(baseKpis, true);

      expect(
        w.find('[data-test="rum-errors-kpi-total-errors-caption"]').exists(),
      ).toBe(false);
      expect(
        w.find('[data-test="rum-errors-kpi-crash-free-caption"]').exists(),
      ).toBe(false);

      w.unmount();
    });

    it("shows values when loading transitions from true to false", async () => {
      const w = mountCards(baseKpis, true);

      // Act
      await w.setProps({ loading: false });

      // Assert
      expect(
        w.find('[data-test="rum-errors-kpi-total-errors-value"]').exists(),
      ).toBe(true);
      expect(
        w.find('[data-test="rum-errors-kpi-crash-free-value"]').exists(),
      ).toBe(true);

      w.unmount();
    });

    it("still renders all four card containers while loading", () => {
      const w = mountCards(baseKpis, true);

      expect(
        w.find('[data-test="rum-errors-kpi-total-errors-card"]').exists(),
      ).toBe(true);
      expect(
        w.find('[data-test="rum-errors-kpi-crash-free-card"]').exists(),
      ).toBe(true);
      expect(
        w.find('[data-test="rum-errors-kpi-users-affected-card"]').exists(),
      ).toBe(true);
      expect(
        w.find('[data-test="rum-errors-kpi-new-issues-card"]').exists(),
      ).toBe(true);

      w.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // props reactivity
  // -------------------------------------------------------------------------

  describe("props reactivity", () => {
    it("updates total errors value when kpis.totalErrors changes", async () => {
      await wrapper.setProps({ kpis: { ...baseKpis, totalErrors: 5000 } });

      expect(
        wrapper.find('[data-test="rum-errors-kpi-total-errors-value"]').text(),
      ).toBe("5.0K");
    });

    it("updates crash-free badge from Good to Poor when crashFreePct drops below 95", async () => {
      // Starts at 99.5 = Good
      expect(
        wrapper.find('[data-test="rum-errors-kpi-crash-free-badge"]').text(),
      ).toBe("Good");

      // Act
      await wrapper.setProps({ kpis: { ...baseKpis, crashFreePct: 80 } });

      // Assert
      expect(
        wrapper.find('[data-test="rum-errors-kpi-crash-free-badge"]').text(),
      ).toBe("Poor");
    });

    it("updates new issues caption when deployVersion changes to null", async () => {
      // Starts with deployVersion "v1.0.6"
      await wrapper.setProps({
        kpis: { ...baseKpis, deployVersion: null },
      });

      expect(
        wrapper.find('[data-test="rum-errors-kpi-new-issues-caption"]').text(),
      ).toContain("first seen in the selected window");
    });
  });

  // -------------------------------------------------------------------------
  // edge cases
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    it("renders without crashing when all values are zero", () => {
      const zeroKpis: ErrorKpis = {
        totalErrors: 0,
        uniqueIssues: 0,
        issuesTruncated: false,
        errorSessions: 0,
        totalSessions: 0,
        crashFreePct: null,
        usersAffected: 0,
        totalUsers: 0,
        newIssues: 0,
        deployVersion: null,
      };
      const w = mountCards(zeroKpis);

      expect(w.find('[data-test="rum-errors-kpi-cards"]').exists()).toBe(true);

      w.unmount();
    });

    it("renders very large numbers with B suffix", () => {
      const kpis = { ...baseKpis, totalErrors: 2_500_000_000 };
      const w = mountCards(kpis);

      expect(
        w.find('[data-test="rum-errors-kpi-total-errors-value"]').text(),
      ).toBe("2.5B");

      w.unmount();
    });

    it("renders uniqueIssues 1 without pluralization issues (single item)", () => {
      const kpis = { ...baseKpis, uniqueIssues: 1 };
      const w = mountCards(kpis);

      expect(
        w.find('[data-test="rum-errors-kpi-total-errors-caption"]').text(),
      ).toContain("1");

      w.unmount();
    });

    it("renders crashFreePct 100 as '100.0%' with Good badge", () => {
      const kpis = { ...baseKpis, crashFreePct: 100 };
      const w = mountCards(kpis);

      expect(
        w.find('[data-test="rum-errors-kpi-crash-free-value"]').text(),
      ).toBe("100.0%");
      expect(
        w.find('[data-test="rum-errors-kpi-crash-free-badge"]').text(),
      ).toBe("Good");

      w.unmount();
    });

    it("renders crashFreePct 0 as '0.0%' with Poor badge", () => {
      const kpis = { ...baseKpis, crashFreePct: 0 };
      const w = mountCards(kpis);

      expect(
        w.find('[data-test="rum-errors-kpi-crash-free-value"]').text(),
      ).toBe("0.0%");
      expect(
        w.find('[data-test="rum-errors-kpi-crash-free-badge"]').text(),
      ).toBe("Poor");

      w.unmount();
    });

    it("formats totalSessions with comma separator for large numbers", () => {
      const kpis = { ...baseKpis, errorSessions: 1200, totalSessions: 5000 };
      const w = mountCards(kpis);

      const caption = w
        .find('[data-test="rum-errors-kpi-crash-free-caption"]')
        .text();

      expect(caption).toContain("1,200");
      expect(caption).toContain("5,000");

      w.unmount();
    });

    it("formats totalUsers with comma separator for large numbers", () => {
      const kpis = {
        ...baseKpis,
        usersAffected: 1500,
        totalUsers: 10_000,
      };
      const w = mountCards(kpis);

      const caption = w
        .find('[data-test="rum-errors-kpi-users-affected-caption"]')
        .text();

      expect(caption).toContain("10,000");

      w.unmount();
    });
  });
});
