// Copyright 2026 OpenObserve Inc.
/**
 * Anomaly Detection Summary Generator
 * Generates human-readable summaries of anomaly detection configurations
 */

import { raw, type TranslateFn } from "@/types/i18n";

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
  const chip = (value: string | number) => `<span class="summary-clickable">${value}</span>`;

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

    const seasonality =
      (config.training_window_days || 14) >= 7
        ? t("alerts.anomaly.seasonalityWeekly")
        : raw("hour-of-day");
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

    const anomalyRate = 100 - (config.threshold ?? 97);
    parts.push(
      t("alerts.anomaly.summaryThreshold", {
        threshold: chip(t("alerts.anomaly.summaryThresholdRate", { rate: anomalyRate })),
      }),
    );
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

  const stream = config.stream_name;
  const fn = config.detection_function || "count";
  const schedule = `${config.schedule_interval_value}${config.schedule_interval_unit}`;
  const trainingDays = config.training_window_days || 14;

  if (wizardStep < 2) {
    return t("alerts.anomaly.summaryConfiguring", {
      streamType: config.stream_type || "logs",
      stream,
    });
  }

  return t("alerts.anomaly.summaryMonitoring", { stream, schedule, fn, trainingDays });
}
