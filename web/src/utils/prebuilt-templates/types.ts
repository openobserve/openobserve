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
 * A user-facing validation message, expressed as an i18n KEY (+ optional
 * interpolation params) rather than English copy.
 *
 * These config modules are plain, Vue-less objects: they have no `useI18n()` and
 * therefore cannot translate anything themselves. So they describe WHAT is wrong
 * and let the two consumers — both of which do have a `t` — render it:
 *   • `PrebuiltDestinationForm.schema.ts` (`makePrebuiltDestinationSchema`)
 *   • `usePrebuiltDestinations.ts` (`validateCredentials`)
 */
export interface ValidationMessage {
  key: string;
  params?: Record<string, unknown>;
}

/** `true` when valid; otherwise the i18n message describing the failure. */
export type CredentialValidatorResult = true | ValidationMessage;

/**
 * Credential field configuration
 *
 * `labelKey` is an i18n KEY (not English): it is interpolated into
 * `alerts.validation.credentialFieldRequired` ("{field} is required") by the
 * consumers above, so it must be resolved with `t()` before display.
 */
export interface CredentialField {
  key: string;
  labelKey: string;
  type: 'text' | 'password' | 'email' | 'select' | 'toggle';
  required: boolean;
  hint?: string;
  options?: Array<{ label: string; value: string; description?: string }>;
  validator?: (value: string) => CredentialValidatorResult;
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