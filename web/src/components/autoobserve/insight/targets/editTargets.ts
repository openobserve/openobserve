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

import store from "@/stores";
import {
  alertFolderOf,
  editAlertRoute,
  type EditAlertRoute,
} from "@/components/alert_calibration/alertEditorLink";
import type { ApplyCopy } from "@/components/alert_calibration/applySuggestion";
import {
  ALERT_PREFILL_VERSION,
  type AlertEditFocus,
  type AlertEditHandoff,
} from "@/ts/interfaces/alertPrefill";
import { gt } from "@/types/i18n";
import {
  AUTOOBSERVE_PREFILL,
  CALIBRATION_PREFILL,
  MAX_DESTINATIONS,
} from "@/utils/alerts/alertEditHandoff";
import { writeAlertEditHandoff } from "@/utils/alerts/alertPrefillStorage";
import { isAutoObserveBuild } from "@/utils/alerts/prefill/fromAutoObserve";

export type ReviewFocus = "query" | "threshold" | "settings";

export interface HandoffOptions {
  /** The alert's name, which the folder lookup needs; without it the editor picks the folder. */
  alertName?: string | null;
  /** The destinations the alert has now, so the editor can tell a stale suggestion from a fresh one. */
  current?: string[];
  /** False once the click is stale, such as after an org switch, so a late lookup writes nothing. */
  isCurrent?: () => boolean;
}

// The editor has no settings field to focus, the same call calibration's Review settings makes.
const FOCUS: Record<ReviewFocus, AlertEditFocus | null> = {
  query: "query",
  threshold: "threshold",
  settings: null,
};

const orgOf = (): string => String(store.state.selectedOrganization?.identifier ?? "");

// The editor validates the calibration handoff shape, so AutoObserve reuses it with no finding behind it.
const handoffFor = (alertId: string): AlertEditHandoff => ({
  version: ALERT_PREFILL_VERSION,
  source: CALIBRATION_PREFILL,
  target: { alertId, findingId: "" },
});

const routeTo = async (alertId: string, alertName?: string | null): Promise<EditAlertRoute> => {
  const org = orgOf();
  const folder = await alertFolderOf(org, alertId, alertName);
  return editAlertRoute(org, alertId, folder, AUTOOBSERVE_PREFILL);
};

const names = (list: string[] | undefined): string[] => [
  ...new Set((list ?? []).filter((name) => typeof name === "string" && name !== "")),
];

/** Review query / threshold / settings: opens the alert's editor at that field; nothing changes until Save. */
export const reviewTarget = async (
  alertId: string,
  focus: ReviewFocus,
  opts: HandoffOptions = {},
): Promise<EditAlertRoute | null> => {
  if (!isAutoObserveBuild() || !alertId) return null;
  const route = await routeTo(alertId, opts.alertName);
  if (opts.isCurrent && !opts.isCurrent()) return null;
  const field = FOCUS[focus];
  writeAlertEditHandoff(field ? { ...handoffFor(alertId), focus: field } : handoffFor(alertId));
  return route;
};

/** Choose who gets notified: opens the editor at destinations, with the suggested ones filled in when there are any. */
export const destinationHandoff = async (
  alertId: string,
  destinations: string[],
  opts: HandoffOptions = {},
): Promise<EditAlertRoute | null> => {
  if (!isAutoObserveBuild() || !alertId) return null;
  const route = await routeTo(alertId, opts.alertName);
  // The storage key is shared across orgs, so a stale answer must not replace a newer handoff.
  if (opts.isCurrent && !opts.isCurrent()) return null;
  const to = names(destinations).slice(0, MAX_DESTINATIONS);
  const from = names(opts.current).slice(0, MAX_DESTINATIONS);
  const same = to.length === from.length && to.every((name) => from.includes(name));
  const handoff: AlertEditHandoff = { ...handoffFor(alertId), focus: "destinations" };
  writeAlertEditHandoff(
    to.length && !same ? { ...handoff, patch: { destinations: { from, to } } } : handoff,
  );
  return route;
};

/** The editor banner names AutoObserve for its own handoffs and keeps calibration's words for calibration's. */
export const handoffCopy = (prefill: unknown, copy: ApplyCopy): ApplyCopy =>
  prefill === AUTOOBSERVE_PREFILL
    ? {
        ...copy,
        review: () => gt("insight.targets.editor.review"),
        applied: (fields) =>
          gt("insight.targets.editor.applied", { changes: copy.changes(fields) }),
      }
    : copy;
