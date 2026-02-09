/**
 * Event Formatters Composable
 * ============================
 * Reusable formatting utilities for RUM events
 */

import { date } from "quasar";
import { formatDuration } from "@/utils/zincutils";

export function useEventFormatters() {
  /**
   * Format timestamp to readable date string
   */
  const formatTimestamp = (timestamp: number): string => {
    if (!timestamp) return "N/A";
    return date.formatDate(
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
    if (!statusCode) return "help";
    if (statusCode >= 200 && statusCode < 300) return "check_circle";
    if (statusCode >= 300 && statusCode < 400) return "info";
    if (statusCode >= 400 && statusCode < 500) return "warning";
    return "error";
  };

  /**
   * Get status color based on HTTP status code
   */
  const getStatusColor = (statusCode: number): string => {
    if (!statusCode) return "grey";
    if (statusCode >= 200 && statusCode < 300) return "positive";
    if (statusCode >= 300 && statusCode < 400) return "info";
    if (statusCode >= 400 && statusCode < 500) return "warning";
    return "negative";
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
    getStatusColor,
    formatResourceDuration,
    getEventTypeClass,
  };
}
