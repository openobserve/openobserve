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
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { addCommasToNumber } from "@/utils/formatters";
import type { PanelDiagnostics, SeriesLimitInfo } from "./panelDiagnostics";

export type PanelNoticeId = "function-error" | "series-cap" | "partial" | "interrupted";

export type PanelNoticeActionId = "use-top-n" | "edit-function" | "refresh";

export interface PanelNotice {
  id: PanelNoticeId;
  tone: "warning" | "error";
  icon: IconName;
  chipLabel: I18nText;
  title: I18nText;
  body: I18nText;
  /** Server-authored text shown verbatim under the body. */
  details: string[];
  action?: { id: PanelNoticeActionId; label: I18nText };
  /** Text the "Copy error" action puts on the clipboard. */
  copyText?: string;
}

export interface PanelNoticeInput {
  seriesLimit?: SeriesLimitInfo | null;
  seriesLimitMessage?: string;
  seriesTotalBound?: SeriesTotalBound;
  serverPartial?: boolean;
  partialReasons?: string[];
  interrupted?: boolean;
  functionErrors?: string[];
  canEdit?: boolean;
  canRefresh?: boolean;
}

/** Why a series total is only a lower bound: the rows stopped at the server's row limit, or arrived partial. */
export type SeriesTotalBound = "capped" | "partial";

/** Chip label and sentence for a series cap; a bounded total reads "1,000+" / "at least 1,000". */
export const describeSeriesLimit = (
  limit: SeriesLimitInfo,
  bound: SeriesTotalBound | undefined,
  t: TranslateFn,
): { chipLabel: I18nText; body: I18nText } => {
  const params = {
    shown: addCommasToNumber(limit.shown),
    total: addCommasToNumber(limit.total),
    cap: addCommasToNumber(limit.cap),
  };
  if (!bound) {
    return {
      chipLabel: t("dashboard.panelErrorButtons.seriesCapChip", params),
      body: t("dashboard.panelErrorButtons.seriesCapBody", params),
    };
  }
  return {
    chipLabel: t("dashboard.panelErrorButtons.seriesCapChipLowerBound", params),
    body:
      bound === "capped"
        ? t("dashboard.panelErrorButtons.seriesCapBodyCapped", params)
        : t("dashboard.panelErrorButtons.seriesCapBodyPartial", params),
  };
};

const displayCapNotice = (message: string, t: TranslateFn): PanelNotice => ({
  id: "series-cap",
  tone: "warning",
  icon: "stacked-line-chart",
  chipLabel: t("dashboard.panelErrorButtons.displayCapChip"),
  title: t("dashboard.panelErrorButtons.displayCapTitle"),
  body: raw(message),
  details: [],
});

const seriesCapNotice = (input: PanelNoticeInput, t: TranslateFn): PanelNotice => {
  if (input.seriesLimit?.displayCapMessage) {
    return displayCapNotice(input.seriesLimit.displayCapMessage, t);
  }
  const described = input.seriesLimit
    ? describeSeriesLimit(input.seriesLimit, input.seriesTotalBound, t)
    : {
        chipLabel: t("dashboard.panelErrorButtons.seriesCapChipFallback"),
        body: raw(input.seriesLimitMessage),
      };
  return {
    id: "series-cap",
    tone: "warning",
    icon: "stacked-line-chart",
    chipLabel: described.chipLabel,
    title: t("dashboard.panelErrorButtons.seriesCapTitle"),
    body: described.body,
    details: [],
    action: input.canEdit
      ? { id: "use-top-n", label: t("dashboard.panelErrorButtons.useTopN") }
      : undefined,
  };
};

/** The header notices in severity order: errors first, then what was hidden, then what was cut short. */
export const buildPanelNotices = (input: PanelNoticeInput, t: TranslateFn): PanelNotice[] => {
  const notices: PanelNotice[] = [];
  const refresh = input.canRefresh
    ? { id: "refresh" as const, label: t("dashboard.panelErrorButtons.refresh") }
    : undefined;

  if (input.functionErrors?.length) {
    notices.push({
      id: "function-error",
      tone: "error",
      icon: "error-outline",
      chipLabel: t("dashboard.panelErrorButtons.functionErrorChip"),
      title: t("dashboard.panelErrorButtons.functionErrorTitle"),
      body: t("dashboard.panelErrorButtons.functionErrorBody"),
      details: input.functionErrors,
      action: input.canEdit
        ? { id: "edit-function", label: t("dashboard.panelErrorButtons.editFunction") }
        : undefined,
      copyText: input.functionErrors.join("\n"),
    });
  }

  if (input.seriesLimit || input.seriesLimitMessage) notices.push(seriesCapNotice(input, t));

  if (input.serverPartial) {
    notices.push({
      id: "partial",
      tone: "warning",
      icon: "sync-problem",
      chipLabel: t("dashboard.panelErrorButtons.partialChip"),
      title: t("dashboard.panelErrorButtons.partialTitle"),
      body: t("dashboard.panelErrorButtons.partialBody"),
      details: input.partialReasons ?? [],
      action: refresh,
    });
  }

  if (input.interrupted) {
    notices.push({
      id: "interrupted",
      tone: "warning",
      icon: "clock-loader-20",
      chipLabel: t("dashboard.panelErrorButtons.interruptedChip"),
      title: t("dashboard.panelErrorButtons.interruptedTitle"),
      body: t("dashboard.panelErrorButtons.interruptedBody"),
      details: [],
      action: refresh,
    });
  }

  return notices;
};

/** The series total counts only the rows that arrived, so a capped or partial result makes it a floor. */
export const seriesTotalBoundOf = (
  diagnostics: Pick<PanelDiagnostics, "rowsCapped" | "serverPartial"> | null | undefined,
): SeriesTotalBound | undefined => {
  if (diagnostics?.rowsCapped) return "capped";
  if (diagnostics?.serverPartial) return "partial";
  return undefined;
};
