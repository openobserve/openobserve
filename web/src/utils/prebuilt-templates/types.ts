// Copyright 2026 OpenObserve Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Component } from 'vue';

/**
 * Prebuilt destination types
 */
export type PrebuiltTypeId = 'slack' | 'discord' | 'msteams' | 'pagerduty' | 'servicenow' | 'email' | 'opsgenie';

/**
 * Credential field configuration
 */
export interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'email' | 'select' | 'toggle';
  required: boolean;
  hint?: string;
  options?: Array<{ label: string; value: string; description?: string }>;
  validator?: (value: string) => boolean | string;
}

/**
 * Prebuilt destination configuration
 */
export interface PrebuiltConfig {
  templateName: string;
  templateBody: string;
  headers: Record<string, string>;
  method: 'get' | 'post' | 'put';
  urlValidator: (url: string) => boolean;
  credentialFields: CredentialField[];
}

/**
 * Prebuilt destination type definition
 */
export interface PrebuiltType {
  id: PrebuiltTypeId;
  name: string;
  description: string;
  icon: string; // Icon name or component reference
  image?: string; // Image URL for logo
  popular?: boolean;
  category: 'messaging' | 'incident' | 'email' | 'custom';
}

/**
 * Form data for prebuilt destinations
 */
export interface PrebuiltFormData {
  name: string;
  credentials: Record<string, any>;
  advancedMode?: boolean;
}

/**
 * Validation result
 */
export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

/**
 * Test result from destination test
 */
export interface TestResult {
  success: boolean;
  timestamp?: number;
  error?: string;
  statusCode?: number;
  responseBody?: string;
}

/**
 * Template with prebuilt metadata
 */
export interface PrebuiltTemplate {
  name: string;
  body: string;
  type: 'http' | 'email';
  isDefault: boolean;
}

/**
 * Destination data with prebuilt metadata
 */
export interface DestinationWithPrebuilt {
  name: string;
  type: "http" | "email" | "action";
  url: string;
  method: "get" | "post" | "put";
  skip_tls_verify: boolean;
  template: string;
  headers: Record<string, string>;
  emails: string;
  action_id: string;
  output_format: "json" | "ndjson";
  metadata?: {
    prebuilt_type?: PrebuiltTypeId;
    [key: string]: any;
  };
}