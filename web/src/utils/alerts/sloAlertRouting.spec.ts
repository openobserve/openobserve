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

import {
  isSloAlert,
  isUnplaceableSloAlert,
  sloAlertEditRoute,
  sloIdOf,
} from "./sloAlertRouting";

// Feature 5 (Phase 3). SLO alert authoring lives on the SLO page, so every
// route into the generic alert editor has to divert. There are THREE such
// entry points (the list's edit button, the `action=update` query param —
// handled in two separate places — and AlertDetail's own edit button), which
// is exactly why the decision lives in one pure module instead of being
// re-derived at each site.

describe("sloAlertRouting", () => {
  // Two shapes reach the routing decision, and they are NOT the same object.
  //
  // 1. The MAPPED table row. `AlertList`'s row mapper rebuilds every API row
  //    field by field, keeping the condition as `rawCondition` and flattening
  //    its discriminator to `type`. There is no `condition` key on the row and
  //    the id is `alert_id`. This is what the edit button hands `editAlert`.
  // 2. The FETCHED alert, from `get_by_alert_id`. That is the API `Alert`
  //    model: `query_condition` (not renamed) and `id`. This is what both
  //    `action=update` handlers and AlertDetail hold.
  //
  // The un-mapped API list row (`condition`) is deliberately NOT supported —
  // it exists only inside the mapper, and no routing caller ever holds one.

  /** The mapped table row, as the list's edit button passes it. */
  const mappedRow = (overrides: Record<string, any> = {}) => ({
    alert_id: "alert-1",
    name: "fast burn",
    type: "slo",
    rawCondition: {
      type: "slo",
      slo_condition: { slo_id: "slo-123", kind: "burn_rate" },
    },
    ...overrides,
  });

  /** The shape a single-alert GET returns: `query_condition` + `id`. */
  const fullAlert = (overrides: Record<string, any> = {}) => ({
    id: "alert-1",
    name: "fast burn",
    query_condition: {
      type: "slo",
      slo_condition: { slo_id: "slo-123", kind: "burn_rate" },
    },
    ...overrides,
  });

  describe("isSloAlert", () => {
    // Both shapes must be recognised: the list row and the fetched alert are
    // different objects, and the diversion happens against BOTH (the list's
    // edit button has only the row; the query-param handlers have the fetched
    // alert).
    it("recognises a mapped table row by its flattened type", () => {
      expect(isSloAlert(mappedRow())).toBe(true);
    });

    it("recognises a fetched alert by query_condition.type", () => {
      expect(isSloAlert(fullAlert())).toBe(true);
    });

    it("is false for every other query type", () => {
      for (const type of ["sql", "promql", "custom"]) {
        expect(isSloAlert(mappedRow({ type, rawCondition: { type } }))).toBe(false);
        expect(isSloAlert(fullAlert({ query_condition: { type } }))).toBe(false);
      }
    });

    // The list response omits `condition` for anomaly rows, and callers pass
    // whatever they have — a throw here would break the alerts list for every
    // alert, not just SLO ones.
    it("is false rather than throwing for missing or malformed input", () => {
      expect(isSloAlert(null)).toBe(false);
      expect(isSloAlert(undefined)).toBe(false);
      expect(isSloAlert({})).toBe(false);
      expect(isSloAlert({ condition: null })).toBe(false);
      expect(isSloAlert({ alert_type: "anomaly_detection" })).toBe(false);
    });

    // Guard against matching on a substring or a truthy check: only the exact
    // discriminator counts.
    it("does not match a lookalike type string", () => {
      expect(isSloAlert(mappedRow({ type: "slow", rawCondition: { type: "slow" } }))).toBe(false);
      expect(isSloAlert(mappedRow({ type: "SLO", rawCondition: { type: "SLO" } }))).toBe(false);
    });
  });

  describe("sloIdOf", () => {
    it("reads the id from either shape", () => {
      expect(sloIdOf(mappedRow())).toBe("slo-123");
      expect(sloIdOf(fullAlert())).toBe("slo-123");
    });

    it("returns null when there is no SLO condition", () => {
      expect(sloIdOf(mappedRow({ type: "sql", rawCondition: { type: "sql" } }))).toBeNull();
      expect(sloIdOf(null)).toBeNull();
    });

    // The same malformed inputs `isSloAlert` tolerates. Null-safety does NOT
    // transfer between the two functions, and an anomaly row genuinely has no
    // condition at all (`ListAlertsResponseBodyItem.condition` is optional),
    // so a naive `alert.condition.slo_condition` here throws on a real row.
    it("returns null rather than throwing for malformed input", () => {
      for (const bad of [
        undefined,
        {},
        { condition: null },
        { rawCondition: null },
        { alert_type: "anomaly_detection" },
        { rawCondition: { type: "slo" } },
      ]) {
        expect(sloIdOf(bad)).toBeNull();
      }
    });

    // Deliberately NOT tested: a fallback to a top-level `slo_id` field. The
    // list response (`ListAlertsResponseBodyItem`) carries no such field — the
    // id reaches the frontend only inside `condition.slo_condition` — so a
    // fallback would encode an API shape that does not exist.
  });

  // `sloAlertEditRoute` returns null for two very different situations: "not an
  // SLO alert, carry on" and "an SLO alert I cannot place". Callers must not
  // treat them alike — falling through on the second opens the generic editor
  // on an alert it cannot represent, and saving from there either fails
  // forever with `MissingCondition` or silently rewrites the alert's type.
  describe("isUnplaceableSloAlert", () => {
    it("flags an SLO alert whose SLO cannot be determined", () => {
      expect(isUnplaceableSloAlert({ id: "a1", query_condition: { type: "slo" } })).toBe(true);
      expect(
        isUnplaceableSloAlert({ type: "slo", rawCondition: { type: "slo", slo_condition: {} } }),
      ).toBe(true);
    });

    it("is false for a placeable SLO alert", () => {
      expect(isUnplaceableSloAlert(mappedRow())).toBe(false);
      expect(isUnplaceableSloAlert(fullAlert())).toBe(false);
    });

    it("is false for anything that is not an SLO alert", () => {
      expect(isUnplaceableSloAlert(mappedRow({ type: "sql", rawCondition: { type: "sql" } }))).toBe(
        false,
      );
      expect(isUnplaceableSloAlert(null)).toBe(false);
      expect(isUnplaceableSloAlert({})).toBe(false);
    });
  });

  describe("sloAlertEditRoute", () => {
    // Deliberately NOT "default" (this app's default org name): a hardcoded
    // org in the implementation would pass against that value.
    const ORG = "acme-prod";

    it("routes to the SLO detail page carrying the alert id", () => {
      expect(sloAlertEditRoute(mappedRow(), ORG)).toEqual({
        name: "sloDetail",
        params: { slo_id: "slo-123" },
        query: { org_identifier: ORG, edit_alert: "alert-1" },
      });
    });

    // Without the id the SLO page can only show a list, leaving the user to
    // hunt for the alert they just clicked among N others (D8 allows many).
    // `??` keeps an empty string, which the falsy guard then rejects — so a
    // row with a blank alert_id but a real id would fail to route.
    it("falls back past a blank id rather than treating it as present", () => {
      expect(
        sloAlertEditRoute({ ...mappedRow(), alert_id: "", id: "real-id" }, ORG)?.query.edit_alert,
      ).toBe("real-id");
    });

    it("carries the alert id from BOTH id fields", () => {
      // The mapped row has `alert_id`; the fetched alert has `id`. Reading
      // only one leaves the other diversion path pointing at `undefined`.
      expect(sloAlertEditRoute(mappedRow({ alert_id: "row-9" }), ORG)?.query.edit_alert).toBe(
        "row-9",
      );
      expect(sloAlertEditRoute(fullAlert({ id: "full-9" }), ORG)?.query.edit_alert).toBe(
        "full-9",
      );
    });

    it("returns null for a non-SLO alert so the caller keeps its normal path", () => {
      expect(
        sloAlertEditRoute(mappedRow({ type: "sql", rawCondition: { type: "sql" } }), ORG),
      ).toBeNull();
      expect(sloAlertEditRoute(null, ORG)).toBeNull();
      expect(sloAlertEditRoute(undefined, ORG)).toBeNull();
      expect(sloAlertEditRoute({}, ORG)).toBeNull();
    });

    // An SLO alert whose slo_id cannot be determined has nowhere to divert TO.
    // Returning null (and letting the caller fall back) beats routing to
    // `/slos/undefined`.
    it("returns null when the SLO id cannot be determined", () => {
      expect(
        sloAlertEditRoute({ type: "slo", rawCondition: { type: "slo", slo_condition: {} } }, ORG),
      ).toBeNull();
    });
  });
});
