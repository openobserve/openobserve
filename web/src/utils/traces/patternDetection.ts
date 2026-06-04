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
  const allDurations: number[] = []

  // Calculate total trace duration for percentage calculations
  let totalTraceDuration = 0
  traceTree.forEach(rootSpan => {
    totalTraceDuration = Math.max(totalTraceDuration, rootSpan.durationMs || 0)
  })

  /**
   * Extract services and their relationships from trace tree
   * Handles both standalone services and service-to-service relationships
   */
  const extractServicesAndRelationships = (spans: any[], parentService: string = ''): {
    relationships: CallPath[],
    services: Map<string, { spans: any[], totalDuration: number, errorCount: number }>
  } => {
    const relationships: CallPath[] = []
    const services = new Map<string, { spans: any[], totalDuration: number, errorCount: number }>()

    spans.forEach(span => {
      const serviceName = span.resolvedIdentity || span.serviceName || 'unknown'
      const duration = span.durationMs || 0
      const isError = isSpanError(span)

      // Track all services (including standalone ones)
      if (!services.has(serviceName)) {
        services.set(serviceName, { spans: [], totalDuration: 0, errorCount: 0 })
      }
      const serviceInfo = services.get(serviceName)!
      serviceInfo.spans.push(span)
      serviceInfo.totalDuration += duration
      if (isError) serviceInfo.errorCount += 1

      allDurations.push(duration)

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

        // Merge child services
        childResult.services.forEach((childInfo, childServiceName) => {
          if (services.has(childServiceName)) {
            const existing = services.get(childServiceName)!
            existing.spans.push(...childInfo.spans)
            existing.totalDuration += childInfo.totalDuration
            existing.errorCount += childInfo.errorCount
          } else {
            services.set(childServiceName, childInfo)
          }
        })
      }
    })

    return { relationships, services }
  }

  // Extract services and relationships from all root spans
  const extractionResult = extractServicesAndRelationships(traceTree)
  const allPaths = extractionResult.relationships
  const allServices = extractionResult.services

  // Group paths by signature and aggregate metrics
  allPaths.forEach(path => {
    const signature = path.services.join('→')

    if (!patterns.has(signature)) {
      patterns.set(signature, {
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
      })
    }

    const pattern = patterns.get(signature)!

    // Add span instance
    pattern.instances.push({
      spanId: path.leafSpan.span_id || path.leafSpan.spanId || '',
      duration: path.duration,
      exclusiveDuration: path.leafSpan.exclusiveTimeMs || path.duration, // Use exclusive time if available
      isError: path.isError,
      timestamp: path.leafSpan.start_time || 0,
      attributes: path.leafSpan.attributes || {},
      serviceName: path.leafSpan.serviceName || '',
      operationName: path.leafSpan.operationName || path.leafSpan.operation_name || ''
    })

    pattern.spanIds.push(path.leafSpan.span_id || path.leafSpan.spanId || '')
  })

  // Calculate aggregated metrics for each pattern
  patterns.forEach(pattern => {
    const durations = pattern.instances.map(instance => instance.duration)
    const exclusiveDurations = pattern.instances.map(instance => instance.exclusiveDuration)
    const errorCount = pattern.instances.filter(instance => instance.isError).length

    const avgInclusive = calculateAverage(durations)
    const avgExclusive = calculateAverage(exclusiveDurations)
    const totalExclusiveDuration = exclusiveDurations.reduce((sum, d) => sum + d, 0)

    pattern.metrics = {
      // Inclusive time metrics (existing)
      count: pattern.instances.length,
      avg: avgInclusive,
      min: Math.min(...durations),
      max: Math.max(...durations),
      p75: calculatePercentile(durations, 75),
      p95: calculatePercentile(durations, 95),
      p99: calculatePercentile(durations, 99),
      totalDuration: durations.reduce((sum, d) => sum + d, 0),
      errorRate: pattern.instances.length > 0 ? (errorCount / pattern.instances.length) * 100 : 0,
      traceTimePercent: totalTraceDuration > 0
        ? (durations.reduce((sum, d) => sum + d, 0) / totalTraceDuration) * 100
        : 0,

      // Exclusive time metrics (new)
      avgExclusive,
      minExclusive: exclusiveDurations.length > 0 ? Math.min(...exclusiveDurations) : 0,
      maxExclusive: exclusiveDurations.length > 0 ? Math.max(...exclusiveDurations) : 0,
      exclusiveP75: calculatePercentile(exclusiveDurations, 75),
      exclusiveP95: calculatePercentile(exclusiveDurations, 95),
      exclusiveTimePercent: totalTraceDuration > 0
        ? (totalExclusiveDuration / totalTraceDuration) * 100
        : 0,
      selfTimeRatio: avgInclusive > 0 ? avgExclusive / avgInclusive : 0
    }
  })

  // Handle standalone services (services not involved in any relationships)
  const servicesInRelationships = new Set<string>()
  patterns.forEach(pattern => {
    const services = pattern.pathSignature.split('→')
    services.forEach(service => servicesInRelationships.add(service))
  })

  // Add patterns for standalone services
  allServices.forEach((serviceInfo, serviceName) => {
    if (!servicesInRelationships.has(serviceName)) {
      // This is a standalone service - create a pattern for it
      const avgDuration = Math.round((serviceInfo.totalDuration / Math.max(serviceInfo.spans.length, 1)) * 100) / 100
      const errorRate = (serviceInfo.errorCount / Math.max(serviceInfo.spans.length, 1)) * 100

      // Calculate exclusive time metrics for standalone service
      const exclusiveDurations = serviceInfo.spans.map(s => s.exclusiveTimeMs || s.durationMs || 0)
      const totalExclusiveDuration = exclusiveDurations.reduce((sum, d) => sum + d, 0)
      const avgExclusive = Math.round((totalExclusiveDuration / Math.max(serviceInfo.spans.length, 1)) * 100) / 100

      patterns.set(serviceName, {
        pathSignature: serviceName,
        instances: serviceInfo.spans.map(span => ({
          spanId: span.span_id || span.spanId || '',
          duration: span.durationMs || 0,
          exclusiveDuration: span.exclusiveTimeMs || span.durationMs || 0, // Use exclusive time if available
          isError: isSpanError(span),
          timestamp: span.start_time || 0,
          attributes: span.attributes || {},
          serviceName: span.serviceName || serviceName,
          operationName: span.operationName || span.operation_name || ''
        })),
        metrics: {
          // Inclusive time metrics (existing)
          count: serviceInfo.spans.length,
          avg: avgDuration,
          min: Math.min(...serviceInfo.spans.map(s => s.durationMs || 0)),
          max: Math.max(...serviceInfo.spans.map(s => s.durationMs || 0)),
          p75: calculatePercentile(serviceInfo.spans.map(s => s.durationMs || 0), 75),
          p95: calculatePercentile(serviceInfo.spans.map(s => s.durationMs || 0), 95),
          p99: calculatePercentile(serviceInfo.spans.map(s => s.durationMs || 0), 99),
          totalDuration: serviceInfo.totalDuration,
          errorRate,
          traceTimePercent: totalTraceDuration > 0 ? (serviceInfo.totalDuration / totalTraceDuration) * 100 : 100,

          // Exclusive time metrics (new)
          avgExclusive,
          minExclusive: exclusiveDurations.length > 0 ? Math.min(...exclusiveDurations) : 0,
          maxExclusive: exclusiveDurations.length > 0 ? Math.max(...exclusiveDurations) : 0,
          exclusiveP75: calculatePercentile(exclusiveDurations, 75),
          exclusiveP95: calculatePercentile(exclusiveDurations, 95),
          exclusiveTimePercent: totalTraceDuration > 0 ? (totalExclusiveDuration / totalTraceDuration) * 100 : 100,
          selfTimeRatio: avgDuration > 0 ? avgExclusive / avgDuration : 0
        },
        spanIds: serviceInfo.spans.map(span => span.span_id || span.spanId || '')
      })
    }
  })

  // Return consolidated patterns with aggregated metrics

  return patterns
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