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

import { PrebuiltConfig } from './types';

/**
 * PagerDuty prebuilt destination configuration
 * Uses PagerDuty Events API v2 for incident creation
 */
export const pagerdutyTemplate = {
  name: 'system-prebuilt-pagerduty',
  body: JSON.stringify({
    "routing_key": "{integration_key}",
    "event_action": "trigger",
    "payload": {
      "summary": "OpenObserve Alert: {alert_name}",
      "source": "openobserve",
      "severity": "{severity}",
      "component": "{stream_name}",
      "group": "{stream_type}",
      "class": "alert",
      "custom_details": {
        "alert_name": "{alert_name}",
        "stream_name": "{stream_name}",
        "stream_type": "{stream_type}",
        "alert_count": "{alert_count}",
        "alert_operator": "{alert_operator}",
        "alert_threshold": "{alert_threshold}",
        "alert_time": "{alert_time}",
        "alert_url": "{alert_url}"
      }
    },
    "links": [
      {
        "href": "{alert_url}",
        "text": "View in OpenObserve"
      }
    ]
  }, null, 2),
  type: 'http' as const,
  isDefault: false
};

export const pagerdutyConfig: PrebuiltConfig = {
  templateName: 'system-prebuilt-pagerduty',
  templateBody: pagerdutyTemplate.body,
  headers: {
    'Content-Type': 'application/json'
  },
  method: 'post',
  urlValidator: (url: string) => url === 'https://events.pagerduty.com/v2/enqueue',
  credentialFields: [
    {
      key: 'integrationKey',
      label: 'Integration Key',
      type: 'password',
      required: true,
      hint: 'Get your integration key from PagerDuty service settings',
      validator: (key: string) =>
        key.length === 32 || 'PagerDuty integration key should be 32 characters'
    },
    {
      key: 'severity',
      label: 'Default Severity',
      type: 'select',
      required: true,
      options: [
        { label: 'Critical', value: 'critical', description: 'Highest priority incidents' },
        { label: 'Error', value: 'error', description: 'Standard error incidents' },
        { label: 'Warning', value: 'warning', description: 'Warning level incidents' },
        { label: 'Info', value: 'info', description: 'Informational incidents' }
      ]
    }
  ]
};

import pagerdutyLogo from '@/assets/images/alerts/destinations/pagerduty.png';

export const pagerdutyDestinationType = {
  id: 'pagerduty',
  name: 'PagerDuty',
  description: 'Create incidents in PagerDuty',
  icon: 'pagerduty',
  image: pagerdutyLogo,
  popular: true,
  category: 'incident'
};