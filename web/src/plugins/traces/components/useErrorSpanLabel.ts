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

import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { ErrorSpanSummary } from "../utils/traceErrorSummary";

/** "service · operation", with the trace view's unknown-name fallbacks. */
export const useErrorSpanLabel = () => {
  const { t } = useI18nTyped();
  return (error: ErrorSpanSummary): I18nText =>
    t("traces.errorStrip.spanLabel", {
      service: error.serviceName || t("traces.traceDetails.unknownService"),
      operation: error.operationName || t("traces.traceDetails.unknownOperation"),
    });
};
