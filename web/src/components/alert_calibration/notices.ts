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

import { isAxiosError } from "axios";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { errorMessage, httpStatus } from "@/services/alert_calibration";
import type { LiveNoticeView } from "@/components/autoobserve/live/liveCopy";

/** A failed read in the AutoObserve look: a 403 is a denial without Retry, anything else can be retried. */
export function readNotice(
  t: TranslateFn,
  error: unknown,
  title: I18nText,
  description: I18nText = readFailedCopy(t, error),
): LiveNoticeView {
  if (httpStatus(error) === 403) {
    return {
      title: t("alertCalibration.readError.noAccessTitle"),
      description: t("alertCalibration.readError.noAccessDescription"),
      severity: "error",
      retry: false,
      details: false,
      icon: "lock",
    };
  }
  return {
    title,
    description,
    severity: "error",
    retry: true,
    details: true,
    icon: "error-outline",
  };
}

/** The same words AutoObserve uses for a failed read; an unreachable server says so instead. */
export const readFailedCopy = (t: TranslateFn, error: unknown): I18nText =>
  isAxiosError(error) && !error.response
    ? t("alertCalibration.readError.unreachable")
    : t("alertCalibration.readError.failed");

/** What the Details disclosure shows: the server's own words, kept out of the notice itself. */
export const readFailedDetail = (error: unknown): I18nText | undefined => {
  const message = error ? errorMessage(error) : "";
  return message ? raw(message) : undefined;
};
