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

    // Exclusive time metrics (service-level aggregations)
    avgExclusive: number           // Average exclusive time across spans
    minExclusive: number           // Minimum exclusive time
    maxExclusive: number           // Maximum exclusive time
    exclusiveP75: number           // 75th percentile exclusive time
    exclusiveP95: number           // 95th percentile exclusive time
    exclusiveTimePercent: number   // % of total trace time in service self-time
    selfTimeRatio: number          // avgExclusive / avg (work ratio)
  }
  spanIds: string[] // for drill-down capability
}

/**
 * Call path extracted from trace
 */
interface CallPath {
  services: string[]
  leafSpan: any  // The leaf span for this path
  duration: number
  isError: boolean
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

  // Extract services and relationships from all root spans
  const extractionResult = extractServicesAndRelationships(traceTree)
  const allPaths = extractionResult.relationships
  const allServices = extractionResult.services

  // Group paths by signature and add span instances
  addCallPathPatterns(patterns, allPaths)

  // Calculate aggregated metrics for each pattern
  calculatePatternMetrics(patterns, totalTraceDuration)

  // Add patterns for standalone services
  addStandaloneServicePatterns(patterns, allServices, totalTraceDuration)

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
 * Extract services and their relationships from trace tree
 * Handles both standalone services and service-to-service relationships
 */
function extractServicesAndRelationships(spans: any[], parentService: string = ''): {
  relationships: CallPath[],
  services: Map<string, { spans: any[], totalDuration: number, errorCount: number }>
} {
  const relationships: CallPath[] = []
  const services = new Map<string, { spans: any[], totalDuration: number, errorCount: number }>()

  spans.forEach((span, index) => {
    const serviceName = extractServiceName(span)
    const duration = span.durationMs || 0
    const isError = isSpanError(span)

    // Track all services (including standalone ones)
    addSpanToService(services, serviceName, span, duration, isError)

    // If this span has a parent service and is a different service, record the relationship
    if (parentService && parentService !== serviceName) {
      relationships.push({
        services: [parentService, serviceName],
        leafSpan: span,
        duration,
        isError
      })
    }

    // Recursively process child spans
    if (span.spans && span.spans.length > 0) {
      const childResult = extractServicesAndRelationships(span.spans, serviceName)
      relationships.push(...childResult.relationships)
      mergeChildServices(services, childResult.services)
    }
  })

  return { relationships, services }
}

/**
 * Update service info with span data
 */
function updateServiceInfo(
  serviceInfo: { spans: any[], totalDuration: number, errorCount: number },
  spans: any[],
  totalDuration: number,
  errorCount: number
): void {
  serviceInfo.spans.push(...spans)
  serviceInfo.totalDuration += totalDuration
  serviceInfo.errorCount += errorCount
}

/**
 * Add a span to the service tracking map
 */
function addSpanToService(
  services: Map<string, { spans: any[], totalDuration: number, errorCount: number }>,
  serviceName: string,
  span: any,
  duration: number,
  isError: boolean
): void {
  if (!services.has(serviceName)) {
    services.set(serviceName, { spans: [], totalDuration: 0, errorCount: 0 })
  }
  const serviceInfo = services.get(serviceName)!
  updateServiceInfo(serviceInfo, [span], duration, isError ? 1 : 0)
}

/**
 * Merge child services into the main services map
 */
function mergeChildServices(
  services: Map<string, { spans: any[], totalDuration: number, errorCount: number }>,
  childServices: Map<string, { spans: any[], totalDuration: number, errorCount: number }>
): void {
  childServices.forEach((childInfo, childServiceName) => {
    if (services.has(childServiceName)) {
      const existing = services.get(childServiceName)!
      updateServiceInfo(existing, childInfo.spans, childInfo.totalDuration, childInfo.errorCount)
    } else {
      services.set(childServiceName, childInfo)
    }
  })
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
      avgExclusive: 0,
      minExclusive: Infinity,
      maxExclusive: 0,
      exclusiveP75: 0,
      exclusiveP95: 0,
      exclusiveTimePercent: 0,
      selfTimeRatio: 0
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
 * Create a span instance from a call path
 */
function createSpanInstance(path: CallPath): SpanInstance {
  return createSpanInstanceFromSpan(path.leafSpan)
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
    const spanInstance = createSpanInstance(path)

    pattern.instances.push(spanInstance)
    pattern.spanIds.push(spanInstance.spanId)
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
    avgExclusive,
    minExclusive: exclusiveDurations.length > 0 ? Math.min(...exclusiveDurations) : 0,
    maxExclusive: exclusiveDurations.length > 0 ? Math.max(...exclusiveDurations) : 0,
    exclusiveP75: calculatePercentile(exclusiveDurations, 75),
    exclusiveP95: calculatePercentile(exclusiveDurations, 95),
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
 * Add patterns for standalone services (services not involved in any relationships)
 */
function addStandaloneServicePatterns(
  patterns: Map<string, CallPattern>,
  allServices: Map<string, { spans: any[], totalDuration: number, errorCount: number }>,
  totalTraceDuration: number
): void {
  const servicesInRelationships = getServicesInRelationships(patterns)

  allServices.forEach((serviceInfo, serviceName) => {
    if (!servicesInRelationships.has(serviceName)) {
      const standalonePattern = createStandaloneServicePattern(
        serviceName,
        serviceInfo,
        totalTraceDuration
      )
      patterns.set(serviceName, standalonePattern)
    }
  })
}

/**
 * Get set of services that are already involved in relationships
 */
function getServicesInRelationships(patterns: Map<string, CallPattern>): Set<string> {
  const servicesInRelationships = new Set<string>()
  patterns.forEach(pattern => {
    const services = pattern.pathSignature.split('→')
    services.forEach(service => servicesInRelationships.add(service))
  })
  return servicesInRelationships
}

/**
 * Create a pattern for a standalone service
 */
function createStandaloneServicePattern(
  serviceName: string,
  serviceInfo: { spans: any[], totalDuration: number, errorCount: number },
  totalTraceDuration: number
): CallPattern {
  const instances = serviceInfo.spans.map(span => createSpanInstanceFromSpan(span, serviceName))
  const durations = serviceInfo.spans.map(s => s.durationMs || 0)
  const exclusiveDurations = serviceInfo.spans.map(s => s.exclusiveTimeMs || s.durationMs || 0)

  return {
    pathSignature: serviceName,
    instances,
    metrics: calculateMetricsFromDurations(durations, exclusiveDurations, serviceInfo.errorCount, totalTraceDuration),
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