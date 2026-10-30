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

//! Where an SLO alert's editor lives (Feature 5, Phase 3).
//!
//! SLO alert authoring belongs to the SLO page, so every route into the
//! generic alert editor has to divert. There are several such entry points —
//! the alerts list's edit button, the `action=update` query param (handled in
//! two independent places), and AlertDetail's own edit button — and a
//! diversion missing from any one of them silently drops the user into a form
//! that cannot represent the alert. That is why the decision lives here once
//! rather than being re-derived at each site.

/** The discriminator value the backend stores for this alert family. */
const SLO_QUERY_TYPE = "slo";

/**
 * The alert's query condition, whichever shape the caller happens to hold.
 *
 * Two genuinely different objects reach these helpers:
 *  * the **mapped table row** the alerts list builds — the condition survives
 *    as `rawCondition`, with its discriminator flattened onto `type`;
 *  * the **fetched alert** from `get_by_alert_id` — the API `Alert` model,
 *    whose field is `query_condition`.
 */
const conditionOf = (alert: any): any =>
  alert?.query_condition ?? alert?.condition ?? alert?.rawCondition ?? null;

/** True when this alert is an SLO alert, for any of the shapes above. */
export const isSloAlert = (alert: any): boolean => {
  if (!alert || typeof alert !== "object") return false;
  // The mapped row carries the discriminator flat; everything else nests it.
  if (alert.type === SLO_QUERY_TYPE) return true;
  return conditionOf(alert)?.type === SLO_QUERY_TYPE;
};

/** The SLO this alert points at, or null when it cannot be determined. */
export const sloIdOf = (alert: any): string | null => {
  if (!isSloAlert(alert)) return null;
  const sloId = conditionOf(alert)?.slo_condition?.slo_id;
  return typeof sloId === "string" && sloId.length > 0 ? sloId : null;
};

/**
 * An SLO alert that cannot be routed to its SLO page.
 *
 * Reachable because the discriminator and the stored condition are separate
 * columns: `query_type = slo` with a NULL `query_slo_condition` is
 * representable, and nothing repairs the pair on read. The write path does
 * reject the combination (`validate_slo_alert_wiring` → `MissingCondition`),
 * so this is not a legacy-row problem — it is produced on READ, by D42: the
 * loader does `serde_json::from_value(v).ok()`
 * (`src/infra/src/table/alerts/mod.rs:155`), so an unparseable blob degrades
 * to `None` while `query_type` stays `Slo`, deliberately, rather than taking
 * the whole alert list down.
 *
 * Callers MUST branch on this rather than treating `sloAlertEditRoute`'s
 * `null` as "carry on": the caller's normal path is the generic editor, which
 * cannot represent an SLO alert. Saving from there either fails forever with
 * `MissingCondition` or silently rewrites the alert's type. Show an error
 * instead.
 */
export const isUnplaceableSloAlert = (alert: any): boolean =>
  isSloAlert(alert) && sloIdOf(alert) === null;

export interface SloAlertRoute {
  name: string;
  params: Record<string, string>;
  query: Record<string, string>;
}

/**
 * The route to an SLO's own page.
 *
 * Here rather than at each call site for the same reason the rest of this
 * module is: the alerts list, the alert status page and the SLO list all link
 * to an SLO, and every one of them has to remember to carry `org_identifier` —
 * a link that drops it lands on whichever org the next page happens to resolve.
 */
export const sloDetailRoute = (sloId: string, orgIdentifier: string): SloAlertRoute => ({
  name: "sloDetail",
  params: { slo_id: sloId },
  query: { org_identifier: orgIdentifier },
});

/**
 * Where to send the user instead of the generic editor, or `null` to leave the
 * caller's normal path alone.
 *
 * `null` for a non-SLO alert AND for an SLO alert whose SLO cannot be
 * resolved: routing to `/slos/undefined` would be worse than the editor the
 * caller would otherwise have opened.
 */
export const sloAlertEditRoute = (alert: any, orgIdentifier: string): SloAlertRoute | null => {
  const sloId = sloIdOf(alert);
  if (!sloId) return null;

  // The mapped row's id is `alert_id`; the fetched alert's is `id`. Reading
  // only one leaves the other diversion path pointing at nothing, so the SLO
  // page would open its list instead of the alert the user clicked.
  // `||`, not `??`: a blank alert_id must fall through to `id` rather than
  // being kept and then rejected by the guard below.
  const alertId = alert?.alert_id || alert?.id;
  if (!alertId) return null;

  return {
    name: "sloDetail",
    params: { slo_id: sloId },
    query: { org_identifier: orgIdentifier, edit_alert: String(alertId) },
  };
};
