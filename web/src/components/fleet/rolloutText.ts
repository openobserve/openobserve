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

import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";

interface Counts {
  attempted: number;
  accepted: number;
  failed: number;
}

interface Failure {
  labelKey: I18nKey;
  observed: string;
  threshold: string;
  message?: string | null;
}

/** One wording for rollout counts and failures, shared by the list row and the drawer. */
export function useRolloutText() {
  const { t } = useI18nTyped();
  // An empty fleet still records a completed rollout, and "0 of 0 attempted" reads as a success.
  const countsText = (c: Counts, total: number) =>
    total === 0
      ? t("fleet.rollouts.noneTargeted")
      : t("fleet.rollouts.counts", {
          attempted: c.attempted,
          total,
          accepted: c.accepted,
          failed: c.failed,
        });
  const failureText = (r: { failure?: Failure | null }) => {
    const f = r.failure;
    if (!f) return raw("");
    if (f.labelKey === "fleet.rollouts.gateHeartbeat")
      return t("fleet.rollouts.gateFailedReason", {
        gate: t(f.labelKey),
        observed: raw(f.observed),
        threshold: raw(f.threshold),
      });
    if (f.labelKey === "fleet.rollouts.failureOther")
      return t(f.labelKey, { reason: raw(f.message || f.observed) });
    if (f.labelKey !== "fleet.rollouts.gateRejected") return t(f.labelKey);
    const count = Number(f.observed) || 0;
    const reason = t(f.labelKey, { count }, count);
    return f.message
      ? t("fleet.rollouts.failureMessage", { reason, message: raw(f.message) })
      : reason;
  };
  const startsText = (scheduledFor: number) => {
    const ms = scheduledFor - Date.now();
    if (ms <= 0) return t("fleet.rollouts.startingShortly");
    if (ms < 3_600_000)
      return t("fleet.rollouts.startsInMinutes", { minutes: Math.ceil(ms / 60_000) });
    return t("fleet.rollouts.startsIn", { hours: Math.ceil(ms / 3_600_000) });
  };
  const changeText = (r: { fromVersion: number | null; toVersion: number }) =>
    r.fromVersion === null
      ? t("fleet.rollouts.versionTo", { to: r.toVersion })
      : t("fleet.rollouts.versionChange", { from: r.fromVersion, to: r.toVersion });
  return { changeText, countsText, failureText, startsText };
}
