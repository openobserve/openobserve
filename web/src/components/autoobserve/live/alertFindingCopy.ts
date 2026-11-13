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

import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import type { AutoObserveSuggestion } from "@/services/autoobserve";
import { ADVICE_LABEL, LIMITATION_LABEL } from "@/components/alert_calibration/rules";
import type { Msg } from "../v2/fixtures";
import { agoText } from "./liveCopy";

interface Sentence {
  key: I18nKey;
  needs?: "stream" | "field";
  // An errors-only finding may name no stream or field, so it is said without one.
  without?: I18nKey;
}

const GENERIC: I18nKey = "autoobserveLive.suggestions.body.alertNotWorkingGeneric";

// Definition patterns reuse the rail's blind sentences; P7a's error classes get their own.
const SENTENCE: Record<string, Sentence> = {
  stream_missing: {
    key: "autoobserveLive.suggestions.body.blindStreamMissing",
    needs: "stream",
    without: "autoobserveLive.suggestions.body.alertStreamGone",
  },
  field_missing: {
    key: "autoobserveLive.suggestions.body.blindUnknownField",
    needs: "field",
    without: "autoobserveLive.suggestions.body.alertFieldGone",
  },
  ignored_matcher: { key: "autoobserveLive.suggestions.body.blindIgnoredMatcher", needs: "field" },
  empty_scope: { key: "autoobserveLive.suggestions.body.blindEmptyScope" },
  source_inactive: { key: "autoobserveLive.suggestions.body.blindNoData", needs: "stream" },
  syntax: { key: "autoobserveLive.suggestions.body.alertSyntax" },
  resource_timeout: { key: "autoobserveLive.suggestions.body.alertTimeout" },
  resource_memory: { key: "autoobserveLive.suggestions.body.alertMemory" },
  other: { key: "autoobserveLive.suggestions.body.alertOtherError" },
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

// Counts are said only when the server sent both, so "3 of 0" never shows.
const notifyFailedHeadline = (
  t: TranslateFn,
  locale: string,
  s: AutoObserveSuggestion,
  monitor: I18nText,
): I18nText => {
  const failed = count(s.evidence.delivery_failures);
  const tried = count(s.evidence.delivery_attempts);
  if (failed === null || tried === null)
    return t("autoobserveLive.suggestions.body.alertNotifyFailedNoCounts", { monitor });
  const n = new Intl.NumberFormat(locale);
  return t(
    "autoobserveLive.suggestions.body.alertNotifyFailed",
    { monitor, failed: raw(n.format(failed)), tried: raw(n.format(tried)) },
    tried,
  );
};

export const alertFindingHeadline = (
  t: TranslateFn,
  locale: string,
  s: AutoObserveSuggestion,
): I18nText => {
  const monitor = raw(text(s.evidence.alert_name));
  if (s.kind === "alert_no_destination")
    return t("autoobserveLive.suggestions.body.alertNoDestination", { monitor });
  if (s.kind === "alert_notify_failed") return notifyFailedHeadline(t, locale, s, monitor);
  const pattern = text(s.evidence.pattern);
  const sentence = Object.hasOwn(SENTENCE, pattern) ? SENTENCE[pattern] : null;
  if (!sentence) return t(GENERIC, { monitor });
  const stream = text(s.evidence.stream);
  const field = text(s.evidence.field);
  const value = { stream, field }[sentence.needs ?? "stream"];
  if (sentence.needs && !value) return t(sentence.without ?? GENERIC, { monitor });
  return t(sentence.key, { monitor, detail: raw(stream), field: raw(field), label: raw(field) });
};

export const analysedText = (t: TranslateFn, locale: string, minutes: number): I18nText =>
  t("autoobserveLive.suggestions.analysedAt", { ago: agoText(t, locale, minutes) });

// Calibration's own advice and limits, so the rail and the calibration page say the same thing.
export const alertFindingBody = (s: AutoObserveSuggestion): Msg | null => {
  const codes: [Record<string, I18nKey>, string][] = [
    [ADVICE_LABEL, s.advice ?? ""],
    ...(s.limitations ?? []).map((code): [Record<string, I18nKey>, string] => [
      LIMITATION_LABEL,
      code,
    ]),
  ];
  const parts: Msg[] = codes
    .filter(([labels, code]) => Object.hasOwn(labels, code))
    .map(([labels, code]) => ({ key: labels[code] }));
  return parts.reduceRight<Msg | null>(
    (rest, first) =>
      rest ? { key: "autoobserveLive.suggestions.detail.joined", params: { first, rest } } : first,
    null,
  );
};
