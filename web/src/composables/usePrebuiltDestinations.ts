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

import { ref, computed } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';

// Services
import alertDestinationService from '@/services/alert_destination';
import alertTemplateService from '@/services/alert_templates';

// Types and configurations
import {
  PREBUILT_DESTINATION_TYPES,
  PREBUILT_CONFIGS,
  getPrebuiltConfig,
  isPrebuiltType,
  detectPrebuiltTypeFromUrl,
  generateDestinationUrl,
  generateDestinationHeaders,
  getPopularPrebuiltTypes,
  getPrebuiltTypesByCategory
} from '@/utils/prebuilt-templates';

import type {
  PrebuiltType,
  PrebuiltFormData,
  ValidationResult,
  TestResult,
  PrebuiltTypeId,
  DestinationWithPrebuilt
} from '@/utils/prebuilt-templates/types';

// Store
import { useStore } from 'vuex';

/**
 * Composable for managing prebuilt alert destinations
 * Provides functionality for template management, validation, testing, and creation
 */
export function usePrebuiltDestinations() {
  const $q = useQuasar();
  const { t } = useI18n();
  const store = useStore();

  // Reactive state
  const isLoading = ref(false);
  const isTestInProgress = ref(false);
  const lastTestResult = ref<TestResult | null>(null);

  // Computed properties
  const organizationIdentifier = computed(() => store.state.selectedOrganization.identifier);

  /**
   * Get all available prebuilt destination types
   */
  const availableTypes = computed(() => PREBUILT_DESTINATION_TYPES);

  /**
   * Get popular prebuilt destination types for prioritized display
   */
  const popularTypes = computed(() => getPopularPrebuiltTypes());

  /**
   * Get prebuilt destination types grouped by category
   */
  const typesByCategory = computed(() => getPrebuiltTypesByCategory());

  /**
   * Ensure system templates exist in DEFAULT_ORG
   * NOTE: System templates are now managed by the backend via prebuilt destinations config
   * This function is kept for backward compatibility but does nothing
   */
  async function ensureSystemTemplates(): Promise<void> {
    // System templates are now automatically provided by the backend
    // No need to create them from the frontend
    return Promise.resolve();
  }

  /**
   * Validate credentials for a specific prebuilt destination type
   */
  function validateCredentials(type: PrebuiltTypeId, credentials: Record<string, any>): ValidationResult {
    const config = getPrebuiltConfig(type);
    if (!config) {
      return {
        isValid: false,
        errors: { type: 'Unknown destination type' }
      };
    }

    const errors: Record<string, string> = {};

    // Validate each credential field
    for (const field of config.credentialFields) {
      const value = credentials[field.key];

      // Check required fields
      if (field.required && (!value || value.toString().trim() === '')) {
        errors[field.key] = `${field.label} is required`;
        continue;
      }

      // Skip validation if field is optional and empty
      if (!field.required && (!value || value.toString().trim() === '')) {
        continue;
      }

      // Apply custom validator if present
      if (field.validator && value) {
        const validationResult = field.validator(value.toString());
        if (validationResult !== true) {
          errors[field.key] = validationResult as string;
        }
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }

  /**
   * Generate preview data for template preview
   */
  function generatePreview(type: PrebuiltTypeId): string {
    const config = getPrebuiltConfig(type);
    if (!config) return '';

    // Generate realistic alert URL using current browser context
    const baseUrl = window.location.origin;
    const orgId = organizationIdentifier.value;
    const now = Date.now() * 1000; // microseconds
    const oneHourAgo = now - (60 * 60 * 1000 * 1000);

    // Sample alert data with realistic context
    const sampleData = {
      alert_name: 'Test Alert - High CPU Usage',
      stream_name: 'system-metrics',
      stream_type: 'logs',
      alert_count: '15',
      alert_operator: 'greater than',
      alert_threshold: '80%',
      alert_time: new Date().toLocaleString(),
      // Use actual OpenObserve instance URL instead of fake example
      alert_url: `${baseUrl}/web/logs?org_identifier=${orgId}&stream_type=logs&stream=system-metrics&from=${oneHourAgo}&to=${now}&type=alert_destination_test`,
      // Add specific fields for different types
      integration_key: 'sample-integration-key',
      severity: 'error',
      assignment_group: 'IT Operations',
      api_key: 'sample-api-key'
    };

    // Replace placeholders in template with sample data
    let preview = config.templateBody;
    for (const [key, value] of Object.entries(sampleData)) {
      const regex = new RegExp(`{${key}}`, 'g');
      preview = preview.replace(regex, value);
    }

    return preview;
  }

  /**
   * Test a prebuilt destination by sending a sample notification
   */
  async function testDestination(type: PrebuiltTypeId, credentials: Record<string, any>): Promise<TestResult> {
    try {
      isTestInProgress.value = true;

      // Validate credentials first
      const validation = validateCredentials(type, credentials);
      if (!validation.isValid) {
        const firstError = Object.values(validation.errors)[0];
        return {
          success: false,
          error: `Validation error: ${firstError}`,
          timestamp: Date.now()
        };
      }

      const config = getPrebuiltConfig(type);
      if (!config) {
        return {
          success: false,
          error: 'Invalid destination type',
          timestamp: Date.now()
        };
      }

      // Generate test payload
      const testUrl = generateDestinationUrl(type, credentials);
      const testHeaders = generateDestinationHeaders(type, credentials);
      const testBody = generatePreview(type);

      // For email type, use email-specific test
      if (type === 'email') {
        // Email testing would require backend SMTP setup
        // For now, just validate email format and show success
        return {
          success: true,
          timestamp: Date.now()
        };
      }

      // Send test request via backend
      const testResult = await alertDestinationService.test({
        org_identifier: organizationIdentifier.value,
        data: {
          url: testUrl,
          method: config.method,
          headers: testHeaders,
          body: testBody
        }
      });

      lastTestResult.value = {
        success: testResult.success || false,
        timestamp: Date.now(),
        error: testResult.error,
        statusCode: testResult.statusCode,
        responseBody: testResult.responseBody
      };

      return lastTestResult.value;

    } catch (error: any) {
      const result: TestResult = {
        success: false,
        error: error.message || 'Test failed with unknown error',
        timestamp: Date.now()
      };

      lastTestResult.value = result;
      return result;
    } finally {
      isTestInProgress.value = false;
    }
  }

  /**
   * Create a prebuilt destination with auto-linked template
   */
  async function createDestination(
    type: PrebuiltTypeId,
    name: string,
    credentials: Record<string, any>,
    headers: Record<string, string> = {},
    skipTlsVerify: boolean = false
  ): Promise<void> {
    try {
      isLoading.value = true;

      // Ensure system templates exist
      await ensureSystemTemplates();

      // Validate inputs
      const validation = validateCredentials(type, credentials);
      if (!validation.isValid) {
        throw new Error(`Validation error: ${Object.values(validation.errors).join(', ')}`);
      }

      const config = getPrebuiltConfig(type);
      if (!config) {
        throw new Error('Invalid destination type');
      }

      // Generate destination data
      const destinationUrl = generateDestinationUrl(type, credentials);
      const destinationHeaders = generateDestinationHeaders(type, credentials);

      // Create destination payload
      // Email destinations use different payload structure than HTTP destinations
      let destinationData: any;

      if (type === 'email') {
        // Email destination - no URL or HTTP-specific fields
        destinationData = {
          name,
          type: 'email',
          template: config.templateName, // Include template for email
          skip_tls_verify: skipTlsVerify,
          output_format: 'json',
          destination_type_name: type,
          emails: Array.isArray(credentials.recipients)
            ? credentials.recipients
            : (credentials.recipients || '').split(',').map((e: string) => e.trim()).filter(Boolean),
          metadata: {
            prebuilt_type: type,
            // Flatten credentials into metadata (only non-sensitive fields)
            ...Object.fromEntries(
              Object.entries(credentials).filter(([key]) =>
                !key.toLowerCase().includes('password') &&
                !key.toLowerCase().includes('key') &&
                !key.toLowerCase().includes('token')
              ).map(([k, v]) => [`credential_${k}`, String(v)])
            )
          }
        };
      } else {
        // HTTP-based destinations (Slack, Teams, PagerDuty, Opsgenie, ServiceNow, Discord)
        destinationData = {
          name,
          type: 'http',
          url: destinationUrl,
          method: config.method,
          template: config.templateName, // Include template for all destinations
          skip_tls_verify: skipTlsVerify,
          headers: { ...destinationHeaders, ...headers },
          output_format: 'json',
          destination_type_name: type,
          metadata: {
            prebuilt_type: type,
            // Flatten credentials into metadata (only non-sensitive fields)
            ...Object.fromEntries(
              Object.entries(credentials).filter(([key]) =>
                !key.toLowerCase().includes('password') &&
                !key.toLowerCase().includes('key') &&
                !key.toLowerCase().includes('token')
              ).map(([k, v]) => [`credential_${k}`, String(v)])
            )
          }
        };

        // Special handling for ServiceNow - encode Basic Auth in Authorization header
        if (type === 'servicenow') {
          const authString = btoa(`${credentials.username}:${credentials.password}`);
          destinationData.headers = {
            ...destinationData.headers,
            'Authorization': `Basic ${authString}`
          };
        }
      }

      // Create the destination
      await alertDestinationService.create({
        org_identifier: organizationIdentifier.value,
        destination_name: name,
        data: destinationData
      });

      $q.notify({
        type: 'positive',
        message: t('alerts.destinations.saved'),
        timeout: 2000
      });

    } catch (error: any) {
      console.error('Failed to create prebuilt destination:', error);
      $q.notify({
        type: 'negative',
        message: t('alerts.destinations.saveError'),
        caption: error.message
      });
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Update an existing prebuilt destination
   */
  async function updateDestination(
    type: PrebuiltTypeId,
    originalName: string,
    name: string,
    credentials: Record<string, any>,
    headers: Record<string, string> = {},
    skipTlsVerify: boolean = false
  ): Promise<void> {
    try {
      isLoading.value = true;

      // Ensure system templates exist
      await ensureSystemTemplates();

      // Skip credential validation in update mode - credentials are optional
      // User might not be changing credentials, and sensitive fields are cleared for security

      const config = getPrebuiltConfig(type);
      if (!config) {
        throw new Error('Invalid destination type');
      }

      // Generate destination data
      const destinationUrl = generateDestinationUrl(type, credentials);
      const destinationHeaders = generateDestinationHeaders(type, credentials);

      // Build update payload (same structure as create)
      let destinationData: any;

      if (type === 'email') {
        destinationData = {
          name,
          type: 'email',
          template: config.templateName,
          skip_tls_verify: skipTlsVerify,
          output_format: 'json',
          destination_type_name: type,
          emails: Array.isArray(credentials.recipients)
            ? credentials.recipients
            : (credentials.recipients || '').split(',').map((e: string) => e.trim()).filter(Boolean),
          metadata: {
            prebuilt_type: type,
            ...Object.fromEntries(
              Object.entries(credentials).filter(([key]) =>
                !key.toLowerCase().includes('password') &&
                !key.toLowerCase().includes('key') &&
                !key.toLowerCase().includes('token')
              ).map(([k, v]) => [`credential_${k}`, String(v)])
            )
          }
        };
      } else {
        destinationData = {
          name,
          type: 'http',
          url: destinationUrl,
          method: config.method,
          template: config.templateName,
          skip_tls_verify: skipTlsVerify,
          headers: { ...destinationHeaders, ...headers },
          output_format: 'json',
          destination_type_name: type,
          metadata: {
            prebuilt_type: type,
            ...Object.fromEntries(
              Object.entries(credentials).filter(([key]) =>
                !key.toLowerCase().includes('password') &&
                !key.toLowerCase().includes('key') &&
                !key.toLowerCase().includes('token')
              ).map(([k, v]) => [`credential_${k}`, String(v)])
            )
          }
        };

        if (type === 'servicenow') {
          const authString = btoa(`${credentials.username}:${credentials.password}`);
          destinationData.headers = {
            ...destinationData.headers,
            'Authorization': `Basic ${authString}`
          };
        }
      }

      // Update the destination
      await alertDestinationService.update({
        org_identifier: organizationIdentifier.value,
        destination_name: originalName, // Use original name for lookup
        data: destinationData
      });

      $q.notify({
        type: 'positive',
        message: t('alerts.destinations.saved'),
        timeout: 2000
      });

    } catch (error: any) {
      console.error('Failed to update prebuilt destination:', error);
      $q.notify({
        type: 'negative',
        message: t('alerts.destinations.saveError'),
        caption: error.message
      });
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Detect if an existing destination matches a prebuilt pattern
   */
  function detectPrebuiltType(destination: any): PrebuiltTypeId | null {
    if (destination.metadata?.prebuilt_type) {
      return destination.metadata.prebuilt_type;
    }

    // Check for email type (email destinations are always prebuilt)
    // Email destinations don't have URL and are created through prebuilt flow
    if (destination.type === 'email') {
      return 'email';
    }

    // Try to detect based on URL pattern
    if (destination.url) {
      return detectPrebuiltTypeFromUrl(destination.url) as PrebuiltTypeId;
    }

    return null;
  }

  /**
   * Convert an existing custom destination to prebuilt
   */
  async function convertToPrebuilt(
    destinationName: string,
    targetType: PrebuiltTypeId
  ): Promise<void> {
    try {
      isLoading.value = true;

      // Get existing destination
      const existing = await alertDestinationService.get_by_name({
        org_identifier: organizationIdentifier.value,
        destination_name: destinationName
      });

      const config = getPrebuiltConfig(targetType);
      if (!config) {
        throw new Error('Invalid target type');
      }

      // Ensure system templates exist
      await ensureSystemTemplates();

      // Update destination with prebuilt configuration
      const updatedData = {
        ...existing,
        template: config.templateName,
        headers: {
          ...existing.headers,
          ...config.headers
        },
        metadata: {
          ...existing.metadata,
          prebuilt_type: targetType,
          converted_from_custom: true,
          conversion_date: new Date().toISOString()
        }
      };

      await alertDestinationService.update({
        org_identifier: organizationIdentifier.value,
        destination_name: destinationName,
        data: updatedData
      });

      $q.notify({
        type: 'positive',
        message: t('alerts.prebuilt.conversionSuccess'),
        timeout: 2000
      });

    } catch (error: any) {
      console.error('Failed to convert destination:', error);
      $q.notify({
        type: 'negative',
        message: t('alerts.prebuilt.conversionError'),
        caption: error.message
      });
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  // Return composable interface
  return {
    // State
    isLoading,
    isTestInProgress,
    lastTestResult,

    // Computed
    availableTypes,
    popularTypes,
    typesByCategory,

    // Methods
    ensureSystemTemplates,
    validateCredentials,
    generatePreview,
    testDestination,
    createDestination,
    updateDestination,
    detectPrebuiltType,
    convertToPrebuilt,

    // Utility functions
    getPrebuiltConfig,
    isPrebuiltType,
    generateDestinationUrl,
    generateDestinationHeaders
  };
}