// Copyright 2026 OpenObserve Inc.
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
 * Span instance for pattern detection
 */
export interface SpanInstance {
  spanId: string
  duration: number          // Inclusive duration
  exclusiveDuration: number // Exclusive duration (self-time)
  isError: boolean
  timestamp: number
  attributes: Record<string, any>
  serviceName: string
  operationName: string
}

/**
 * Call pattern aggregated metrics
 */
export interface CallPattern {
  pathSignature: string  // "cache-service→database-service"
  instances: SpanInstance[]
  metrics: {
    // Inclusive time metrics (existing)
    count: number
    avg: number
    min: number
    max: number
    p75: number
    p95: number
    p99: number
    totalDuration: number
    errorRate: number
    traceTimePercent: number // % of total trace duration

    // Exclusive time metrics (service-level aggregations)        // 95th percentile exclusive time
    exclusiveTimePercent: number   // % of total trace time in service self-time
    selfTimeRatio: number          // avgExclusive / avg (work ratio)
    exclusiveTime: number
  }
  spanIds: string[] // for drill-down capability
}

/**
 * Call path extracted from trace
 */
interface CallPath {
  services: string[]   // ['root', 'load-generator'] or ['load-generator', 'frontend-proxy']
  spans: any[]         // ALL destination service spans in this subtree
  duration: number     // calculateMergedDuration(spans) — non-overlapping wall clock
  isError: boolean     // error from boundary span (spans[0])
}

/**
 * Build consolidated call patterns from trace tree
 * Groups spans with identical service sequences and calculates aggregated metrics
 */
export function buildPatternConsolidatedTree(traceTree: any[]): Map<string, CallPattern> {
  if (!traceTree || traceTree.length === 0) {
    return new Map()
  }

  const patterns = new Map<string, CallPattern>()
  const totalTraceDuration = calculateTotalTraceDuration(traceTree)

  // Extract service relationships — each CallPath carries all destination spans
  const allPaths = extractServicesAndRelationships(traceTree)

  // Group paths by signature and add span instances
  addCallPathPatterns(patterns, allPaths)

  // Add service-level patterns with computed metrics
  // (edge metrics are not computed — single-trace samples are too few)
  addServicePatterns(patterns, allPaths, totalTraceDuration)

  return patterns
}

/**
 * Calculate the total trace duration from root spans
 */
function calculateTotalTraceDuration(traceTree: any[]): number {
  let totalTraceDuration = 0
  traceTree.forEach(rootSpan => {
    totalTraceDuration = Math.max(totalTraceDuration, rootSpan.durationMs || 0)
  })
  return totalTraceDuration
}

/**
 * Extract services and their relationships from trace tree.
 * Returns a flat list of CallPaths, each carrying the boundary span.
 * Service-level metrics are derived from span.exclusiveTimeMs downstream
 * (pre-computed via bottom-up enrichment in useTraceProcessing).
 */
function extractServicesAndRelationships(spans: any[], parentService: string = 'root'): CallPath[] {
  const relationships: CallPath[] = []

  spans.forEach((span) => {
    const serviceName = extractServiceName(span)
    const isError = isSpanError(span)

    if (parentService !== serviceName) {
      // Service boundary detected — collect all same-service spans in subtree
      // Each span already has exclusiveTimeMs pre-computed bottom-up
      const allServiceSpans = collectSameServiceSpans(span, serviceName)

      relationships.push({
        services: [parentService, serviceName],
        spans: allServiceSpans,               // all same-service spans (for exclusive aggregation)
        duration: span.durationMs || 0,       // boundary span inclusive (edge count reference)
        isError,
      })
    }

    // Always recurse for deeper boundary detection
    // Handles both old format (spans) and EnrichedSpan format (children)
    const childSpans = span.spans || span.children
    if (childSpans && childSpans.length > 0) {
      relationships.push(...extractServicesAndRelationships(childSpans, serviceName))
    }
  })

  return relationships
}

/**
 * Collects all spans in a subtree belonging to a given service.
 * Walks same-service children; stops at different-service boundaries.
 * Only collects — no computation (exclusiveTimeMs is pre-computed).
 */
function collectSameServiceSpans(span: any, serviceName: string): any[] {
  const result: any[] = [span]
  const childSpans = span.spans || span.children
  if (childSpans) {
    for (const child of childSpans) {
      if (extractServiceName(child) === serviceName) {
        result.push(...collectSameServiceSpans(child, serviceName))
      }
    }
  }
  return result
}

/**
 * Initialize a new call pattern with default metrics
 */
function initializePattern(signature: string): CallPattern {
  return {
    pathSignature: signature,
    instances: [],
    metrics: {
      count: 0,
      avg: 0,
      min: Infinity,
      max: 0,
      p75: 0,
      p95: 0,
      p99: 0,
      totalDuration: 0,
      errorRate: 0,
      traceTimePercent: 0,
      // Initialize exclusive time metrics
      exclusiveTimePercent: 0,
      selfTimeRatio: 0,
      exclusiveTime: 0,
    },
    spanIds: []
  }
}

/**
 * Extract service name from span using fallback chain
 */
function extractServiceName(span: any): string {
  return span.resolvedIdentity || span.serviceName || 'unknown'
}

/**
 * Create a span instance from span data
 */
function createSpanInstanceFromSpan(span: any, serviceName?: string): SpanInstance {
  return {
    spanId: span.span_id || span.spanId || '',
    duration: span.durationMs || 0,
    exclusiveDuration: span.exclusiveTimeMs || span.durationMs || 0,
    isError: isSpanError(span),
    timestamp: span.start_time || 0,
    attributes: span.attributes || {},
    serviceName: span.serviceName || serviceName || '',
    operationName: span.operationName || span.operation_name || ''
  }
}

/**
 * Add call path patterns to the patterns map
 */
function addCallPathPatterns(patterns: Map<string, CallPattern>, allPaths: CallPath[]): void {
  allPaths.forEach(path => {
    const signature = path.services.join('→')

    if (!patterns.has(signature)) {
      patterns.set(signature, initializePattern(signature))
    }

    const pattern = patterns.get(signature)!
    // Push boundary span instance for structure/count tracking
    // Edge metrics are not computed — service-level metrics are derived from all spans
    const spanInstance = createSpanInstanceFromSpan(path.spans[0])
    pattern.instances.push(spanInstance)
    pattern.spanIds.push(spanInstance.spanId)
    pattern.metrics.count++
  })
}

/**
 * Calculate metrics from duration arrays
 */
function calculateMetricsFromDurations(
  durations: number[],
  exclusiveDurations: number[],
  errorCount: number,
  totalTraceDuration: number
): CallPattern['metrics'] {
  const avgInclusive = calculateAverage(durations)
  const avgExclusive = calculateAverage(exclusiveDurations)
  const totalExclusiveDuration = exclusiveDurations.reduce((sum, d) => sum + d, 0)
  const totalDuration = durations.reduce((sum, d) => sum + d, 0)
  const instanceCount = durations.length

  return {
    // Inclusive time metrics
    count: instanceCount,
    avg: avgInclusive,
    min: durations.length > 0 ? Math.min(...durations) : 0,
    max: durations.length > 0 ? Math.max(...durations) : 0,
    p75: calculatePercentile(durations, 75),
    p95: calculatePercentile(durations, 95),
    p99: calculatePercentile(durations, 99),
    totalDuration,
    errorRate: instanceCount > 0 ? (errorCount / instanceCount) * 100 : 0,
    traceTimePercent: totalTraceDuration > 0 ? (totalDuration / totalTraceDuration) * 100 : 0,

    // Exclusive time metrics
    exclusiveTime: totalExclusiveDuration,
    exclusiveTimePercent: totalTraceDuration > 0 ? (totalExclusiveDuration / totalTraceDuration) * 100 : 0,
    selfTimeRatio: avgInclusive > 0 ? avgExclusive / avgInclusive : 0
  }
}

/**
 * Calculate aggregated metrics for each pattern
 */
function calculatePatternMetrics(patterns: Map<string, CallPattern>, totalTraceDuration: number): void {
  patterns.forEach(pattern => {
    const durations = pattern.instances.map(instance => instance.duration)
    const exclusiveDurations = pattern.instances.map(instance => instance.exclusiveDuration)
    const errorCount = pattern.instances.filter(instance => instance.isError).length

    pattern.metrics = calculateMetricsFromDurations(durations, exclusiveDurations, errorCount, totalTraceDuration)
  })
}

/**
 * Add service-level patterns for ALL services (both standalone and those in relationships).
 * Derives service patterns from CallPath data — each CallPath carries all destination
 * service spans in its subtree. Groups spans by target service across all CallPaths.
 */
function addServicePatterns(
  patterns: Map<string, CallPattern>,
  allPaths: CallPath[],
  totalTraceDuration: number
): void {
  const servicesWithPatterns = getServicesWithPatterns(patterns)

  // Group destination spans by target service
  const perService = new Map<string, any[]>()
  allPaths.forEach(path => {
    const target = path.services[path.services.length - 1]
    if (!perService.has(target)) perService.set(target, [])
    perService.get(target)!.push(...path.spans)
  })

  perService.forEach((spans, serviceName) => {
    if (!servicesWithPatterns.has(serviceName)) {
      const servicePattern = createServicePattern(serviceName, spans, totalTraceDuration)
      patterns.set(serviceName, servicePattern)
    }
  })
}

/**
 * Get set of services that already have a service-level pattern in the map.
 * Only checks for plain-name keys (keys without '→').
 * Services appearing in relationship patterns still need their own
 * service-level pattern, so they are NOT included here.
 */
function getServicesWithPatterns(patterns: Map<string, CallPattern>): Set<string> {
  const servicesWithPatterns = new Set<string>()
  patterns.forEach((_, key) => {
    if (!key.includes('→')) {
      // Service-level pattern — the key IS the service name
      servicesWithPatterns.add(key)
    }
  })
  return servicesWithPatterns
}

/**
 * Create a service-level pattern from the service's own spans.
 * Uses exclusiveTimeMs (self-time) pre-computed via bottom-up enrichment
 * as the primary duration metric. Falls back to durationMs for backward compat.
 */
function createServicePattern(
  serviceName: string,
  spans: any[],
  totalTraceDuration: number
): CallPattern {
  const instances = spans.map(span => createSpanInstanceFromSpan(span, serviceName))
  // Use exclusive time as primary metric (pre-computed bottom-up, or fallback to durationMs)
  const durations = spans.map(s => s.durationMs || 0)
  // Keep inclusive durations as supplementary data
  const exclusiveDurations = spans.map(s => s.exclusiveTimeMs || 0)
  const errorCount = spans.filter(s => isSpanError(s)).length

  const metrics = calculateMetricsFromDurations(durations, exclusiveDurations, errorCount, totalTraceDuration)

  // totalDuration = total self-work (sum of exclusive times)
  // No merge needed — exclusiveTimeMs already accounts for child overlap
  metrics.totalDuration = durations.reduce((sum, d) => sum + d, 0)
  metrics.traceTimePercent = totalTraceDuration > 0 ? (metrics.totalDuration / totalTraceDuration) * 100 : 0

  return {
    pathSignature: serviceName,
    instances,
    metrics,
    spanIds: instances.map(instance => instance.spanId)
  }
}

/**
 * Check if a span represents an error
 */
function isSpanError(span: any): boolean {
  // Check span status
  if (span.status_code === 2 || span.span_status === 'ERROR') {
    return true
  }

  // Check for error in tags/attributes
  const tags = span.tags || span.attributes || {}
  if (tags.error === true || tags.error === 'true') {
    return true
  }

  // Check HTTP status codes in attributes
  if (tags['http.status_code'] && tags['http.status_code'] >= 400) {
    return true
  }

  return false
}

/**
 * Calculate average of an array of numbers
 */
function calculateAverage(values: number[]): number {
  if (values.length === 0) return 0
  const avg = values.reduce((sum, val) => sum + val, 0) / values.length
  return Math.round(avg * 100) / 100 // Round to 2 decimal places
}

/**
 * Calculate percentile of an array of numbers
 */
function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0

  const sorted = [...values].sort((a, b) => a - b)
  const index = (percentile / 100) * (sorted.length - 1)

  if (Math.floor(index) === index) {
    return sorted[index]
  } else {
    const lower = sorted[Math.floor(index)]
    const upper = sorted[Math.ceil(index)]
    const weight = index - Math.floor(index)
    return lower * (1 - weight) + upper * weight
  }
}

/**
 * Filter patterns by criteria (for advanced filtering features)
 */
export function filterPatterns(
  patterns: Map<string, CallPattern>,
  filters: {
    minDuration?: number
    maxDuration?: number
    minErrorRate?: number
    maxErrorRate?: number
    minCalls?: number
    onlyErrors?: boolean
  }
): Map<string, CallPattern> {
  const filtered = new Map<string, CallPattern>()

  patterns.forEach((pattern, signature) => {
    let include = true

    // Apply filters
    if (filters.minDuration !== undefined && pattern.metrics.avg < filters.minDuration) {
      include = false
    }
    if (filters.maxDuration !== undefined && pattern.metrics.avg > filters.maxDuration) {
      include = false
    }
    if (filters.minErrorRate !== undefined && pattern.metrics.errorRate < filters.minErrorRate) {
      include = false
    }
    if (filters.maxErrorRate !== undefined && pattern.metrics.errorRate > filters.maxErrorRate) {
      include = false
    }
    if (filters.minCalls !== undefined && pattern.metrics.count < filters.minCalls) {
      include = false
    }
    if (filters.onlyErrors && pattern.metrics.errorRate === 0) {
      include = false
    }

    if (include) {
      filtered.set(signature, pattern)
    }
  })

  return filtered
}