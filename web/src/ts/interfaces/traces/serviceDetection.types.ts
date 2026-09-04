// Copyright 2026 OpenObserve Inc.
export interface ServiceDetectionRule {
  attributes: string[];
  sub_attributes?: string[];
}

export interface ServiceDetectionConfig {
  server_kinds: string[];
  rules: ServiceDetectionRule[];
}
