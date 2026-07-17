/**
 * Event Formatters Composable
 * ============================
 * Reusable formatting utilities for RUM events
 */

import { formatDate } from "@/utils/date";
import { formatDuration } from "@/utils/zincutils";

export function useEventFormatters() {
  /**
   * Format timestamp to readable date string
   */
  const formatTimestamp = (timestamp: number): string => {
    if (!timestamp) return "N/A";
    return formatDate(
      Math.floor(timestamp),
      "MMM DD, YYYY HH:mm:ss.SSS Z",
    );
  };

  /**
   * Format ID (currently pass-through, can be enhanced)
   */
  const formatId = (id: string): string => {
    if (!id) return "";
    return id;
  };

  /**
   * Get status icon based on HTTP status code
   */
  const getStatusIcon = (statusCode: number): string => {
    if (!statusCode) return "help-outline";
    if (statusCode >= 200 && statusCode < 300) return "check-circle";
    if (statusCode >= 300 && statusCode < 400) return "info";
    if (statusCode >= 400 && statusCode < 500) return "warning";
    return "error";
  };

  /**
   * Get status color class (Tailwind text-color) based on HTTP status code
   */
  const getStatusColorClass = (statusCode: number): string => {
    if (!statusCode) return "text-text-secondary";
    if (statusCode >= 200 && statusCode < 300) return "text-[var(--color-status-positive)]";
    if (statusCode >= 300 && statusCode < 400) return "text-[var(--color-info)]";
    if (statusCode >= 400 && statusCode < 500) return "text-[var(--color-warning)]";
    return "text-[var(--color-status-negative)]";
  };

  /**
   * Format resource duration (microseconds or milliseconds)
   */
  const formatResourceDuration = (
    duration: number,
    fromMicroseconds = false,
  ): string => {
    if (!duration) return "N/A";
    const durationInMs = fromMicroseconds ? duration / 1000000 : duration / 1000;
    return formatDuration(durationInMs);
  };

  /**
   * Get event type CSS classes
   */
  const getEventTypeClass = (type: string): string => {
    const classes: { [key: string]: string } = {
      error:
        "bg-error-100 text-error-700 border border-solid border-error-300",
      action:
        "bg-blue-100 text-blue-700 border border-solid border-blue-300",
      view: "bg-success-100 text-success-700 border border-solid border-success-400",
      resource:
        "bg-purple-100 text-purple-700 border border-solid border-purple-400",
    };
    return classes[type] || "bg-grey-100 text-grey-700";
  };

  return {
    formatTimestamp,
    formatId,
    getStatusIcon,
    getStatusColorClass,
    formatResourceDuration,
    getEventTypeClass,
  };
}
