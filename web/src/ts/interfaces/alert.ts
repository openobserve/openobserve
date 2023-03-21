import type { Query } from "./query";

export interface Condition {
  column: string;
  ignoreCase: null | boolean;
  isNumeric: boolean;
  operator: string;
  value: string;
}

interface TimingFunction {
  unit: "Minutes";
  value: number;
}

// Alert payload which is sent to backend
export interface Alert {
  condition: Condition;
  destination: string;
  duration: number | TimingFunction;
  frequency: number | TimingFunction;
  name: string;
  stream_name: string;
  time_between_alerts: number | TimingFunction;
  query?: Query | string;
}

// Alert object which is modified in frontend to display in table and form
export interface AlertData extends Alert {
  "#"?: number | string;
  condition_str: string;
  actions: string;
  isScheduled: boolean;
}

// Template payload which is sent to backend
export interface Template {
  name: string;
  body: string;
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
  headers: Headers;
  template: string | Template;
}

// Destination object which is modified in frontend to display in table and form
export interface DestinationData extends Destination {
  "#"?: number | string;
}
