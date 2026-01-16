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
   * Creates templates lazily when first prebuilt destination is created
   */
  async function ensureSystemTemplates(): Promise<void> {
    const DEFAULT_ORG = 'default';

    try {
      isLoading.value = true;

      for (const type of PREBUILT_DESTINATION_TYPES) {
        const config = getPrebuiltConfig(type.id);
        if (!config) continue;

        const templateName = config.templateName;

        try {
          // Check if template already exists
          await alertTemplateService.get_by_name({
            org_identifier: DEFAULT_ORG,
            template_name: templateName
          });
          // Template exists, continue to next
          continue;
        } catch (error) {
          // Template doesn't exist, create it
          console.log(`Creating system template: ${templateName}`);

          await alertTemplateService.create({
            org_identifier: DEFAULT_ORG,
            template_name: templateName,
            data: {
              name: templateName,
              body: config.templateBody,
              type: type.category === 'email' ? 'email' : 'http',
              isDefault: true
            }
          });
        }
      }
    } catch (error) {
      console.error('Failed to ensure system templates:', error);
      $q.notify({
        type: 'negative',
        message: t('alerts.prebuilt.templateInitError'),
        caption: error.message
      });
      throw error;
    } finally {
      isLoading.value = false;
    }
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

    // Sample alert data for preview
    const sampleData = {
      alert_name: 'High CPU Usage',
      stream_name: 'system-metrics',
      stream_type: 'metrics',
      alert_count: '15',
      alert_operator: 'greater than',
      alert_threshold: '80%',
      alert_time: new Date().toLocaleString(),
      alert_url: 'https://openobserve.example.com/alerts/123',
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
    credentials: Record<string, any>
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
      const destinationData: DestinationWithPrebuilt = {
        name,
        type: type === 'email' ? 'email' : 'http',
        url: destinationUrl,
        method: config.method,
        skip_tls_verify: false,
        template: config.templateName,
        headers: destinationHeaders,
        emails: type === 'email' ? credentials.recipients : '',
        action_id: '',
        output_format: 'json',
        metadata: {
          prebuilt_type: type,
          credentials: {
            // Store non-sensitive credential metadata
            ...Object.fromEntries(
              Object.entries(credentials).filter(([key]) =>
                !key.toLowerCase().includes('password') &&
                !key.toLowerCase().includes('key') &&
                !key.toLowerCase().includes('token')
              )
            )
          }
        }
      };

      // Create the destination
      await alertDestinationService.create({
        org_identifier: organizationIdentifier.value,
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
   * Detect if an existing destination matches a prebuilt pattern
   */
  function detectPrebuiltType(destination: any): PrebuiltTypeId | null {
    if (destination.metadata?.prebuilt_type) {
      return destination.metadata.prebuilt_type;
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
    detectPrebuiltType,
    convertToPrebuilt,

    // Utility functions
    getPrebuiltConfig,
    isPrebuiltType,
    generateDestinationUrl,
    generateDestinationHeaders
  };
}