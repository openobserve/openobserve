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

import { parseRollingPeriod } from "@/utils/dateTimeRangeParse";

const DASH = " – ";

/** One whole form of the trigger label; `zoneDot` swaps the zone badge for a dot. */
export interface TriggerLabelForm {
  name: string;
  dates: string;
  zoneDot?: boolean;
}

export interface TriggerLabelFormsInput {
  kind: "live" | "calendar" | "named" | "fixed";
  dashboard: boolean;
  name: string;
  shortName?: string | null;
  dates?: string;
  duration?: string;
}

/** `15m`, `90d`, `12mo` for a rolling span; null for anything else. */
export const rollingShortName = (span: string): string | null => {
  const rolling = parseRollingPeriod(span);
  if (!rolling || `${rolling.value}${rolling.unit}` !== span) return null;
  return `${rolling.value}${rolling.unit === "M" ? "mo" : rolling.unit}`;
};

/** The label's forms, widest first (ui-spec §6); each is whole, and a dashboard never loses its dates. */
export const triggerLabelForms = (input: TriggerLabelFormsInput): TriggerLabelForm[] => {
  const { kind, dashboard, name, shortName } = input;
  const dates = input.dates ?? "";
  const short = shortName && shortName !== name ? shortName : null;
  if (kind === "fixed" || !name) {
    if (dashboard || !dates) return [{ name: "", dates }];
    const start = dates.split(DASH)[0];
    const forms: TriggerLabelForm[] = [
      { name: "", dates },
      { name: "", dates, zoneDot: true },
    ];
    if (input.duration && start !== dates) {
      forms.push({ name: "", dates: `${start} · ${input.duration}`, zoneDot: true });
    }
    return forms;
  }
  if (!dashboard && kind !== "named") {
    return short
      ? [
          { name, dates: "" },
          { name: short, dates: "" },
        ]
      : [{ name, dates: "" }];
  }
  if (kind === "named") {
    return dates
      ? [
          { name, dates },
          { name, dates: "" },
        ]
      : [{ name, dates: "" }];
  }
  const forms: TriggerLabelForm[] = [{ name, dates }];
  if (short && kind === "live") forms.push({ name: short, dates });
  if (dates) forms.push({ name: "", dates });
  return forms;
};
