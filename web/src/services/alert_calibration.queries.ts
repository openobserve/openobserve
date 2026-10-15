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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";
import alertCalibration, {
  httpStatus,
  type AlertCalibrationConfig,
  type UpdateAlertCalibrationConfig,
} from "./alert_calibration";
import { alertCalibrationKeys } from "./alert_calibration.querykeys";

/** `null` until the org's first save: the server answers 404 for an org with no config row. */
export const alertCalibrationConfigQuery = (org: string) =>
  queryOptions({
    queryKey: alertCalibrationKeys.config(org),
    queryFn: async (): Promise<AlertCalibrationConfig | null> => {
      try {
        return (await alertCalibration.getConfig(org)).data;
      } catch (error) {
        if (httpStatus(error) === 404) return null;
        throw error;
      }
    },
    staleTime: NORMAL_STALE_TIME,
  });

export const updateAlertCalibrationConfigMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: UpdateAlertCalibrationConfig) =>
      (await alertCalibration.updateConfig(org, body)).data,
    // The settings form renders its own toasts.
    meta: { invalidates: [alertCalibrationKeys.all(org)], silentError: true },
  });

export const requestAlertCalibrationRunMutation = (org: string) =>
  mutationOptions({
    mutationFn: () => alertCalibration.requestRun(org),
    // The caller says what happens next; a run only changes the digest stream, which is never cached.
    meta: { silentError: true },
  });
