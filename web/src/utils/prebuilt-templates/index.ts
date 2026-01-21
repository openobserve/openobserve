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

/**
 * Prebuilt alert destination templates and configurations
 * Provides predefined templates for popular platforms with simplified setup
 */

// Types
export * from './types';

// Template configurations
export { slackTemplate, slackConfig, slackDestinationType } from './slack';
export { discordTemplate, discordConfig, discordDestinationType } from './discord';
export { msteamsTemplate, msteamsConfig, msteamsDestinationType } from './msteams';
export { pagerdutyTemplate, pagerdutyConfig, pagerdutyDestinationType } from './pagerduty';
export { servicenowTemplate, servicenowConfig, servicenowDestinationType } from './servicenow';
export { emailTemplate, emailConfig, emailDestinationType } from './email';
export { opsgenieTemplate, opsgenieConfig, opsgenieDestinationType } from './opsgenie';

import { slackConfig, slackDestinationType } from './slack';
import { discordConfig, discordDestinationType } from './discord';
import { msteamsConfig, msteamsDestinationType } from './msteams';
import { pagerdutyConfig, pagerdutyDestinationType } from './pagerduty';
import { servicenowConfig, servicenowDestinationType } from './servicenow';
import { emailConfig, emailDestinationType } from './email';
import { opsgenieConfig, opsgenieDestinationType } from './opsgenie';
import { PrebuiltConfig, PrebuiltType } from './types';

/**
 * All available prebuilt destination types
 */
export const PREBUILT_DESTINATION_TYPES: PrebuiltType[] = [
  slackDestinationType as PrebuiltType,
  discordDestinationType as PrebuiltType,
  msteamsDestinationType as PrebuiltType,
  emailDestinationType as PrebuiltType,
  pagerdutyDestinationType as PrebuiltType,
  opsgenieDestinationType as PrebuiltType,
  servicenowDestinationType as PrebuiltType
];

/**
 * Configuration mapping for all prebuilt destination types
 */
export const PREBUILT_CONFIGS: Record<string, PrebuiltConfig> = {
  slack: slackConfig,
  discord: discordConfig,
  msteams: msteamsConfig,
  pagerduty: pagerdutyConfig,
  servicenow: servicenowConfig,
  email: emailConfig,
  opsgenie: opsgenieConfig
};

/**
 * Get configuration for a specific prebuilt destination type
 */
export function getPrebuiltConfig(type: string): PrebuiltConfig | null {
  return PREBUILT_CONFIGS[type] || null;
}

/**
 * Check if a destination type is prebuilt
 */
export function isPrebuiltType(type: string): boolean {
  return type in PREBUILT_CONFIGS;
}

/**
 * Get all prebuilt destination types grouped by category
 */
export function getPrebuiltTypesByCategory() {
  const categories = {
    messaging: PREBUILT_DESTINATION_TYPES.filter(t => t.category === 'messaging'),
    incident: PREBUILT_DESTINATION_TYPES.filter(t => t.category === 'incident'),
    email: PREBUILT_DESTINATION_TYPES.filter(t => t.category === 'email'),
    custom: []
  };
  return categories;
}

/**
 * Get popular prebuilt destination types (for prioritized display)
 */
export function getPopularPrebuiltTypes(): PrebuiltType[] {
  return PREBUILT_DESTINATION_TYPES.filter(t => t.popular);
}

/**
 * Detect if a URL matches a prebuilt destination pattern
 */
export function detectPrebuiltTypeFromUrl(url: string): string | null {
  for (const [type, config] of Object.entries(PREBUILT_CONFIGS)) {
    if (config.urlValidator(url)) {
      return type;
    }
  }
  return null;
}

/**
 * Generate URL for prebuilt destination based on credentials
 */
export function generateDestinationUrl(type: string, credentials: Record<string, any>): string {
  if (!credentials) {
    console.error('generateDestinationUrl: credentials is null or undefined');
    return '';
  }

  switch (type) {
    case 'slack':
    case 'discord':
    case 'msteams':
      return credentials.webhookUrl || '';
    case 'servicenow':
      return credentials.instanceUrl || '';
    case 'pagerduty':
      return 'https://events.pagerduty.com/v2/enqueue';
    case 'opsgenie':
      return credentials.euRegion
        ? 'https://api.eu.opsgenie.com/v2/alerts'
        : 'https://api.opsgenie.com/v2/alerts';
    case 'email':
      return ''; // Email doesn't use URL
    default:
      return '';
  }
}

/**
 * Generate headers for prebuilt destination based on credentials
 */
export function generateDestinationHeaders(type: string, credentials: Record<string, any>): Record<string, string> {
  const config = getPrebuiltConfig(type);
  if (!config) return {};

  const headers = { ...config.headers };

  // Add dynamic headers based on credentials
  switch (type) {
    case 'pagerduty':
      // PagerDuty uses X-Routing-Key header for integration key
      if (credentials.integrationKey) {
        headers['X-Routing-Key'] = credentials.integrationKey;
      }
      break;
    case 'opsgenie':
      headers['Authorization'] = `GenieKey ${credentials.apiKey}`;
      break;
    case 'servicenow':
      // Note: Basic auth credentials are passed separately to backend for secure handling
      // Backend will encode credentials and add Authorization header
      // DO NOT encode credentials on frontend for security reasons
      break;
  }

  return headers;
}