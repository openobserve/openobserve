// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * One entry per surface that can create an alert. This is what keeps the source
 * type open — a new surface adds a row here instead of the alerts module growing
 * `if (source === "…")` branches.
 *
 * Registration is a nicety, not a gate: an unregistered id resolves to
 * DEFAULT_ALERT_SOURCE (with a dev-mode warning) and still works end to end.
 * A hard gate would make "integrate alert creation" a two-repo change for
 * enterprise-only surfaces.
 */

import type { AlertPrefillThresholdShape } from "@/ts/interfaces/alertPrefill";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

export interface AlertSourceDefinition {
  id: string;
  /** i18n key for the menu item / button label. */
  labelKey: string;
  /** i18n key for the "imported from …" toast shown on arrival at the form. */
  toastKey: string;
  /** Icon name for the entry point. */
  icon: IconName;
  /** Which threshold shape this surface should default to (§8.5 of the design). */
  defaultThreshold: AlertPrefillThresholdShape;
  /** Whether the confirm dialog shows the resolved query. */
  showQueryPreview: boolean;
}

export const DEFAULT_ALERT_SOURCE: AlertSourceDefinition = {
  id: "unknown",
  labelKey: "alerts.prefill.sources.default.label",
  toastKey: "alerts.prefill.sources.default.toast",
  icon: "shield-alert-outline",
  defaultThreshold: "matching-rows",
  showQueryPreview: true,
};

export const ALERT_SOURCES: Record<string, AlertSourceDefinition> = {
  logs: {
    id: "logs",
    labelKey: "alerts.prefill.sources.logs.label",
    toastKey: "alerts.prefill.sources.logs.toast",
    icon: "shield-alert-outline",
    defaultThreshold: "matching-rows",
    showQueryPreview: true,
  },
  patterns: {
    id: "patterns",
    labelKey: "alerts.prefill.sources.patterns.label",
    toastKey: "alerts.prefill.sources.patterns.toast",
    icon: "shield-alert-outline",
    // "Ignore the noise, tell me if the rest spikes" is the point of the
    // pattern flow, so counting beats listing matched rows here.
    defaultThreshold: "count",
    showQueryPreview: true,
  },
  panel: {
    id: "panel",
    labelKey: "alerts.prefill.sources.panel.label",
    toastKey: "alerts.prefill.sources.panel.toast",
    icon: "shield-alert-outline",
    defaultThreshold: "matching-rows",
    showQueryPreview: true,
  },
  dbm: {
    id: "dbm",
    labelKey: "alerts.prefill.sources.dbm.label",
    toastKey: "alerts.prefill.sources.dbm.toast",
    icon: "shield-alert-outline",
    // The DBM prefill queries the pre-aggregated rollup and thresholds on a
    // single computed value (MAX(p95_ns) / SUM(errors)), so there are no
    // "matching rows" to count — the HAVING clause is the whole condition.
    defaultThreshold: "count",
    showQueryPreview: true,
  },
  dbmlocks: {
    id: "dbmlocks",
    labelKey: "alerts.prefill.sources.dbmlocks.label",
    toastKey: "alerts.prefill.sources.dbmlocks.toast",
    icon: "shield-alert-outline",
    // Same reasoning as `dbm`: the condition lives entirely in a HAVING clause
    // over one aggregate (MAX(wait_seconds) / COUNT(*)), so there is no set of
    // "matching rows" for the form to count.
    //
    // It is a SEPARATE source from `dbm` because the toast has to name the
    // vantage. Both surfaces alert on the same databases, but one reads
    // client-observed spans and this one reads the engine's own lock views;
    // sharing a source id would tell the user "imported from Database
    // Monitoring" for two measurements that must not be compared.
    defaultThreshold: "count",
    showQueryPreview: true,
  },
};

export const getAlertSource = (id: string | undefined): AlertSourceDefinition => {
  if (id && ALERT_SOURCES[id]) return ALERT_SOURCES[id];
  if (id && import.meta.env?.DEV) {
    console.warn(
      `[alerts] Unregistered alert source "${id}" — falling back to defaults. ` +
        `Add it to ALERT_SOURCES in utils/alerts/alertSourceRegistry.ts.`,
    );
  }
  return DEFAULT_ALERT_SOURCE;
};
