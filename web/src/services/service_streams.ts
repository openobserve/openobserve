// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import http from "./http";

/**
 * Service Streams API Client
 *
 * Provides access to service discovery data for telemetry correlation
 */

export interface ServiceStreams {
  logs: string[];
  traces: string[];
  metrics: string[];
}

export interface ServiceMetadata {
  service_name: string;
  dimensions: Record<string, string>;
  streams: ServiceStreams;
  first_seen: number;
  last_seen: number;
  metadata?: Record<string, string>;
}

export interface SemanticFieldGroup {
  id: string;
  display: string;
  fields: string[];
  normalize?: boolean;
  group?: string;
}

export interface StreamInfo {
  stream_name: string;
  filters: Record<string, string>;
}

export interface RelatedStreams {
  logs: StreamInfo[];
  traces: StreamInfo[];
  metrics: StreamInfo[];
}

export interface CorrelationRequest {
  source_stream: string;
  source_type: string;
  available_dimensions: Record<string, string>;
}

export interface CorrelationResponse {
  service_name: string;
  matched_dimensions: Record<string, string>;
  additional_dimensions: Record<string, string>;
  related_streams: RelatedStreams;
}

export type CardinalityClass = "VeryLow" | "Low" | "Medium" | "High" | "VeryHigh";

export interface DimensionAnalytics {
  dimension_name: string;
  cardinality: number;
  cardinality_class: CardinalityClass;
  service_count: number;
  first_seen: number;
  last_updated: number;
  sample_values: string[];
}

export interface DimensionAnalyticsSummary {
  org_id: string;
  total_dimensions: number;
  by_cardinality: Record<string, string[]>;
  recommended_priority_dimensions: string[];
  dimensions: DimensionAnalytics[];
  generated_at: number;
}

/**
 * Get semantic field groups for field name translation
 * Uses the existing alerts/deduplication/semantic-groups API
 */
export const getSemanticGroups = (org_identifier: string): Promise<{ data: SemanticFieldGroup[] }> => {
  return http().get(`/api/${org_identifier}/alerts/deduplication/semantic-groups`);
};

/**
 * Correlate telemetry streams
 *
 * Finds related logs, traces, and metrics for a given source stream by:
 * 1. Using minimal/stable dimensions to find the service
 * 2. Returning all related streams with their dimension requirements
 * 3. Categorizing dimensions into matched (used for correlation) vs additional (available for filtering)
 *
 * @param org_identifier Organization ID
 * @param request Correlation request with source stream info and available dimensions
 * @returns Correlation response with service info and related streams
 */
export const correlate = (
  org_identifier: string,
  request: CorrelationRequest
): Promise<{ data: CorrelationResponse }> => {
  return http().post(`/api/${org_identifier}/service_streams/_correlate`, request);
};

/**
 * Get dimension analytics with cardinality classification
 *
 * Returns comprehensive analytics about dimensions including:
 * - Cardinality class (VeryLow/Low/Medium/High/VeryHigh)
 * - Recommended priority dimensions for correlation
 * - Sample values for each dimension
 *
 * @param org_identifier Organization ID
 * @returns Dimension analytics summary
 */
export const getDimensionAnalytics = (
  org_identifier: string
): Promise<{ data: DimensionAnalyticsSummary }> => {
  return http().get(`/api/${org_identifier}/service_streams/_analytics`);
};

export default {
  getSemanticGroups,
  correlate,
  getDimensionAnalytics,
};
