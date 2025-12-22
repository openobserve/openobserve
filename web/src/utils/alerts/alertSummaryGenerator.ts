/**
 * Alert Summary Generator
 * Generates human-readable paragraph summaries of alert configurations with clickable segments
 */

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
 * @param wizardStep - Current wizard step (1-6), used to show progressive summary
 * @param previewQuery - The formatted preview query string
 * @param generatedSqlQuery - The generated SQL query for custom conditions (computed property)
 */
export function generateAlertSummary(formData: any, destinations: any[], t?: (key: string) => string, wizardStep: number = 6, previewQuery: string = '', generatedSqlQuery: string = ''): string {
  // Generate summary based on available data (progressive disclosure)
  if (!formData) {
    return '';
  }

  // At minimum, we need stream_name to show any summary
  if (!formData.stream_name) {
    return '';
  }

  // Default translation function if not provided (fallback for backward compatibility)
  const translate = t || ((key: string) => {
    const fallbacks: Record<string, string> = {
      'alerts.summary.monitors': 'Monitors',
      'alerts.summary.from': 'from',
      'alerts.summary.inRealTime': 'in real-time',
      'alerts.summary.ofData': 'of data',
      'alerts.summary.triggersWhen': 'Triggers when',
      'alerts.summary.queryConditions': 'query conditions',
      'alerts.summary.areMet': 'are met',
      'alerts.summary.eventsDetected': 'events detected',
      'alerts.summary.sendsTo': 'Sends to',
      'alerts.summary.noDestination': 'No destination',
      'alerts.summary.notSetupYet': '(not set up yet)',
      'alerts.summary.cooldown': 'Cooldown',
      'alerts.summary.betweenAlerts': 'between alerts',
      'alerts.summary.alertName': 'Alert Name',
      'alerts.summary.streamInfo': 'Data Source',
      'alerts.summary.alertType': 'Alert Type',
      'alerts.summary.queryCondition': 'Query Condition',
    };
    return fallbacks[key] || key;
  });

  const parts: string[] = [];
  const isRealTime = formData.is_real_time === 'true' || formData.is_real_time === true;

  // Helper function to wrap text with clickable span
  const clickable = (text: string, fieldId: string) => {
    return `<span class="summary-clickable" data-focus-target="${fieldId}">${text}</span>`;
  };

  // Build the bullet-point summary based on wizard step
  const streamType = formData.stream_type || 'logs';
  const streamName = formData.stream_name || 'the selected stream';

  // Step 1: Show basic alert info (stream type, stream name, alert type)
  if (wizardStep >= 1) {
    // Capitalize stream type for better display
    const displayStreamType = streamType.charAt(0).toUpperCase() + streamType.slice(1);
    parts.push(`✓ ${translate('alerts.summary.streamInfo')}: ${clickable(displayStreamType, 'streamType')} - ${clickable(streamName, 'stream')}`);
    if (isRealTime) {
      parts.push(`✓ ${translate('alerts.summary.alertType')}: ${clickable('Real-Time', 'alertType')}`);
    } else {
      parts.push(`✓ ${translate('alerts.summary.alertType')}: ${clickable('Scheduled', 'alertType')}`);
    }
  }

  // Step 2+: Show query condition (from step 2 onwards)
  if (wizardStep >= 2) {
    let queryText = '';

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
      const truncatedQuery = queryText.length > maxLength
        ? queryText.substring(0, maxLength) + '...'
        : queryText;

      // Create clickable span with query
      const queryLabel = translate('alerts.summary.queryCondition');
      parts.push(`✓ ${queryLabel}: <span class="summary-clickable" data-focus-target="query">${truncatedQuery}</span>`);
    }
  }

  // Step 4+: Show alert settings (threshold, period, frequency, cooldown, destinations)
  if (wizardStep >= 4) {
    if (isRealTime) {
      // Real-time alert summary
      parts.push(`✓ ${translate('alerts.summary.triggersWhen')}: ${clickable(translate('alerts.summary.queryConditions'), 'conditions')} ${translate('alerts.summary.areMet')}`);
    } else {
      // Scheduled alert summary
      if (formData.trigger_condition?.period) {
        let period: string;
        let fieldId: string;
        // Check if multi-time range comparison is enabled
        if (formData.query_condition?.multi_time_range && formData.query_condition.multi_time_range.length > 0) {
          period = getMultiTimeRangeText(formData.query_condition.multi_time_range, formData.trigger_condition.period);
          fieldId = 'multiwindow'; // Focus on Compare with Past section
        } else {
          period = getPeriodText(formData.trigger_condition.period, translate);
          fieldId = 'period'; // Focus on period field
        }
        parts.push(`✓ ${translate('alerts.summary.monitors')}: ${clickable(period, fieldId)} ${translate('alerts.summary.ofData')}`);
      }

      // Trigger condition
      if (formData.query_condition && formData.trigger_condition?.operator && formData.trigger_condition?.threshold !== undefined) {
        const threshold = formData.trigger_condition.threshold;
        const operator = formData.trigger_condition.operator;
        const operatorText = getOperatorSymbol(operator, translate);

        parts.push(`✓ ${translate('alerts.summary.triggersWhen')}: ${clickable(`${threshold} ${operatorText}`, 'threshold')} ${translate('alerts.summary.eventsDetected')}`);
      }
    }

    // Notification section
    if (!destinations || destinations.length === 0) {
      parts.push(`✓ ${translate('alerts.summary.sendsTo')}: ${clickable(translate('alerts.summary.noDestination'), 'destinations')} ${translate('alerts.summary.notSetupYet')} ⚠️`);
    } else {
      const destNames = destinations.map(dest => {
        if (typeof dest === 'string') return dest;
        return dest.name || 'Unknown';
      });
      const uniqueNames = Array.from(new Set(destNames));
      const destText = uniqueNames.join(', ');
      parts.push(`✓ ${translate('alerts.summary.sendsTo')}: ${clickable(destText, 'destinations')}`);
    }

    // Cooldown section (only if configured and not real-time)
    if (!isRealTime && formData.trigger_condition?.silence !== undefined && formData.trigger_condition?.silence >= 0) {
      const timeText = getSilenceText(formData.trigger_condition.silence, translate);
      parts.push(`✓ ${translate('alerts.summary.cooldown')}: ${clickable(timeText, 'silence')} ${translate('alerts.summary.betweenAlerts')}`);
    }
  }

  // Add plain English summary (only from step 4 onwards)
  if (wizardStep >= 4) {
    const plainEnglish = generatePlainEnglishSummary(formData, destinations, isRealTime, translate);
    if (plainEnglish) {
      parts.push('');
      parts.push(`<div class="plain-english-section">"${plainEnglish}"</div>`);
    }
  }

  return parts.join('\n');
}

/**
 * Get operator symbol for readable text
 */
function getOperatorSymbol(operator: string, t: (key: string) => string): string {
  const operatorMap: { [key: string]: string } = {
    '=': `(=) ${t('alerts.summary.equalTo') || 'equal to'}`,
    '!=': `(≠) ${t('alerts.summary.notEqualTo') || 'not equal to'}`,
    '>': `(>) ${t('alerts.summary.orMore') || 'or more'}`,
    '>=': `(≥) ${t('alerts.summary.orMore') || 'or more'}`,
    '<': `(<) ${t('alerts.summary.orLess') || 'or less'}`,
    '<=': `(≤) ${t('alerts.summary.orLess') || 'or less'}`,
  };

  return operatorMap[operator] || operator;
}

/**
 * Get period text (e.g., "the last 30 minutes", "the last 1 hour")
 */
function getPeriodText(period: number, t: (key: string) => string): string {
  if (!period) return 'recent data';

  const minutes = period;
  const minuteText = t('alerts.summary.minute') || 'minute';
  const minutesText = t('alerts.summary.minutes') || 'minutes';
  const hourText = t('alerts.summary.hour') || 'hour';
  const hoursText = t('alerts.summary.hours') || 'hours';

  if (minutes < 60) {
    return minutes === 1 ? `the last ${minuteText}` : `the last ${minutes} ${minutesText}`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? `the last ${hourText}` : `the last ${hours} ${hoursText}`;
  }

  const days = Math.floor(hours / 24);
  return days === 1 ? 'the last day' : `the last ${days} days`;
}

/**
 * Get multi-window time range text (e.g., "3 time ranges (30m, 1h, 2h)")
 * Includes current window period plus all comparison windows
 */
function getMultiTimeRangeText(timeRanges: any[], currentPeriod: number): string {
  if (!timeRanges || timeRanges.length === 0) return '';

  // Parse offSet strings (e.g., "3d", "1h", "30m", "2w", "1M") to minutes
  const parseOffSet = (offSet: string): number => {
    const match = offSet.match(/^(\d+)([mhdwM])$/);
    if (!match) return 0;

    const value = parseInt(match[1]);
    const unit = match[2];

    if (unit === 'm') return value;
    if (unit === 'h') return value * 60;
    if (unit === 'd') return value * 24 * 60;
    if (unit === 'w') return value * 7 * 24 * 60;
    if (unit === 'M') return value * 30 * 24 * 60; // Approximate month as 30 days
    return 0;
  };

  // Create array with current period first, then comparison windows
  const comparisonPeriods = timeRanges.map(r => parseOffSet(r.offSet || '0m'));
  const allPeriods = [currentPeriod, ...comparisonPeriods];

  const count = allPeriods.length;
  const rangeTexts = allPeriods.map(period => {
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

  const rangeList = rangeTexts.join(', ');
  return `${count} time ${count === 1 ? 'range' : 'ranges'} (${rangeList})`;
}

/**
 * Get silence/cooldown text (e.g., "10 minutes", "2 hours")
 */
function getSilenceText(silence: number, t: (key: string) => string): string {
  const noCooldown = t('alerts.summary.noCooldown') || 'No cooldown';
  const minuteText = t('alerts.summary.minute') || 'minute';
  const minutesText = t('alerts.summary.minutes') || 'minutes';
  const hourText = t('alerts.summary.hour') || 'hour';
  const hoursText = t('alerts.summary.hours') || 'hours';

  if (silence === 0) return noCooldown;
  if (silence === 1) return `1 ${minuteText}`;
  if (silence < 60) return `${silence} ${minutesText}`;

  const hours = Math.floor(silence / 60);
  const remainingMinutes = silence % 60;

  if (remainingMinutes === 0) {
    return hours === 1 ? `1 ${hourText}` : `${hours} ${hoursText}`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Generate a plain English summary of the alert
 */
function generatePlainEnglishSummary(formData: any, destinations: any[], isRealTime: boolean, t: (key: string) => string): string {
  if (!formData || !formData.stream_name) return '';

  const parts: string[] = [];
  const eventsPlural = t('alerts.summary.plainEnglish.eventsPlural') || 'events';
  const eventSingular = t('alerts.summary.plainEnglish.eventSingular') || 'event';
  const minuteText = t('alerts.summary.minute') || 'minute';
  const minutesText = t('alerts.summary.minutes') || 'minutes';
  const hourText = t('alerts.summary.hour') || 'hour';
  const hoursText = t('alerts.summary.hours') || 'hours';

  if (isRealTime) {
    parts.push(t('alerts.summary.plainEnglish.realTime') || 'Alert me immediately when matching events occur in real-time');
  } else {
    // Get threshold and operator
    const threshold = formData.trigger_condition?.threshold;
    const operator = formData.trigger_condition?.operator;
    const period = formData.trigger_condition?.period;

    if (threshold !== undefined && operator && period) {
      // Build the condition phrase
      let conditionPhrase = '';

      if (operator === '>=') {
        conditionPhrase = `${threshold}+ ${eventsPlural}`;
      } else if (operator === '>') {
        const moreThan = t('alerts.summary.plainEnglish.moreThan') || 'more than';
        conditionPhrase = `${moreThan} ${threshold} ${eventsPlural}`;
      } else if (operator === '=') {
        const exactly = t('alerts.summary.plainEnglish.exactly') || 'exactly';
        conditionPhrase = `${exactly} ${threshold} ${threshold !== 1 ? eventsPlural : eventSingular}`;
      } else if (operator === '<=') {
        const orFewer = t('alerts.summary.plainEnglish.orFewer') || 'or fewer';
        conditionPhrase = `${threshold} ${orFewer} ${eventsPlural}`;
      } else if (operator === '<') {
        const fewerThan = t('alerts.summary.plainEnglish.fewerThan') || 'fewer than';
        conditionPhrase = `${fewerThan} ${threshold} ${eventsPlural}`;
      } else if (operator === '!=') {
        const not = t('alerts.summary.plainEnglish.not') || 'not';
        conditionPhrase = `${not} ${threshold} ${eventsPlural}`;
      } else {
        conditionPhrase = `${threshold} ${eventsPlural} (${operator})`;
      }

      // Build the time period phrase
      let periodPhrase = '';
      if (period < 60) {
        periodPhrase = period === 1 ? `1-${minuteText}` : `${period}-${minuteText}`;
      } else {
        const hours = Math.floor(period / 60);
        periodPhrase = hours === 1 ? `1-${hourText}` : `${hours}-${hourText}`;
      }

      const occurInAny = t('alerts.summary.plainEnglish.occurInAny') || 'occur in any';
      const periodWord = t('alerts.summary.plainEnglish.period') || 'period';
      const alertMeWhen = t('alerts.summary.plainEnglish.alertMeWhen') || 'Alert me when';
      parts.push(`${alertMeWhen} ${conditionPhrase} ${occurInAny} ${periodPhrase} ${periodWord}`);

      // Add cooldown phrase if configured
      const silence = formData.trigger_condition?.silence;
      if (silence && silence > 0) {
        const butNoMoreThan = t('alerts.summary.plainEnglish.butNoMoreThan') || ', but no more than once every';
        if (silence < 60) {
          const silenceText = silence === 1 ? `1 ${minuteText}` : `${silence} ${minutesText}`;
          parts.push(`${butNoMoreThan} ${silenceText}`);
        } else {
          const hours = Math.floor(silence / 60);
          const hoursCount = hours === 1 ? `1 ${hourText}` : `${hours} ${hoursText}`;
          parts.push(`${butNoMoreThan} ${hoursCount}`);
        }
      }
    } else {
      parts.push(t('alerts.summary.plainEnglish.defaultConditions') || 'Alert me when the configured conditions are met');
    }
  }

  return parts.join('');
}
