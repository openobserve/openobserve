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
import { hasDeliveryTarget } from "./deliveryTarget";
import {
  nameResolvedExpression,
  type CompositeChildDisplay,
} from "@/components/alerts/composite/expression";

/** The slice of the alert form the plain-words sentences read. */
export interface ReadBackAlert {
  stream_name?: string;
  is_real_time?: string;
  destinations?: string[];
  workflows?: string[];
  oncall_team?: string | null;
  pending_period_sec?: number | string | null;
  query_condition?: {
    type?: string;
    aggregation?: {
      function?: string;
      having?: { column?: string; operator?: string; value?: number | string | null };
    } | null;
    promql_condition?: { operator?: string; value?: number | string | null } | null;
  };
  trigger_condition?: {
    operator?: string;
    threshold?: number | string | null;
    period?: number | string | null;
    frequency?: number | string | null;
    frequency_type?: string;
    cron?: string;
    silence?: number | string | null;
  };
}

/** The slice of a composite alert its plain-words sentence reads. */
export interface ReadBackCompositeAlert {
  destinations?: string[];
  workflows?: string[];
  oncall_team?: string | null;
  pending_period_sec?: number | string | null;
  trigger_condition?: { silence?: number | string | null };
  composite_condition?: { expression?: string } | null;
  children?: CompositeChildDisplay[];
}

/** The preview's verdict; `count`/`label` are present when the verdict came from a counted gate. */
export interface PreviewVerdict {
  wouldTrigger: boolean;
  reason: string;
  count?: number;
  label?: string;
  grouped?: boolean;
}

const OPERATOR_SYMBOLS: Record<string, string> = {
  ">=": "≥",
  ">": ">",
  "<=": "≤",
  "<": "<",
  "=": "=",
  "==": "=",
  "!=": "≠",
};

const CONDITION_KEYS: Record<string, I18nKey> = {
  ">=": "alerts.summary.plainEnglish.conditionAtLeast",
  ">": "alerts.summary.plainEnglish.conditionMoreThan",
  "<=": "alerts.summary.plainEnglish.conditionOrFewer",
  "<": "alerts.summary.plainEnglish.conditionFewerThan",
  "!=": "alerts.summary.plainEnglish.conditionNot",
};

export const operatorSymbol = (op: string | undefined): string =>
  OPERATOR_SYMBOLS[op ?? ""] ?? op ?? "";

/** "3" for the default at-least operator, otherwise "> 3", "≤ 3"... */
export const limitText = (op: string | undefined, value: unknown): string =>
  !op || op === ">=" ? String(value) : `${operatorSymbol(op)} ${value}`;

const num = (value: unknown): number => Number(value ?? 0) || 0;

const durationText = (minutes: number, t: TranslateFn): I18nText =>
  minutes >= 60 && minutes % 60 === 0
    ? t("alerts.summary.hourCount", { n: minutes / 60 }, minutes === 60 ? 1 : 2)
    : t("alerts.summary.minuteCount", { n: minutes }, minutes === 1 ? 1 : 2);

function whoText(alert: ReadBackAlert | ReadBackCompositeAlert, t: TranslateFn): I18nText {
  if (!hasDeliveryTarget(alert)) return t("alerts.readBack.nobody");
  const names: string[] = [...(alert.destinations ?? [])];
  if (!names.length && alert.workflows?.length) names.push(t("alerts.readBack.workflow"));
  if (!names.length && alert.oncall_team) names.push(t("alerts.alertSettings.oncallTeamTarget"));
  const targets =
    names.length > 2
      ? t("alerts.readBack.targetsMore", { first: names[0], count: names.length - 1 })
      : raw(names.join(", "));
  return t("alerts.readBack.targets", { targets });
}

function whatText(alert: ReadBackAlert, t: TranslateFn, aggregationEnabled: boolean): I18nText {
  const qc = alert.query_condition ?? {};
  const tc = alert.trigger_condition ?? {};
  const window = durationText(num(tc.period), t);
  if (alert.is_real_time === "true") return t("alerts.readBack.realtime");
  if (qc.type === "promql") {
    const pc = qc.promql_condition ?? {};
    return t("alerts.readBack.promql", { op: operatorSymbol(pc.operator), value: pc.value ?? "" });
  }
  const having = qc.aggregation?.having;
  // The payload drops a builder measure that is switched off or left behind by a switch to SQL.
  if (
    aggregationEnabled &&
    (qc.type ?? "custom") === "custom" &&
    qc.aggregation &&
    having?.column
  ) {
    return t("alerts.readBack.measureIn", {
      fn: qc.aggregation.function ?? "",
      field: having.column,
      op: operatorSymbol(having.operator),
      value: having.value ?? "",
      window,
    });
  }
  if (qc.type === "sql") {
    return t("alerts.readBack.sqlRows", {
      op: operatorSymbol(tc.operator),
      value: tc.threshold ?? "",
      window,
    });
  }
  const threshold = tc.threshold ?? "";
  const condition =
    tc.operator === "=" || tc.operator === "=="
      ? t(
          "alerts.summary.plainEnglish.conditionExactly",
          { threshold },
          num(threshold) === 1 ? 1 : 2,
        )
      : CONDITION_KEYS[tc.operator ?? ""]
        ? t(CONDITION_KEYS[tc.operator ?? ""], { threshold })
        : t("alerts.summary.plainEnglish.conditionOther", {
            threshold,
            operator: tc.operator ?? "",
          });
  return t("alerts.readBack.eventsIn", { condition, window });
}

function scheduleText(alert: ReadBackAlert, t: TranslateFn): I18nText {
  const tc = alert.trigger_condition ?? {};
  if (alert.is_real_time === "true") return t("alerts.readBack.asItHappens");
  if (tc.frequency_type === "cron") return t("alerts.readBack.cron", { cron: tc.cron ?? "" });
  const minutes = num(tc.frequency);
  return minutes >= 60 && minutes % 60 === 0
    ? t("alerts.readBack.everyHours", { count: minutes / 60 })
    : t("alerts.readBack.everyMinutes", { count: minutes });
}

const holdText = (alert: { pending_period_sec?: number | string | null }, t: TranslateFn) => {
  const hold = num(alert.pending_period_sec);
  return hold > 0 ? t("alerts.readBack.hold", { duration: durationText(hold, t) }) : "";
};

const cooldownText = (silenceValue: unknown, t: TranslateFn) => {
  const silence = num(silenceValue);
  return silence > 0 ? t("alerts.readBack.cooldown", { duration: durationText(silence, t) }) : "";
};

/** One plain sentence for the whole alert: who hears, when, how often. Empty until a stream is picked. */
export function describeAlertInPlainWords(
  alert: ReadBackAlert,
  t: TranslateFn,
  opts: { aggregationEnabled?: boolean } = {},
): I18nText {
  if (!alert?.stream_name) return raw("");
  return t("alerts.readBack.sentence", {
    who: whoText(alert, t),
    what: whatText(alert, t, opts.aggregationEnabled ?? true),
    hold: holdText(alert, t),
    schedule: scheduleText(alert, t),
    cooldown: cooldownText(alert.trigger_condition?.silence, t),
  });
}

/** The composite counterpart: who hears and which combination of its alerts. Empty until there is an expression. */
export function describeCompositeInPlainWords(
  alert: ReadBackCompositeAlert,
  t: TranslateFn,
): I18nText {
  const expression = alert?.composite_condition?.expression?.trim();
  if (!expression) return raw("");
  return t("alerts.readBack.composite", {
    who: whoText(alert, t),
    expression: nameResolvedExpression(expression, alert.children ?? []),
    hold: holdText(alert, t),
    cooldown: cooldownText(alert.trigger_condition?.silence, t),
  });
}

/** The rail's verdict as a sentence, from the counts the preview already computed. */
export function previewVerdictSentence(
  verdict: PreviewVerdict,
  alert: ReadBackAlert,
  t: TranslateFn,
  opts: { countsEvents?: boolean } = {},
): I18nText {
  const tc = alert.trigger_condition ?? {};
  if (verdict.count === undefined) {
    return t(verdict.wouldTrigger ? "alerts.verdict.firesReason" : "alerts.verdict.quietReason", {
      reason: verdict.reason,
    });
  }
  const limit = limitText(tc.operator, tc.threshold ?? 0);
  if (verdict.grouped) {
    if (verdict.wouldTrigger) {
      return t("alerts.verdict.groupsFire", { count: verdict.count }, verdict.count);
    }
    return t("alerts.verdict.groupsQuiet", { count: verdict.count, limit }, verdict.count);
  }
  const countsEvents =
    opts.countsEvents ??
    (alert.query_condition?.type === "custom" && !alert.query_condition?.aggregation);
  const label = countsEvents ? t("alerts.verdict.events", verdict.count) : raw(verdict.label ?? "");
  return t(verdict.wouldTrigger ? "alerts.verdict.fires" : "alerts.verdict.quiet", {
    count: verdict.count,
    label,
    window: t("alerts.verdict.window", { n: num(tc.period) }),
    limit,
  });
}
