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

import { z } from "zod";
import type { TranslateFn } from "@/types/i18n";

/** The server's bounds: a cadence from an hour to a month, and a window of up to 90 days. */
export const MIN_FREQUENCY_MINUTES = 60;
export const MAX_FREQUENCY_MINUTES = 43_200;
export const MAX_WINDOW_MINUTES = 129_600;

/** The columns' defaults, which the first save stores for any field it leaves out. */
export const CONFIG_DEFAULTS = {
  enabled: false,
  frequency_minutes: 1440,
  window_minutes: 43_200,
};

export const makeAlertCalibrationSettingsSchema = (t: TranslateFn) =>
  z.object({
    enabled: z.boolean(),
    frequency_minutes: z
      .number()
      .int()
      .min(MIN_FREQUENCY_MINUTES, t("alertCalibration.settings.frequencyRange"))
      .max(MAX_FREQUENCY_MINUTES, t("alertCalibration.settings.frequencyRange")),
    window_minutes: z
      .number()
      .int()
      .min(1, t("alertCalibration.settings.windowRange"))
      .max(MAX_WINDOW_MINUTES, t("alertCalibration.settings.windowRange")),
  });

export type AlertCalibrationSettingsForm = z.infer<
  ReturnType<typeof makeAlertCalibrationSettingsSchema>
>;
