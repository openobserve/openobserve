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
 * Opsgenie prebuilt destination configuration
 * Creates alerts via Opsgenie Alert API
 */
export const opsgenieTemplate = {
  name: 'system-prebuilt-opsgenie',
  body: JSON.stringify({
    "message": "OpenObserve Alert: {alert_name}",
    "alias": "openobserve-{alert_name}",
    "description": "Alert Details:\n\nStream: {stream_name}\nType: {stream_type}\nCount: {alert_count}\nThreshold: {alert_operator} {alert_threshold}\nTime: {alert_time}",
    "tags": ["openobserve", "{stream_type}", "{stream_name}"],
    "priority": "P3",
    "entity": "{stream_name}",
    "source": "OpenObserve",
    "details": {
      "alert_name": "{alert_name}",
      "stream_name": "{stream_name}",
      "stream_type": "{stream_type}",
      "alert_count": "{alert_count}",
      "alert_operator": "{alert_operator}",
      "alert_threshold": "{alert_threshold}",
      "alert_time": "{alert_time}",
      "alert_url": "{alert_url}"
    },
    "actions": ["View in OpenObserve"]
  }, null, 2),
  type: 'http' as const,
  isDefault: false
};

export const opsgenieConfig: PrebuiltConfig = {
  templateName: 'system-prebuilt-opsgenie',
  templateBody: opsgenieTemplate.body,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'GenieKey {api_key}'
  },
  method: 'post',
  urlValidator: (url: string) =>
    url === 'https://api.opsgenie.com/v2/alerts' || url === 'https://api.eu.opsgenie.com/v2/alerts',
  credentialFields: [
    {
      key: 'apiKey',
      label: 'Opsgenie API Key',
      type: 'password',
      required: true,
      hint: 'Get your API key from Opsgenie integration settings',
      validator: (key: string) =>
        key.length > 30 || 'Opsgenie API key should be longer than 30 characters'
    },
    {
      key: 'euRegion',
      label: 'EU Region',
      type: 'toggle',
      required: false,
      hint: 'Enable for EU-based Opsgenie instances'
    },
    {
      key: 'priority',
      label: 'Default Priority',
      type: 'select',
      required: false,
      options: [
        { label: 'P1 (Critical)', value: 'P1', description: 'Highest priority alerts' },
        { label: 'P2 (High)', value: 'P2', description: 'High priority alerts' },
        { label: 'P3 (Moderate)', value: 'P3', description: 'Moderate priority alerts' },
        { label: 'P4 (Low)', value: 'P4', description: 'Low priority alerts' },
        { label: 'P5 (Informational)', value: 'P5', description: 'Informational alerts' }
      ]
    }
  ]
};

import opsgenieLogo from '@/assets/images/alerts/destinations/opsgenie.png';

export const opsgenieDestinationType = {
  id: 'opsgenie',
  name: 'Opsgenie',
  description: 'Create alerts in Opsgenie',
  icon: 'opsgenie',
  image: opsgenieLogo,
  popular: true,
  category: 'incident'
};