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
 */
export function generateAlertSummary(formData: any, destinations: any[]): string {
  if (!formData || !formData.stream_name) {
    return '';
  }

  const parts: string[] = [];
  const isRealTime = formData.is_real_time === 'true' || formData.is_real_time === true;

  // Helper function to wrap text with clickable span
  const clickable = (text: string, fieldId: string) => {
    return `<span class="summary-clickable" data-focus-target="${fieldId}">${text}</span>`;
  };

  // Build the complete summary with labeled sections
  const streamType = formData.stream_type || 'logs';
  const streamName = formData.stream_name || 'the selected stream';

  if (isRealTime) {
    // Real-time alert summary
    parts.push(`**Evaluation:** The alert monitors ${clickable(streamType, 'streamType')} from ${clickable(streamName, 'stream')} in real-time and continuously evaluates incoming data.`);
    parts.push(`**Trigger Condition:** The alert triggers when ${clickable('the query conditions', 'conditions')} are met.`);
  } else {
    // Scheduled alert summary
    const frequency = getFrequencyText(formData.trigger_condition);
    const period = getPeriodText(formData.trigger_condition?.period);

    // Evaluation section
    parts.push(`**Evaluation:** The alert evaluates ${clickable(frequency, 'frequency')} and analyzes data from ${clickable(period, 'period')}.`);

    // Trigger condition section
    if (formData.query_condition && formData.trigger_condition?.operator && formData.trigger_condition?.threshold !== undefined) {
      const operator = formData.trigger_condition.operator;
      const threshold = formData.trigger_condition.threshold;
      const operatorText = getOperatorSymbol(operator);
      const thresholdText = `${threshold} ${operatorText}`;

      // Check for multi-window time ranges
      const multiTimeRange = formData.query_condition?.multi_time_range;
      const hasMultiWindow = multiTimeRange && Array.isArray(multiTimeRange) && multiTimeRange.length > 0;

      let triggerText = `**Trigger Condition:** The alert triggers when ${clickable('the query', 'conditions')} returns ${clickable(thresholdText, 'threshold')} events within the evaluation window`;

      if (hasMultiWindow) {
        // Include current window period + comparison windows
        const currentPeriod = formData.trigger_condition?.period || 0;
        const timeRangeText = getMultiTimeRangeText(multiTimeRange, currentPeriod);
        triggerText += `, comparing across ${clickable(timeRangeText, 'multiwindow')}`;
      }

      parts.push(triggerText + '.');
    } else {
      parts.push(`**Trigger Condition:** The alert triggers when ${clickable('the query conditions', 'conditions')} are met.`);
    }
  }

  // Notification section
  if (!destinations || destinations.length === 0) {
    parts.push(`**Notification:** When triggered, the alert sends a notification to ${clickable('no destination', 'destinations')} (not configured yet).`);
  } else {
    const destNames = destinations.map(dest => {
      if (typeof dest === 'string') return dest;
      return dest.name || 'Unknown';
    });
    const uniqueNames = Array.from(new Set(destNames));
    const destText = uniqueNames.join(', ');

    parts.push(`**Notification:** When triggered, the alert sends a notification to ${clickable(destText, 'destinations')} destination.`);
  }

  // Silencing section (only if configured)
  const silence = formData.trigger_condition?.silence;
  if (silence && silence > 0) {
    let timeText = '';
    if (silence === 1) {
      timeText = '1 minute';
    } else if (silence < 60) {
      timeText = `${silence} minutes`;
    } else {
      const hours = Math.floor(silence / 60);
      timeText = hours === 1 ? '1 hour' : `${hours} hours`;
    }
    parts.push(`**Silencing:** After firing, the alert enters a ${clickable(timeText, 'silence')} silence period, during which it will not trigger again even if the condition remains true.`);
  }

  // Convert markdown bold (**text**) to HTML <strong> tags
  const result = parts.join('\n');
  return result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/**
 * Get operator symbol for readable text
 */
function getOperatorSymbol(operator: string): string {
  const operatorMap: { [key: string]: string } = {
    '=': '(=) equal to',
    '!=': '(≠) not equal to',
    '>': '(>) or more',
    '>=': '(≥) or more',
    '<': '(<) or less',
    '<=': '(≤) or less',
  };

  return operatorMap[operator] || operator;
}

/**
 * Get frequency text (e.g., "every 5 minutes", "every hour")
 */
function getFrequencyText(triggerCondition: any): string {
  if (!triggerCondition) return 'periodically';

  const { frequency, frequency_type, cron } = triggerCondition;

  if (frequency_type === 'cron' && cron) {
    return 'on a custom schedule';
  }

  if (!frequency || !frequency_type) {
    return 'periodically';
  }

  const num = parseInt(frequency);
  if (isNaN(num)) return 'periodically';

  // Handle singular vs plural
  if (num === 1) {
    const singularType = frequency_type.replace(/s$/, ''); // Remove trailing 's'
    return `every ${singularType}`;
  }

  return `every ${num} ${frequency_type}`;
}

/**
 * Get period text (e.g., "the last 30 minutes", "the last 1 hour")
 */
function getPeriodText(period: number): string {
  if (!period) return 'recent data';

  const minutes = period;

  if (minutes < 60) {
    return minutes === 1 ? 'the last minute' : `the last ${minutes} minutes`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? 'the last hour' : `the last ${hours} hours`;
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

