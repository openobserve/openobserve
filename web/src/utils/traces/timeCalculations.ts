// Copyright 2026 OpenObserve Inc.

/**
 * Time Calculations Utility for Trace Analysis
 *
 * Calculates exclusive and inclusive time metrics for distributed trace spans.
 * Used by both flame graph (span-level) and trace graph (service-level) visualizations.
 */

import type { EnrichedSpan } from '@/ts/interfaces/traces/span.types'

/**
 * Time interval representing a span's execution period
 */
export interface TimeInterval {
  start: number    // Start time in milliseconds
  end: number      // End time in milliseconds
  spanId: string   // Associated span ID
}

/**
 * Comprehensive time metrics for a span
 */
export interface TimeMetrics {
  inclusiveTimeMs: number       // Total span duration (including children)
  exclusiveTimeMs: number       // Self-time (excluding overlapping children)
  childOverlapMs: number        // Total time covered by child spans
  concurrentChildrenMs: number  // Time when multiple children execute simultaneously
  childIntervals: TimeInterval[] // Individual child execution intervals
}

/**
 * Merged interval representing overlapping time periods
 */
export interface MergedInterval {
  start: number
  end: number
  overlappingSpans: string[]  // IDs of spans that contribute to this interval
}

/**
 * Calculate exclusive time metrics for a given span
 *
 * @param span - The parent span to calculate metrics for
 * @param children - Direct child spans of the parent
 * @returns Comprehensive time metrics
 */
export function calculateExclusiveTime(
  span: EnrichedSpan,
  children: EnrichedSpan[]
): TimeMetrics {
  const inclusiveTimeMs = span.durationMs || 0

  // Handle spans with no children
  if (!children.length) {
    return {
      inclusiveTimeMs,
      exclusiveTimeMs: inclusiveTimeMs,
      childOverlapMs: 0,
      concurrentChildrenMs: 0,
      childIntervals: []
    }
  }

  // Convert children to time intervals
  const childIntervals = children.map(child => ({
    start: child.startOffsetMs || 0,
    end: (child.startOffsetMs || 0) + (child.durationMs || 0),
    spanId: child.span_id
  }))

  // Detect overlapping intervals and calculate metrics
  const mergedIntervals = mergeOverlappingIntervals(childIntervals)
  const childOverlapMs = calculateTotalCoverage(mergedIntervals)
  const concurrentChildrenMs = calculateConcurrentTime(mergedIntervals)

  // Calculate exclusive time (cannot be negative)
  const exclusiveTimeMs = Math.max(0, inclusiveTimeMs - childOverlapMs)

  return {
    inclusiveTimeMs,
    exclusiveTimeMs,
    childOverlapMs,
    concurrentChildrenMs,
    childIntervals
  }
}

/**
 * Merge overlapping time intervals to find total child coverage
 *
 * @param intervals - Array of time intervals to merge
 * @returns Array of merged intervals with overlap information
 */
export function mergeOverlappingIntervals(intervals: TimeInterval[]): MergedInterval[] {
  if (intervals.length === 0) return []

  // Sort intervals by start time
  const sortedIntervals = [...intervals].sort((a, b) => a.start - b.start)
  const merged: MergedInterval[] = []

  let currentInterval: MergedInterval = {
    start: sortedIntervals[0].start,
    end: sortedIntervals[0].end,
    overlappingSpans: [sortedIntervals[0].spanId]
  }

  for (let i = 1; i < sortedIntervals.length; i++) {
    const interval = sortedIntervals[i]

    // Check if current interval overlaps with the next one
    if (interval.start <= currentInterval.end) {
      // Overlapping - extend the current interval
      currentInterval.end = Math.max(currentInterval.end, interval.end)
      currentInterval.overlappingSpans.push(interval.spanId)
    } else {
      // Non-overlapping - push current and start new
      merged.push(currentInterval)
      currentInterval = {
        start: interval.start,
        end: interval.end,
        overlappingSpans: [interval.spanId]
      }
    }
  }

  // Add the last interval
  merged.push(currentInterval)
  return merged
}

/**
 * Calculate total time coverage from merged intervals
 *
 * @param mergedIntervals - Array of merged intervals
 * @returns Total duration covered by all intervals
 */
export function calculateTotalCoverage(mergedIntervals: MergedInterval[]): number {
  return mergedIntervals.reduce((total, interval) => {
    return total + (interval.end - interval.start)
  }, 0)
}

/**
 * Calculate time when multiple children execute concurrently
 *
 * @param mergedIntervals - Array of merged intervals with overlap info
 * @returns Total duration of concurrent execution
 */
export function calculateConcurrentTime(mergedIntervals: MergedInterval[]): number {
  return mergedIntervals.reduce((total, interval) => {
    // Only count intervals where multiple spans overlap
    if (interval.overlappingSpans.length > 1) {
      return total + (interval.end - interval.start)
    }
    return total
  }, 0)
}

/**
 * Detect overlapping children for a given span
 *
 * @param children - Array of child spans to analyze
 * @returns Information about overlapping execution periods
 */
export function detectChildOverlaps(children: EnrichedSpan[]): {
  hasOverlaps: boolean
  overlappingPairs: Array<{span1: string, span2: string, overlapMs: number}>
  maxConcurrency: number
} {
  if (children.length < 2) {
    return {
      hasOverlaps: false,
      overlappingPairs: [],
      maxConcurrency: children.length
    }
  }

  const intervals = children.map(child => ({
    start: child.startOffsetMs || 0,
    end: (child.startOffsetMs || 0) + (child.durationMs || 0),
    spanId: child.span_id
  }))

  const overlappingPairs: Array<{span1: string, span2: string, overlapMs: number}> = []
  let maxConcurrency = 1

  // Check all pairs for overlaps
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const interval1 = intervals[i]
      const interval2 = intervals[j]

      // Calculate overlap
      const overlapStart = Math.max(interval1.start, interval2.start)
      const overlapEnd = Math.min(interval1.end, interval2.end)
      const overlapMs = Math.max(0, overlapEnd - overlapStart)

      if (overlapMs > 0) {
        overlappingPairs.push({
          span1: interval1.spanId,
          span2: interval2.spanId,
          overlapMs
        })
      }
    }
  }

  // Calculate maximum concurrency using sweep line algorithm
  const events: Array<{time: number, type: 'start' | 'end'}> = []
  intervals.forEach(interval => {
    events.push({ time: interval.start, type: 'start' })
    events.push({ time: interval.end, type: 'end' })
  })

  events.sort((a, b) => {
    if (a.time === b.time) {
      // Process 'start' events before 'end' events at the same time
      return a.type === 'start' ? -1 : 1
    }
    return a.time - b.time
  })

  let currentConcurrency = 0
  events.forEach(event => {
    if (event.type === 'start') {
      currentConcurrency++
      maxConcurrency = Math.max(maxConcurrency, currentConcurrency)
    } else {
      currentConcurrency--
    }
  })

  return {
    hasOverlaps: overlappingPairs.length > 0,
    overlappingPairs,
    maxConcurrency
  }
}

/**
 * Calculate time percentages relative to total trace duration
 *
 * @param timeMs - Time value in milliseconds
 * @param totalTraceMs - Total trace duration in milliseconds
 * @returns Percentage of trace time (0-100)
 */
export function calculateTimePercentage(timeMs: number, totalTraceMs: number): number {
  if (totalTraceMs <= 0) return 0
  return Math.round((timeMs / totalTraceMs) * 100 * 100) / 100 // Round to 2 decimal places
}

/**
 * Validate time calculations for correctness
 *
 * @param metrics - Time metrics to validate
 * @returns Validation result with any errors found
 */
export function validateTimeMetrics(metrics: TimeMetrics): {
  isValid: boolean
  errors: string[]
} {
  const errors: string[] = []

  // Basic validation rules
  if (metrics.exclusiveTimeMs < 0) {
    errors.push('Exclusive time cannot be negative')
  }

  if (metrics.inclusiveTimeMs < 0) {
    errors.push('Inclusive time cannot be negative')
  }

  if (metrics.childOverlapMs < 0) {
    errors.push('Child overlap time cannot be negative')
  }

  if (metrics.exclusiveTimeMs > metrics.inclusiveTimeMs) {
    errors.push('Exclusive time cannot exceed inclusive time')
  }

  if (metrics.childOverlapMs > metrics.inclusiveTimeMs) {
    errors.push('Child overlap cannot exceed inclusive time')
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}