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
}

// Template payload which is sent to backend
export interface Template {
  name: string;
  body: any;
  isDefault?: boolean;
}

// Template object which is modified in frontend to display in table and form
export interface TemplateData extends Template {
  "#"?: number | string;
}

// Destination payload which is sent to backend
export interface Headers {
  [key: string]: string;
}
export interface Destination {
  name: string;
  url: string;
  method: string;
  skip_tls_verify: boolean;
  headers: Headers;
  template: string | Template;
}

// Destination object which is modified in frontend to display in table and form
export interface DestinationData extends Destination {
  "#"?: number | string;
}
