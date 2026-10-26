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
import { valueMappingPatternError } from "@/utils/dashboard/tableConfigUtils";

/** The error text of each regex mapping that can never match, by row; editors block Save while any exists. */
export const valueMappingPatternErrors = (
  mappings: unknown,
  t: TranslateFn,
): Record<number, I18nText> => {
  const errors: Record<number, I18nText> = {};
  (Array.isArray(mappings) ? mappings : []).forEach((mapping, index) => {
    if (mapping?.type !== "regex") return;
    const error = valueMappingPatternError(String(mapping.pattern ?? ""));
    if (error === "tooLong") errors[index] = t("dashboard.valueMappingRegexTooLong");
    if (error === "unsupported") errors[index] = t("dashboard.valueMappingRegexUnsupported");
  });
  return errors;
};
