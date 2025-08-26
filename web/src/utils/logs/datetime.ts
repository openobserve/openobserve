// Copyright 2023 OpenObserve Inc.
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

/**
 * Time period to millisecond conversion constants
 */
export const TIME_MULTIPLIERS = {
  s: 1000,           // seconds to milliseconds
  m: 60 * 1000,      // minutes to milliseconds
  h: 60 * 60 * 1000, // hours to milliseconds
  d: 24 * 60 * 60 * 1000, // days to milliseconds
  w: 7 * 24 * 60 * 60 * 1000, // weeks to milliseconds
} as const;

/**
 * Interface for timestamp range
 */
export interface TimestampRange {
  from: number;
  to: number;
}

/**
 * Extracts timestamp range from a relative time period string
 * 
 * @param period - Time period string (e.g., "15m", "1h", "7d", "1w", "1M")
 * @returns Object with from and to timestamps in milliseconds
 * 
 * @example
 * ```typescript
 * const range = extractTimestamps("15m");
 * // Returns timestamps for 15 minutes ago to now
 * ```
 */
export function extractTimestamps(period: string): TimestampRange | undefined {
  const currentTime = new Date();
  let fromTimestamp: number, toTimestamp: number;

  const periodUnit = period.slice(-1) as keyof typeof TIME_MULTIPLIERS;
  const periodValue = parseInt(period);

  if (isNaN(periodValue)) {
    console.error("Invalid period format!");
    return undefined;
  }

  switch (periodUnit) {
    case "s":
    case "m":
    case "h":
    case "d":
    case "w":
      fromTimestamp = currentTime.getTime() - periodValue * TIME_MULTIPLIERS[periodUnit];
      toTimestamp = currentTime.getTime();
      break;
    case "M":
      // Handle months specially since they have variable lengths
      const currentMonth = currentTime.getMonth();
      const currentYear = currentTime.getFullYear();
      const monthsToSubtract = periodValue;
      
      let targetMonth = currentMonth - monthsToSubtract;
      let targetYear = currentYear;
      
      // Handle year rollover
      while (targetMonth < 0) {
        targetMonth += 12;
        targetYear -= 1;
      }
      
      const fromDate = new Date(targetYear, targetMonth, 1);
      fromTimestamp = fromDate.getTime();
      toTimestamp = currentTime.getTime();
      break;
    default:
      console.error("Invalid period format!");
      return undefined;
  }

  return { from: fromTimestamp, to: toTimestamp };
}

/**
 * Validates if a time period string is in correct format
 * 
 * @param period - Time period string to validate
 * @returns true if valid, false otherwise
 * 
 * @example
 * ```typescript
 * isValidTimePeriod("15m"); // true
 * isValidTimePeriod("invalid"); // false
 * ```
 */
export function isValidTimePeriod(period: string): boolean {
  if (!period || typeof period !== 'string') {
    return false;
  }
  
  const match = period.match(/^(\d+)([smhdwM])$/);
  return match !== null;
}

/**
 * Converts a relative time period to a human-readable format
 * 
 * @param period - Time period string (e.g., "15m", "1h")
 * @returns Human-readable string
 * 
 * @example
 * ```typescript
 * formatTimePeriod("15m"); // "15 minutes"
 * formatTimePeriod("1h"); // "1 hour"
 * ```
 */
export function formatTimePeriod(period: string): string {
  const match = period.match(/^(\d+)([smhdwM])$/);
  if (!match) {
    return period;
  }
  
  const [, value, unit] = match;
  const numValue = parseInt(value);
  
  const unitLabels = {
    s: numValue === 1 ? 'second' : 'seconds',
    m: numValue === 1 ? 'minute' : 'minutes', 
    h: numValue === 1 ? 'hour' : 'hours',
    d: numValue === 1 ? 'day' : 'days',
    w: numValue === 1 ? 'week' : 'weeks',
    M: numValue === 1 ? 'month' : 'months',
  };
  
  return `${value} ${unitLabels[unit as keyof typeof unitLabels] || unit}`;
}

/**
 * Gets the current timestamp in milliseconds
 * 
 * @returns Current timestamp in milliseconds
 */
export function getCurrentTimestamp(): number {
  return new Date().getTime();
}

/**
 * Gets the current timestamp in microseconds (for backend compatibility)
 * 
 * @returns Current timestamp in microseconds
 */
export function getCurrentTimestampMicroseconds(): number {
  return new Date().getTime() * 1000;
}

/**
 * Converts milliseconds to microseconds
 * 
 * @param milliseconds - Timestamp in milliseconds
 * @returns Timestamp in microseconds
 */
export function millisecondsToMicroseconds(milliseconds: number): number {
  return milliseconds * 1000;
}

/**
 * Converts microseconds to milliseconds
 * 
 * @param microseconds - Timestamp in microseconds
 * @returns Timestamp in milliseconds
 */
export function microsecondsToMilliseconds(microseconds: number): number {
  return microseconds / 1000;
}

/**
 * Calculates the duration between two timestamps
 * 
 * @param startTime - Start timestamp in milliseconds
 * @param endTime - End timestamp in milliseconds
 * @returns Duration in milliseconds
 */
export function calculateDuration(startTime: number, endTime: number): number {
  return Math.abs(endTime - startTime);
}

/**
 * Formats a duration in milliseconds to human-readable format
 * 
 * @param durationMs - Duration in milliseconds
 * @returns Human-readable duration string
 * 
 * @example
 * ```typescript
 * formatDuration(90000); // "1m 30s"
 * formatDuration(3661000); // "1h 1m 1s"
 * ```
 */
export function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  const parts: string[] = [];
  
  if (days > 0) parts.push(`${days}d`);
  if (hours % 24 > 0) parts.push(`${hours % 24}h`);
  if (minutes % 60 > 0) parts.push(`${minutes % 60}m`);
  if (seconds % 60 > 0) parts.push(`${seconds % 60}s`);
  
  return parts.length > 0 ? parts.join(' ') : '0s';
}