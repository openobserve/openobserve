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

import type { I18nText, TranslateFn } from "@/types/i18n";
import type { UpdateAlertCalibrationConfig } from "@/services/alert_calibration";
import { formatMinutes } from "@/components/alert_calibration/format";
import { RULE_META, rulesStarvedBy } from "@/components/alert_calibration/rules";
import type { AlertCalibrationSettingsForm } from "./AlertCalibrationSettings.schema";

const FIELDS = ["enabled", "frequency_minutes", "window_minutes"] as const;

/** Only the changed fields are sent: the update is partial and the server refuses any other key. */
export function changedFields(
  baseline: AlertCalibrationSettingsForm,
  values: AlertCalibrationSettingsForm,
): UpdateAlertCalibrationConfig {
  const patch: UpdateAlertCalibrationConfig = {};
  for (const field of FIELDS) {
    if (values[field] !== baseline[field]) Object.assign(patch, { [field]: values[field] });
  }
  return patch;
}

/** Neither blocks a save: the server accepts both, and the digests show the consequence. */
export function scheduleWarnings(t: TranslateFn, every: number, window: number): I18nText[] {
  const out: I18nText[] = [];
  if (every > window) {
    out.push(
      t("alertCalibration.settings.warnGap", {
        every: formatMinutes(t, every),
        window: formatMinutes(t, window),
      }),
    );
  }
  const starved = rulesStarvedBy(window);
  if (starved.length > 0) {
    const rules = starved
      .map((rule) =>
        t("alertCalibration.settings.ruleNeeds", {
          rule: t(RULE_META[rule].labelKey),
          duration: formatMinutes(t, RULE_META[rule].minHistoryMinutes),
        }),
      )
      .join(", ");
    out.push(
      t("alertCalibration.settings.warnStarved", { window: formatMinutes(t, window), rules }),
    );
  }
  return out;
}
