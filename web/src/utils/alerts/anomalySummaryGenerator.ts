// Copyright 2026 OpenObserve Inc.
/**
 * Anomaly Detection Summary Generator
 * Generates human-readable summaries of anomaly detection configurations
 */

export function generateAnomalySummary(
  config: any,
  destinations: any[],
  t?: (key: string) => string,
  wizardStep: number = 3,
): string {
  if (!config || !config.stream_name) return '';

  const parts: string[] = [];

  // Step 1+: Stream & query info
  if (wizardStep >= 1) {
    const displayStreamType =
      (config.stream_type || 'logs').charAt(0).toUpperCase() +
      (config.stream_type || 'logs').slice(1);
    parts.push(
      `✓ Data Source: <span class="summary-clickable">${displayStreamType}</span> — <span class="summary-clickable">${config.stream_name}</span>`,
    );

    const queryModeLabel =
      config.query_mode === 'custom_sql' ? 'Custom SQL' : 'Filters';
    parts.push(
      `✓ Query Mode: <span class="summary-clickable">${queryModeLabel}</span>`,
    );

    if (config.query_mode === 'filters' && config.detection_function) {
      parts.push(
        `✓ Detection Function: <span class="summary-clickable">${config.detection_function}</span>`,
      );
    }
  }

  // Step 2+: Detection config
  if (wizardStep >= 2) {
    const resolution = `${config.histogram_interval_value}${config.histogram_interval_unit}`;
    parts.push(
      `✓ Resolution: <span class="summary-clickable">${resolution}</span>`,
    );

    const schedule = `${config.schedule_interval_value}${config.schedule_interval_unit}`;
    parts.push(
      `✓ Schedule: every <span class="summary-clickable">${schedule}</span>`,
    );

    const win = `${config.detection_window_value}${config.detection_window_unit}`;
    parts.push(
      `✓ Detection Window: last <span class="summary-clickable">${win}</span>`,
    );

    const seasonality =
      (config.training_window_days || 14) >= 7
        ? 'hour + day-of-week'
        : 'hour-of-day';
    parts.push(
      `✓ Training: <span class="summary-clickable">${config.training_window_days} days</span> (${seasonality})`,
    );

    const retrain =
      config.retrain_interval_days === 0
        ? 'Never'
        : `every ${config.retrain_interval_days}d`;
    parts.push(
      `✓ Retrain: <span class="summary-clickable">${retrain}</span>`,
    );

    const anomalyRate = 100 - (config.threshold ?? 97);
    parts.push(
      `✓ Threshold: <span class="summary-clickable">${anomalyRate}% anomaly rate</span>`,
    );
  }

  // Step 3+: Alerting
  if (wizardStep >= 3) {
    if (!config.alert_enabled) {
      parts.push(
        `✓ Alerting: <span class="summary-clickable">Disabled</span>`,
      );
    } else {
      const dest = destinations?.find(
        (d: any) =>
          d.value === config.alert_destination_id ||
          d.id === config.alert_destination_id ||
          d.name === config.alert_destination_id,
      );
      const destName = dest?.name ?? dest?.label ?? config.alert_destination_id;
      if (destName) {
        parts.push(
          `✓ Alerting: Enabled → <span class="summary-clickable">${destName}</span>`,
        );
      } else {
        parts.push(
          `✓ Alerting: Enabled ⚠️ <span class="summary-clickable">No destination set</span>`,
        );
      }
    }
  }

  const bulletPoints = parts.join('\n');
  const plainEnglish = generatePlainEnglish(config, wizardStep);

  if (plainEnglish) {
    return `<div class="plain-english-section">"${plainEnglish}"</div>\n${bulletPoints}`;
  }

  return bulletPoints;
}

function generatePlainEnglish(config: any, wizardStep: number): string {
  if (!config.stream_name) return '';

  const stream = config.stream_name;
  const fn = config.detection_function || 'count';
  const schedule = `${config.schedule_interval_value}${config.schedule_interval_unit}`;
  const trainingDays = config.training_window_days || 14;

  if (wizardStep < 2) {
    return `Configuring anomaly detection for ${config.stream_type || 'logs'} stream "${stream}"`;
  }

  return `Monitor "${stream}" every ${schedule} for ${fn} anomalies, trained on ${trainingDays} days of history`;
}
