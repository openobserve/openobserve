// Copyright 2026 OpenObserve Inc.
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
  disambiguation?: Record<string, string>;
  streams: ServiceStreams;
  first_seen: number;
  last_seen: number;
  metadata?: Record<string, string>;
}

export interface FieldAlias {
  id: string;
  display: string;
  fields: string[];
  group?: string;
  is_workload_type?: boolean;
}

export interface StreamInfo {
  stream_name: string;
  stream_type: string;
  filters?: Record<string, string>; // omitted by backend when empty (skip_serializing_if)
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
  /** The identity set selected by best-coverage resolution, if available. */
  matched_set_id?: string;
}

export type CardinalityClass = "VeryLow" | "Low" | "Medium" | "High" | "VeryHigh";

export interface DimensionAnalytics {
  dimension_name: string;
  cardinality: number;
  cardinality_class: CardinalityClass;
  service_count: number;
  first_seen: number;
  last_updated: number;
  /** sample_values[stream_type][stream_name] = unique values */
  sample_values: Record<string, Record<string, string[]>>;
  /** value_children[this_dim_value][other_dim_name] = co-occurring values */
  value_children: Record<string, Record<string, string[]>>;
  /** value_counts[this_dim_value] = number of services with this specific value */
  value_counts?: Record<string, number>;
}

export interface FoundGroup {
  group_id: string;
  display: string;
  stream_types: string[];
  aliases: Record<string, string>;
  recommended: boolean;
  unique_values?: number;
  cardinality_class?: CardinalityClass;
}

export interface ServiceFieldSource {
  field_name: string;
  stream_types: string[];
  hit_count: number;
}

export interface DimensionAnalyticsSummary {
  org_id: string;
  total_dimensions: number;
  by_cardinality: Record<string, string[]>;
  recommended_priority_dimensions: string[];
  dimensions: DimensionAnalytics[];
  available_groups: FoundGroup[];
  service_field_sources: ServiceFieldSource[];
  generated_at: number;
}

/**
 * Get semantic field groups for field name translation
 * Uses the existing alerts/deduplication/semantic-groups API
 */
export const getSemanticGroups = (org_identifier: string): Promise<{ data: FieldAlias[] }> => {
  return http().get(`/api/${org_identifier}/alerts/deduplication/semantic-groups`);
};

export const updateSemanticGroups = (org_identifier: string, groups: FieldAlias[]): Promise<any> => {
  return http().put(`/api/${org_identifier}/alerts/deduplication/semantic-groups`, groups);
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


/**
 * Get flat list of services
 *
 * @param orgIdentifier Organization ID
 * @returns Flat list of services
 */
export const getServicesList = (
  orgIdentifier: string
): Promise<{ data: any }> => {
  return http().get(`/api/${orgIdentifier}/service_streams`);
};

export interface IdentitySet {
  /** Semantic category slug: "k8s", "aws", "gcp", "azure", or a custom slug. */
  id: string;
  /** Human-readable display name, e.g. "Kubernetes". */
  label: string;
  /** Semantic group IDs used for disambiguation (1–5). */
  distinguish_by: string[];
}

export interface ServiceIdentityConfig {
  sets: IdentitySet[];
  tracked_alias_ids: string[];
}

/**
 * Save service identity configuration
 *
 * @param orgIdentifier Organization ID
 * @param config Identity config payload
 * @returns Save response
 */
export const saveIdentityConfig = (
  orgIdentifier: string,
  config: ServiceIdentityConfig
): Promise<{ data: any }> => {
  return http().put(`/api/${orgIdentifier}/service_streams/config/identity`, config);
};

/**
 * Get service identity configuration
 *
 * @param orgIdentifier Organization ID
 * @returns Identity config
 */
export const getIdentityConfig = (
  orgIdentifier: string
): Promise<{ data: ServiceIdentityConfig }> => {
  return http().get(`/api/${orgIdentifier}/service_streams/config/identity`);
};

/**
 * Reset (delete) all discovered services for an organization
 *
 * @param org_identifier Organization ID
 * @returns Reset result with deleted_count, message, and note
 */
export const resetServices = (
  org_identifier: string
): Promise<{ data: { deleted_count: number; message: string; note: string } }> => {
  return http().delete(`/api/${org_identifier}/service_streams/_reset`);
};

export default {
  getSemanticGroups,
  updateSemanticGroups,
  correlate,
  getDimensionAnalytics,
  getServicesList,
  saveIdentityConfig,
  getIdentityConfig,
  resetServices,
};
