/**
 * Alert Summary Generator
 * Generates human-readable paragraph summaries of alert configurations with clickable segments
 */

import { gt } from "@/types/i18n";

/**
 * Translator accepted by the summary helpers.
 *
 * The optional arguments mirror `TranslateFn` from `@/types/i18n`: named
 * interpolation values, then a plural choice. Both are load-bearing here — every
 * sentence this file produces is ONE message with its values interpolated into
 * it, never a phrase concatenated out of translated words, because word order
 * and plural forms are the translator's to choose.
 */
type SummaryTranslate = (key: string, named?: Record<string, unknown>, plural?: number) => string;

export interface SummarySegment {
  text: string;
  fieldId?: string; // Optional field ID for clickable segments
  isClickable?: boolean;
}

/**
 * Generates a natural language summary of the alert configuration
 * Returns HTML string with clickable spans that have data-focus-target attributes
 * @param formData - The alert form data
 * @param destinations - Array of destination objects
 * @param t - Translation function (optional, for i18n support)
 * @param wizardStep - Deprecated; unused.
 * @param previewQuery - The formatted preview query string
 * @param generatedSqlQuery - The generated SQL query for custom conditions (computed property)
 */
export function generateAlertSummary(
  formData: any,
  destinations: any[],
  t?: SummaryTranslate,
  _wizardStep: number = 6,
  previewQuery: string = "",
  generatedSqlQuery: string = "",
): string {
  // Generate summary based on available data
  if (!formData) {
    return "";
  }

  // At minimum, we need stream_name to show any summary
  if (!formData.stream_name) {
    return "";
  }

  // Default translation function if not provided. `gt` rather than a table of
  // English fallbacks: this module is Vue-less, so it cannot call `useI18n()`, and
  // `gt` is exactly the sanctioned escape hatch for that. It also covers EVERY key
  // (the old table covered a third of them and echoed the raw key for the rest) and
  // does so in the user's locale instead of always in English.
  const translate: SummaryTranslate = t ?? gt;

  const parts: string[] = [];
  const isRealTime = formData.is_real_time === "true" || formData.is_real_time === true;

  // Escape user-controlled strings before embedding in HTML (XSS prevention)
  const esc = (s: string) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  // Helper function to wrap text with clickable span
  const clickable = (text: string, fieldId: string) => {
    return `<span class="summary-clickable" data-focus-target="${fieldId}">${esc(text)}</span>`;
  };

  // Build the bullet-point summary
  const streamType = formData.stream_type || "logs";
  // Guaranteed non-empty by the early return above.
  const streamName = formData.stream_name;

  // Basic alert info (stream type, stream name, alert type)
  const displayStreamType = streamType.charAt(0).toUpperCase() + streamType.slice(1);
  parts.push(
    `✓ ${translate("alerts.summary.streamInfo")}: ${clickable(displayStreamType, "streamType")} - ${clickable(streamName, "stream")}`,
  );
  if (isRealTime) {
    parts.push(
      `✓ ${translate("alerts.summary.alertType")}: ${clickable(translate("alerts.summary.alertTypeRealTime"), "alertType")}`,
    );
  } else {
    parts.push(
      `✓ ${translate("alerts.summary.alertType")}: ${clickable(translate("alerts.summary.alertTypeScheduled"), "alertType")}`,
    );
  }

  // Show query condition
  let queryText = "";

  // Get query from different sources
  if (previewQuery && previewQuery.trim()) {
    // Use previewQuery if available (already formatted by previewAlert)
    queryText = previewQuery;
  } else if (generatedSqlQuery && generatedSqlQuery.trim()) {
    // For custom mode, use the generated SQL query from computed property
    queryText = generatedSqlQuery;
  } else if (formData.query_condition) {
    // Fall back to extracting from formData
    if (formData.query_condition.sql) {
      queryText = formData.query_condition.sql.trim();
    } else if (formData.query_condition.promql) {
      queryText = formData.query_condition.promql.trim();
    }
  }

  if (queryText) {
    // Truncate if longer than 50 characters
    const maxLength = 48;
    const truncatedQuery =
      queryText.length > maxLength ? queryText.substring(0, maxLength) + "..." : queryText;

    // Create clickable span with query
    const queryLabel = translate("alerts.summary.queryCondition");
    parts.push(
      `✓ ${queryLabel}: <span class="summary-clickable" data-focus-target="query">${esc(truncatedQuery)}</span>`,
    );
  }

  // Show alert settings (threshold, period, frequency, cooldown, destinations)
  if (isRealTime) {
    // Real-time alert summary - triggers immediately when query conditions match
    parts.push(
      `✓ ${translate("alerts.summary.triggersWhen")}: ${translate("alerts.summary.eventsDetected")} ${translate("alerts.summary.inRealTime")}`,
    );
  } else {
    // Scheduled alert summary
    if (formData.trigger_condition?.period) {
      let period: string;
      let fieldId: string;
      // Check if multi-time range comparison is enabled
      if (
        formData.query_condition?.multi_time_range &&
        formData.query_condition.multi_time_range.length > 0
      ) {
        period = getMultiTimeRangeText(
          formData.query_condition.multi_time_range,
          formData.trigger_condition.period,
          translate,
        );
        fieldId = "multiwindow"; // Focus on Compare with Past section
      } else {
        period = getPeriodText(formData.trigger_condition.period, translate);
        fieldId = "period"; // Focus on period field
      }
      parts.push(
        `✓ ${translate("alerts.summary.monitors")}: ${clickable(period, fieldId)} ${translate("alerts.summary.ofData")}`,
      );
    }

    // Trigger condition (only for scheduled alerts - real-time doesn't use threshold)
    if (
      formData.query_condition &&
      formData.trigger_condition?.operator &&
      formData.trigger_condition?.threshold !== undefined
    ) {
      const threshold = formData.trigger_condition.threshold;
      const operator = formData.trigger_condition.operator;
      const operatorText = getOperatorSymbol(operator, translate);

      parts.push(
        `✓ ${translate("alerts.summary.triggersWhen")}: ${clickable(`${threshold} ${operatorText}`, "threshold")} ${translate("alerts.summary.eventsDetected")}`,
      );
    }
  }

  // Notification section — use formData.destinations (selected), not destinations param (all available)
  const selectedDestinations: string[] = formData.destinations || [];
  if (selectedDestinations.length === 0) {
    parts.push(
      `✓ ${translate("alerts.summary.sendsTo")}: ${clickable(translate("alerts.summary.noDestination"), "destinations")} ${translate("alerts.summary.notSetupYet")} ⚠️`,
    );
  } else {
    const uniqueNames = Array.from(new Set(selectedDestinations));
    const destText = uniqueNames.join(", ");
    parts.push(`✓ ${translate("alerts.summary.sendsTo")}: ${clickable(destText, "destinations")}`);
  }

  // Cooldown section (only if configured and not real-time)
  if (
    !isRealTime &&
    formData.trigger_condition?.silence !== undefined &&
    formData.trigger_condition?.silence >= 0
  ) {
    const timeText = getSilenceText(formData.trigger_condition.silence, translate);
    parts.push(
      `✓ ${translate("alerts.summary.cooldown")}: ${clickable(timeText, "silence")} ${translate("alerts.summary.betweenAlerts")}`,
    );
  }

  // Build the final summary with plain English first, then bullet points
  const bulletPoints = parts.join("\n");

  // Add plain English summary first (show from step 1 onwards for better UX)
  const plainEnglish = generatePlainEnglishSummary(formData, destinations, isRealTime, translate);
  if (plainEnglish) {
    // Return plain English first, then bullet points (with single line break for tighter spacing)
    return `<div class="plain-english-section">"${esc(plainEnglish)}"</div>\n${bulletPoints}`;
  }

  return bulletPoints;
}

/**
 * Get operator symbol for readable text
 */
function getOperatorSymbol(operator: string, t: SummaryTranslate): string {
  // `|| "equal to"` was dead: a missing key resolves to the key path, which is
  // truthy, so the English never showed. The gloss is a whole message either way.
  const operatorMap: { [key: string]: string } = {
    "=": `(=) ${t("alerts.summary.equalTo")}`,
    "!=": `(≠) ${t("alerts.summary.notEqualTo")}`,
    ">": `(>) ${t("alerts.summary.orMore")}`,
    ">=": `(≥) ${t("alerts.summary.orMore")}`,
    "<": `(<) ${t("alerts.summary.orLess")}`,
    "<=": `(≤) ${t("alerts.summary.orLess")}`,
  };

  return operatorMap[operator] || operator;
}

/**
 * Get period text (e.g., "the last 30 minutes", "the last 1 hour")
 */
function getPeriodText(period: number, t: SummaryTranslate): string {
  if (!period) return t("alerts.recentData");

  const minutes = period;

  if (minutes < 60) return t("alerts.summary.theLastMinute", { count: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("alerts.summary.theLastHour", { count: hours });

  return t("alerts.theLastDay", { count: Math.floor(hours / 24) });
}

/**
 * Get multi-window time range text (e.g., "3 time ranges (30m, 1h, 2h)")
 * Includes current window period plus all comparison windows
 */
function getMultiTimeRangeText(
  timeRanges: any[],
  currentPeriod: number,
  t: SummaryTranslate,
): string {
  if (!timeRanges || timeRanges.length === 0) return "";

  // Parse offSet strings (e.g., "3d", "1h", "30m", "2w", "1M") to minutes
  const parseOffSet = (offSet: string): number => {
    const match = offSet.match(/^(\d+)([mhdwM])$/);
    if (!match) return 0;

    const value = parseInt(match[1]);
    const unit = match[2];

    if (unit === "m") return value;
    if (unit === "h") return value * 60;
    if (unit === "d") return value * 24 * 60;
    if (unit === "w") return value * 7 * 24 * 60;
    if (unit === "M") return value * 30 * 24 * 60; // Approximate month as 30 days
    return 0;
  };

  // Create array with current period first, then comparison windows
  const comparisonPeriods = timeRanges.map((r) => parseOffSet(r.offSet || "0m"));
  const allPeriods = [currentPeriod, ...comparisonPeriods];

  const count = allPeriods.length;
  const rangeTexts = allPeriods.map((period) => {
    if (period < 60) {
      return `${period}m`;
    }
    const hours = Math.floor(period / 60);
    if (hours < 24) {
      return `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    if (days < 7) {
      return `${days}d`;
    }
    const weeks = Math.floor(days / 7);
    if (weeks < 4) {
      return `${weeks}w`;
    }
    const months = Math.floor(days / 30);
    return `${months}M`;
  });

  const rangeList = rangeTexts.join(", ");
  return t("alerts.summary.timeRangeCount", { n: count, ranges: rangeList }, count);
}

/**
 * Get silence/cooldown text (e.g., "10 minutes", "2 hours")
 */
function getSilenceText(silence: number, t: SummaryTranslate): string {
  if (silence === 0) return t("alerts.summary.noCooldown");
  if (silence < 60) return minutesText(silence, t);

  const hours = Math.floor(silence / 60);
  const remainingMinutes = silence % 60;

  if (remainingMinutes === 0) return hoursText(hours, t);

  // A compact duration in unit SYMBOLS ("2h 30m") — the same token in every locale.
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * "1 minute" / "30 minutes", as a plural MESSAGE.
 *
 * `t(key, named, choice)` rather than `n === 1 ? singular : plural`: how many
 * forms a language has, and where the number sits in them, is the translation's
 * business. The explicit `choice` (1 or 2, never the raw value) preserves the
 * behaviour the ternary had for a non-numeric `n`, which the form can produce.
 */
function minutesText(n: number, t: SummaryTranslate): string {
  return t("alerts.summary.minuteCount", { n }, n === 1 ? 1 : 2);
}

/** "1 hour" / "2 hours". See {@link minutesText}. */
function hoursText(n: number, t: SummaryTranslate): string {
  return t("alerts.summary.hourCount", { n }, n === 1 ? 1 : 2);
}

/**
 * Generate a plain English summary of the alert
 */
function generatePlainEnglishSummary(
  formData: any,
  destinations: any[],
  isRealTime: boolean,
  t: SummaryTranslate,
): string {
  if (!formData || !formData.stream_name) return "";

  const parts: string[] = [];

  // Show full alert logic
  if (isRealTime) {
    parts.push(t("alerts.summary.plainEnglish.realTime"));
  } else {
    // Get threshold and operator
    const threshold = formData.trigger_condition?.threshold;
    const operator = formData.trigger_condition?.operator;
    const period = formData.trigger_condition?.period;

    if (threshold !== undefined && operator && period) {
      // One whole message per operator, each carrying the threshold as a VALUE.
      // "more than 5 events" and "5 events or more" put the number in different
      // places, so the phrase cannot be assembled here out of a word and a number.
      const conditionKeys: Record<string, string> = {
        ">=": "alerts.summary.plainEnglish.conditionAtLeast",
        ">": "alerts.summary.plainEnglish.conditionMoreThan",
        "<=": "alerts.summary.plainEnglish.conditionOrFewer",
        "<": "alerts.summary.plainEnglish.conditionFewerThan",
        "!=": "alerts.summary.plainEnglish.conditionNot",
      };
      const conditionPhrase =
        operator === "="
          ? t(
              "alerts.summary.plainEnglish.conditionExactly",
              { threshold },
              threshold === 1 ? 1 : 2,
            )
          : conditionKeys[operator]
            ? t(conditionKeys[operator], { threshold })
            : t("alerts.summary.plainEnglish.conditionOther", { threshold, operator });

      // The window is part of the sentence rather than a fragment glued into it:
      // "10-minute" is an English compound, so minutes and hours get a message each.
      const inMinutes = period < 60;
      parts.push(
        t(
          inMinutes
            ? "alerts.summary.plainEnglish.alertMeWhenMinutes"
            : "alerts.summary.plainEnglish.alertMeWhenHours",
          {
            condition: conditionPhrase,
            count: inMinutes ? period : Math.floor(period / 60),
          },
        ),
      );

      // Add cooldown phrase if configured
      const silence = formData.trigger_condition?.silence;
      if (silence && silence > 0) {
        const cooldown =
          silence < 60 ? minutesText(silence, t) : hoursText(Math.floor(silence / 60), t);
        parts.push(t("alerts.summary.plainEnglish.cooldownClause", { cooldown }));
      }
    } else {
      parts.push(t("alerts.summary.plainEnglish.defaultConditions"));
    }
  }

  return parts.join("");
}
