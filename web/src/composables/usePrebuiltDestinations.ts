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

import { ref, computed, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';

// Services
import alertDestinationService from '@/services/alert_destination';
import templatesService from '@/services/alert_templates';

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

/**
 * System Templates Architecture:
 * - Templates are managed by the backend (src/config/src/prebuilt_loader.rs)
 * - Frontend fetches templates via GET /api/{org}/alerts/templates/system/prebuilt
 * - Templates are cached in memory to avoid repeated API calls
 * - Fallback templates in PrebuiltConfig are used only if backend fetch fails
 */
const systemTemplatesCache = ref<Map<string, any>>(new Map());

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
  /**
   * Ensure system templates exist for all prebuilt destinations
   * Creates templates if they don't exist in the backend
   */
  /**
   * Fetch system templates from backend and cache them
   * System templates are now managed entirely by the backend
   */
  async function fetchSystemTemplates(): Promise<void> {
    try {
      // Check if already cached
      if (systemTemplatesCache.value.size > 0) {
        return;
      }

      // Fetch system templates from backend
      const response = await templatesService.get_system_templates({
        org_identifier: organizationIdentifier.value,
      });

      // Handle response and cache templates
      let templates: any[] = [];
      if (Array.isArray(response.data)) {
        templates = response.data;
      } else if (response.data?.list && Array.isArray(response.data.list)) {
        templates = response.data.list;
      }

      // Cache templates by name for quick lookup
      systemTemplatesCache.value.clear();
      templates.forEach((template: any) => {
        systemTemplatesCache.value.set(template.name, template);
      });

      console.log(`Fetched ${templates.length} system templates from backend`);
    } catch (error) {
      console.error('Failed to fetch system templates from backend:', error);
      // Don't throw - allow destination operations to proceed
      // Backend will handle template resolution
    }
  }

  /**
   * Get a cached system template by type
   */
  function getSystemTemplate(type: PrebuiltTypeId): any | null {
    const templateName = `prebuilt_${type}`;
    return systemTemplatesCache.value.get(templateName) || null;
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
  async function generatePreview(type: PrebuiltTypeId, credentials?: Record<string, any>): Promise<string> {
    const config = getPrebuiltConfig(type);
    if (!config) return '';

    // Ensure system templates are fetched
    await fetchSystemTemplates();

    // Get template from cache or fetch from backend
    let templateBody = config.templateBody; // Fallback
    const cachedTemplate = getSystemTemplate(type);

    if (cachedTemplate?.body) {
      templateBody = cachedTemplate.body;
    } else {
      // Try fetching directly if not in cache
      try {
        const templateResponse = await templatesService.get_by_name({
          org_identifier: organizationIdentifier.value,
          template_name: config.templateName
        });
        if (templateResponse.data?.body) {
          templateBody = templateResponse.data.body;
        }
      } catch (error) {
        console.warn('Failed to fetch template from backend, using fallback:', error);
        // Continue with hardcoded template as fallback
      }
    }

    // Generate realistic alert URL using current browser context
    const baseUrl = window.location.origin;
    const orgId = organizationIdentifier.value;
    const now = Date.now() * 1000; // microseconds
    const oneHourAgo = now - (60 * 60 * 1000 * 1000);

    // Sample alert data with realistic context
    const sampleData: Record<string, string> = {
      alert_name: 'Test Alert - High CPU Usage',
      stream_name: 'system-metrics',
      stream_type: 'logs',
      alert_count: '15',
      alert_operator: 'greater than',
      alert_threshold: '80%',
      alert_time: new Date().toLocaleString(),
      // Use actual OpenObserve instance URL instead of fake example
      alert_url: `${baseUrl}/web/logs?org_identifier=${orgId}&stream_type=logs&stream=system-metrics&from=${oneHourAgo}&to=${now}&type=alert_destination_test`,
      // Default values for credential-based fields
      integration_key: 'sample-integration-key',
      severity: 'error',
      assignment_group: 'IT Operations',
      api_key: 'sample-api-key'
    };

    // Override with actual credentials if provided
    if (credentials) {
      // Map credential keys to template placeholder names
      if (credentials.integrationKey) {
        sampleData.integration_key = credentials.integrationKey;
      }
      if (credentials.severity) {
        sampleData.severity = credentials.severity;
      }
      if (credentials.apiKey) {
        sampleData.api_key = credentials.apiKey;
      }
      if (credentials.assignmentGroup) {
        sampleData.assignment_group = credentials.assignmentGroup;
      }
    }

    // Replace placeholders in fetched template with sample data
    let preview = templateBody;
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
        const result = {
          success: false,
          error: `Validation error: ${firstError}`,
          timestamp: Date.now()
        };
        lastTestResult.value = result;
        return result;
      }

      const config = getPrebuiltConfig(type);
      if (!config) {
        const result = {
          success: false,
          error: 'Invalid destination type',
          timestamp: Date.now()
        };
        lastTestResult.value = result;
        return result;
      }

      // Ensure system templates are fetched
      await fetchSystemTemplates();

      // Get template from cache or fetch from backend
      let templateBody = config.templateBody; // Fallback
      const cachedTemplate = getSystemTemplate(type);

      if (cachedTemplate?.body) {
        templateBody = cachedTemplate.body;
      } else {
        // Try fetching directly if not in cache
        try {
          const templateResponse = await templatesService.get_by_name({
            org_identifier: organizationIdentifier.value,
            template_name: config.templateName
          });
          if (templateResponse.data?.body) {
            templateBody = templateResponse.data.body;
          }
        } catch (error) {
          console.warn('Failed to fetch template from backend, using fallback:', error);
          // Continue with hardcoded template as fallback
        }
      }

      // Generate test payload with fetched template
      const testUrl = generateDestinationUrl(type, credentials);
      const testHeaders = generateDestinationHeaders(type, credentials);

      // Generate preview using fetched template
      const baseUrl = window.location.origin;
      const orgId = organizationIdentifier.value;
      const now = Date.now() * 1000; // microseconds
      const oneHourAgo = now - (60 * 60 * 1000 * 1000);

      const sampleData: Record<string, string> = {
        alert_name: 'Test Alert - High CPU Usage',
        stream_name: 'system-metrics',
        stream_type: 'logs',
        alert_count: '15',
        alert_operator: 'greater than',
        alert_threshold: '80%',
        alert_time: new Date().toLocaleString(),
        alert_url: `${baseUrl}/web/logs?org_identifier=${orgId}&stream_type=logs&stream=system-metrics&from=${oneHourAgo}&to=${now}&type=alert_destination_test`,
        integration_key: 'sample-integration-key',
        severity: 'error',
        assignment_group: 'IT Operations',
        api_key: 'sample-api-key'
      };

      // Override with actual credentials
      if (credentials) {
        if (credentials.integrationKey) sampleData.integration_key = credentials.integrationKey;
        if (credentials.severity) sampleData.severity = credentials.severity;
        if (credentials.apiKey) sampleData.api_key = credentials.apiKey;
        if (credentials.assignmentGroup) sampleData.assignment_group = credentials.assignmentGroup;
      }

      // Replace placeholders in fetched template
      let testBody = templateBody;
      for (const [key, value] of Object.entries(sampleData)) {
        const regex = new RegExp(`{${key}}`, 'g');
        testBody = testBody.replace(regex, value);
      }

      // For email type, use email-specific test
      if (type === 'email') {
        // Email testing would require backend SMTP setup
        // For now, just validate email format and show success
        const result = {
          success: true,
          timestamp: Date.now()
        };
        lastTestResult.value = result;
        return result;
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
        success: testResult.data.success || false,
        timestamp: Date.now(),
        error: testResult.data.error,
        statusCode: testResult.data.statusCode,
        responseBody: testResult.data.responseBody
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
      await fetchSystemTemplates();

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
      await fetchSystemTemplates();

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

    // Check if template name starts with "prebuilt_" or "system-prebuilt-" - this is the definitive indicator
    if (destination.template && typeof destination.template === 'string') {
      if (destination.template.startsWith('system-prebuilt-')) {
        // Extract type from template name (e.g., "system-prebuilt-email" -> "email")
        return destination.template.replace('system-prebuilt-', '') as PrebuiltTypeId;
      }
      if (destination.template.startsWith('prebuilt_')) {
        // Extract type from template name (e.g., "prebuilt_slack" -> "slack")
        return destination.template.replace('prebuilt_', '') as PrebuiltTypeId;
      }
    }

    // Try to detect based on URL pattern (fallback for destinations without template info)
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
      await fetchSystemTemplates();

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

  // Watch for organization changes and clear cache
  watch(organizationIdentifier, () => {
    systemTemplatesCache.value.clear();
  });

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
    fetchSystemTemplates,
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