// Copyright 2026 OpenObserve Inc.
/**
 * Anomaly Detection Summary Generator
 * Generates human-readable summaries of anomaly detection configurations
 */

import { type TranslateFn } from "@/types/i18n";
import {
  ANOMALY_DIRECTION_KEYS,
  anomalyExpectedGroupingKey,
  anomalyIntervalSeconds,
  anomalyWindowShareEffective,
} from "@/components/anomaly_detection/steps/AnomalyDetectionConfig.schema";

// Escape user-controlled strings before embedding in HTML (XSS prevention) —
// mirrors alertSummaryGenerator.ts's esc(), so both generators emit HTML that
// is already safe rather than leaving escaping to whoever calls v-html.
const esc = (s: string) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function generateAnomalySummary(
  config: any,
  destinations: any[],
  t: TranslateFn,
  wizardStep: number = 3,
): string {
  if (!config || !config.stream_name) return "";

  const parts: string[] = [];

  // The markup stays here rather than in en-US.json: translators get whole
  // sentences with {placeholders} and never have to preserve a tag.
  const chip = (value: string | number) =>
    `<span class="summary-clickable">${esc(String(value))}</span>`;

  // Step 1+: Stream & query info
  if (wizardStep >= 1) {
    const displayStreamType =
      (config.stream_type || "logs").charAt(0).toUpperCase() +
      (config.stream_type || "logs").slice(1);
    parts.push(
      t("alerts.anomaly.summaryDataSource", {
        type: chip(displayStreamType),
        name: chip(config.stream_name),
      }),
    );

    const queryModeLabel =
      config.query_mode === "custom_sql" ? t("alerts.customSql") : t("alerts.anomaly.filters");
    parts.push(t("alerts.anomaly.summaryQueryMode", { mode: chip(queryModeLabel) }));

    if (config.query_mode === "filters" && config.detection_function) {
      parts.push(
        t("alerts.anomaly.summaryDetectionFunction", { fn: chip(config.detection_function) }),
      );
    }
  }

  // Step 2+: Detection config
  if (wizardStep >= 2) {
    const resolution = `${config.histogram_interval_value}${config.histogram_interval_unit}`;
    parts.push(t("alerts.anomaly.summaryResolution", { resolution: chip(resolution) }));

    const schedule = `${config.schedule_interval_value}${config.schedule_interval_unit}`;
    parts.push(t("alerts.anomaly.summarySchedule", { schedule: chip(schedule) }));

    const win = `${config.detection_window_value}${config.detection_window_unit}`;
    parts.push(t("alerts.anomaly.summaryDetectionWindow", { window: chip(win) }));

    const seasonality = t(
      anomalyExpectedGroupingKey(
        anomalyIntervalSeconds(
          Number(config.histogram_interval_value),
          String(config.histogram_interval_unit),
        ),
      ) as any,
    );
    parts.push(
      t("alerts.anomaly.summaryTraining", {
        days: chip(t("alerts.anomaly.summaryTrainingDays", { days: config.training_window_days })),
        seasonality,
      }),
    );

    const retrain =
      config.retrain_interval_days === 0
        ? t("alerts.anomaly.retrainNever")
        : t("alerts.anomaly.summaryRetrainEveryDays", { days: config.retrain_interval_days });
    parts.push(t("alerts.anomaly.summaryRetrain", { retrain: chip(retrain) }));

    const budget = Number(config.alert_budget_per_day);
    if (Number.isFinite(budget) && budget > 0) {
      // Budget mode: the enforced cap IS the sensitivity statement.
      const round = (n: number) => Math.round(n * 1e6) / 1e6;
      const label =
        budget < 1
          ? t("alerts.anomaly.summaryBudgetPerWeek", { count: round(budget * 7) })
          : t("alerts.anomaly.summaryBudgetPerDay", { count: round(budget) });
      parts.push(t("alerts.anomaly.summaryThreshold", { threshold: chip(label) }));
    } else {
      // A cleared field reaches here as "", and Number("")/Number(null) are
      // both 0, so blanks need excluding before any number is shown.
      const blankToNaN = (v: unknown) =>
        v === null || v === undefined || v === "" ? NaN : Number(v);
      const bandWidth = blankToNaN(config.band_width);
      const percentile = blankToNaN(config.threshold);
      if (Number.isFinite(bandWidth)) {
        parts.push(
          t("alerts.anomaly.summaryThreshold", {
            threshold: chip(`${bandWidth}σ`),
          }),
        );
      } else if (Number.isFinite(percentile)) {
        // The stored percentile indexes TRAINING scores; never restate it as
        // a live anomaly rate — that arithmetic was measured false.
        parts.push(
          t("alerts.anomaly.summaryThreshold", {
            threshold: chip(t("alerts.anomaly.summaryThresholdPercentile", { percentile })),
          }),
        );
      }
    }
  }

  // Step 3+: Alerting
  if (wizardStep >= 3) {
    if (!config.alert_enabled) {
      parts.push(
        t("alerts.anomaly.summaryAlerting", { status: chip(t("alerts.anomaly.disabled")) }),
      );
    } else {
      const ids: string[] = Array.isArray(config.alert_destination_ids)
        ? config.alert_destination_ids
        : config.alert_destination_id
          ? [config.alert_destination_id]
          : [];
      const destNames = ids
        .map((id: string) => {
          const d = destinations?.find((d: any) => d.value === id || d.id === id || d.name === id);
          return d?.name ?? d?.label ?? id;
        })
        .filter(Boolean);
      if (destNames.length > 0) {
        parts.push(
          t("alerts.anomaly.summaryAlertingEnabled", { destinations: chip(destNames.join(", ")) }),
        );
      } else {
        parts.push(
          t("alerts.anomaly.summaryAlertingNoDestination", {
            warning: chip(t("alerts.anomaly.summaryNoDestinationSet")),
          }),
        );
      }
    }
    // The gates are configured whether or not notifications are on, so they show either way.
    const directionKey =
      ANOMALY_DIRECTION_KEYS[config.alert_direction] ?? ANOMALY_DIRECTION_KEYS.both;
    parts.push(t("alerts.anomaly.summaryDirection", { direction: chip(t(directionKey as any)) }));
    parts.push(
      t("alerts.anomaly.summaryWindowShare", {
        rule: chip(t("alerts.anomaly.windowShareCompact", anomalyWindowShareEffective(config))),
      }),
    );
  }

  const bulletPoints = parts.join("\n");
  const plainEnglish = generatePlainEnglish(config, wizardStep, t);

  if (plainEnglish) {
    return `<div class="plain-english-section">"${plainEnglish}"</div>\n${bulletPoints}`;
  }

  return bulletPoints;
}

function generatePlainEnglish(config: any, wizardStep: number, t: TranslateFn): string {
  if (!config.stream_name) return "";

  const stream = esc(config.stream_name);
  const fn = esc(config.detection_function || "count");
  const schedule = esc(`${config.schedule_interval_value}${config.schedule_interval_unit}`);
  const trainingDays = config.training_window_days || 28;

  if (wizardStep < 2) {
    return t("alerts.anomaly.summaryConfiguring", {
      streamType: esc(config.stream_type || "logs"),
      stream,
    });
  }

  return t("alerts.anomaly.summaryMonitoring", { stream, schedule, fn, trainingDays });
}
