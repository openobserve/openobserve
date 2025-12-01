// Copyright 2023 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

export interface Condition {
  column: string;
  ignore_case: null | boolean;
  operator: string;
  value: string;
}

interface TimingFunction {
  unit: "Minutes";
  value: number;
}

// Alert payload which is sent to backend
export interface Alert {
  id?: string;
  name: string;
  stream_name: string;
  stream_type: string;
  query_condition: {
    conditions: Array<Condition>;
    sql: string | null;
    promql: string | null;
    type: "sql" | "promql" | "custom";
  };
  destination: Array<string | Destination>;
  trigger_condition: {
    period: number;
    operator: "=" | ">" | "<" | ">=" | "<=" | "!=" | "Contains" | "NotContains";
    threshold: number;
    silence: number;
  };
  is_real_time: boolean;
  enabled: boolean;
  context_attributes: { [key: string]: string };
  description: string;
  uuid?: string;
  deduplication?: {
    enabled: boolean;
    fingerprint_fields: string[];
    time_window_minutes?: number;
    grouping?: {
      enabled: boolean;
      max_group_size: number;
      send_strategy: "first_with_count" | "summary" | "all";
      group_wait_seconds: number;
    };
  };
}

// Alert object which is modified in frontend to display in table and form
export interface AlertListItem {
  "#": number | string;
  name: string;
  stream_name: string;
  stream_type: string;
  enabled: boolean;
  alert_type: string;
  description: string;
  uuid?: string;
}

// Template payload which is sent to backend
export interface Template {
  name: string;
  body: any;
  isDefault?: boolean;
  type: "http" | "email";
  title?: string;
}

// Template object which is modified in frontend to display in table and form
export interface TemplateData extends Template {
  "#"?: number | string;
}

// Destination payload which is sent to backend
export interface Headers {
  [key: string]: string;
}
export interface DestinationMetadata {
  // Splunk specific fields
  source?: string;
  sourcetype?: string;
  hostname?: string;
  // Elasticsearch specific fields
  _index?: string;
  // Datadog specific fields
  ddsource?: string;
  ddtags?: string;
  service?: string;
  // hostname is shared between Splunk and Datadog
}

export interface Destination {
  name: string;
  url?: string;
  url_endpoint?: string; // Frontend only - used for display/editing
  method?: string;
  skip_tls_verify?: boolean;
  headers?: Headers;
  template?: string | Template;
  emails?: string;
  type: "http" | "email" | "sns" | "action";
  action_id?: string;
  output_format?: "json" | "ndjson" | "nestedevent" | string; // string allows esbulk with dynamic index
  destination_type?: string; // Frontend internal use
  destination_type_name?: string; // From backend
  esbulk_index?: string; // For esbulk format index name
  metadata?: DestinationMetadata; // Destination-specific metadata as JSON object
}

export interface DestinationPayload {
  name: string;
  url?: string; // Full URL (merged with endpoint before sending)
  method?: string;
  skip_tls_verify?: boolean;
  headers?: Headers;
  template?: string | Template;
  emails?: string[];
  type: "http" | "email" | "sns" | "action";
  action_id?: string;
  output_format?: "json" | "ndjson" | "nestedevent" | string; // string allows esbulk with dynamic index
  destination_type?: string; // New field added
}

// Destination object which is modified in frontend to display in table and form
export interface DestinationData extends Destination {
  "#"?: number | string;
}
