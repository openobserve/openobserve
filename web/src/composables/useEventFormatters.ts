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
    if (!statusCode) return "tw:text-gray-500";
    if (statusCode >= 200 && statusCode < 300) return "tw:text-[var(--o2-positive)]";
    if (statusCode >= 300 && statusCode < 400) return "tw:text-[var(--o2-info)]";
    if (statusCode >= 400 && statusCode < 500) return "tw:text-[var(--o2-warning)]";
    return "tw:text-[var(--o2-negative)]";
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
        "tw:bg-red-100 tw:text-red-700 tw:border tw:border-solid tw:border-red-300",
      action:
        "tw:bg-blue-100 tw:text-blue-700 tw:border tw:border-solid tw:border-blue-300",
      view: "tw:bg-green-100 tw:text-green-700 tw:border tw:border-solid tw:border-green-300",
      resource:
        "tw:bg-purple-100 tw:text-purple-700 tw:border tw:border-solid tw:border-purple-300",
    };
    return classes[type] || "tw:bg-grey-100 tw:text-grey-700";
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
