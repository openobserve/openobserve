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
import { valueWithUnit } from "./alertCopy";

// The server names a builder query's measure with this alias and compares it after the query runs.
const MEASURE_COLUMN = "alert_agg_value";

/** Where the threshold applies to the generated SQL, which carries it only in ORDER BY. */
export function generatedSqlNote(
  input: {
    sql: string;
    grouped: boolean;
    value: number | null;
    unit?: string;
    stored?: number;
    storedUnit?: string;
  },
  t: TranslateFn,
): I18nText | null {
  if (input.value === null || !Number.isFinite(input.value) || !input.sql.trim()) return null;
  const shown = valueWithUnit(input.value, input.unit, t);
  const threshold =
    input.stored !== undefined && input.storedUnit && input.storedUnit !== input.unit
      ? t("alerts.form.generatedSql.storedAs", {
          value: shown,
          stored: valueWithUnit(input.stored, input.storedUnit, t),
        })
      : shown;
  if (!new RegExp(`\\b${MEASURE_COLUMN}\\b`).test(input.sql))
    return t("alerts.form.generatedSql.thresholdRows", { threshold });
  return t(
    input.grouped
      ? "alerts.form.generatedSql.thresholdPerGroup"
      : "alerts.form.generatedSql.thresholdAfter",
    { threshold, column: raw(MEASURE_COLUMN) },
  );
}
