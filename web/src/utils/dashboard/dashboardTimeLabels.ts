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

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { parseCalendarToken } from "@/utils/dashboard/calendarPeriods";
import type { PanelTimePickerValue } from "@/utils/dashboard/panelTimeUtils";
import type { ShareTimeKind } from "@/utils/shareTimeRange";
import { formatRangeDates } from "@/utils/timeRangeLabel";
import { rollingShortName } from "@/utils/timeRangeForms";
import { formatPeriodLabel } from "@/utils/timeRangeRail";

/** The panel header chip's text: `15m`, a calendar name, or a fixed range's dates. */
export const panelTimeChipLabel = (
  value: PanelTimePickerValue | null | undefined,
  timezone: string,
  t: TranslateFn,
): I18nText => {
  if (!value) return raw("");
  const period = value.relativeTimePeriod;
  if ((value.valueType ?? value.type) === "relative") {
    if (!period) return raw("");
    const short = rollingShortName(period);
    return short ? raw(short) : formatPeriodLabel(period, timezone, t);
  }
  const startUs = Number(value.startTime);
  const endUs = Number(value.endTime);
  if (!(startUs > 0 && endUs > startUs)) return raw("");
  return raw(formatRangeDates({ startUs, endUs }, { timezone }));
};

/** What a plain Share copies: a finished calendar period as fixed dates (owner (b)), any other period live. */
export const dashboardShareKind = (period: string | null | undefined): ShareTimeKind => {
  if (!period) return "fixed";
  const calendar = parseCalendarToken(period);
  return calendar && calendar.offset < 0 ? "fixed" : "live";
};
