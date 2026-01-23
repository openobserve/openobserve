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

const isValidServiceNowIncidentUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);

    // Only allow HTTP/S URLs
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    // Require a host within the service-now.com domain
    // Split hostname and verify the last two parts are exactly "service-now.com"
    if (hostname !== 'service-now.com') {
      const parts = hostname.split('.');
      if (parts.length < 3 || parts[parts.length - 2] !== 'service-now' || parts[parts.length - 1] !== 'com') {
        return false;
      }
    }

    // Require the incident table API path
    if (!parsed.pathname.startsWith('/api/now/table/incident')) {
      return false;
    }

    return true;
  } catch {
    // If URL parsing fails, the URL is not valid
    return false;
  }
};

/**
 * ServiceNow prebuilt destination configuration
 * Creates incidents via ServiceNow Table API
 */
export const servicenowTemplate = {
  name: 'system-prebuilt-servicenow',
  body: JSON.stringify({
    "short_description": "OpenObserve Alert: {alert_name}",
    "description": "Alert Details:\n\nStream: {stream_name}\nType: {stream_type}\nCount: {alert_count}\nThreshold: {alert_operator} {alert_threshold}\nTime: {alert_time}\n\nView in OpenObserve: {alert_url}",
    "category": "Software",
    "subcategory": "Operating System",
    "urgency": "2",
    "impact": "2",
    "priority": "2",
    "assignment_group": "{assignment_group}",
    "caller_id": "openobserve",
    "contact_type": "alert",
    "work_notes": "Incident created automatically by OpenObserve alert system"
  }, null, 2),
  type: 'http' as const,
  isDefault: false
};

export const servicenowConfig: PrebuiltConfig = {
  templateName: 'system-prebuilt-servicenow',
  templateBody: servicenowTemplate.body,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  method: 'post',
  urlValidator: (url: string) => isValidServiceNowIncidentUrl(url),
  credentialFields: [
    {
      key: 'instanceUrl',
      label: 'ServiceNow Instance URL',
      type: 'text',
      required: true,
      hint: 'https://your-instance.service-now.com/api/now/table/incident',
      validator: (url: string) =>
        isValidServiceNowIncidentUrl(url) ||
        'URL should be like https://instance.service-now.com/api/now/table/incident'
    },
    {
      key: 'username',
      label: 'Username',
      type: 'text',
      required: true,
      hint: 'ServiceNow username with incident creation permissions',
      validator: (value: string) => value.trim().length > 0 || 'Username is required'
    },
    {
      key: 'password',
      label: 'Password',
      type: 'password',
      required: true,
      hint: 'ServiceNow password or API token',
      validator: (value: string) => value.trim().length > 0 || 'Password is required'
    },
    {
      key: 'assignmentGroup',
      label: 'Assignment Group (optional)',
      type: 'text',
      required: false,
      hint: 'Group to assign incidents to (e.g., IT Operations)'
    }
  ]
};

import servicenowLogo from '@/assets/images/alerts/destinations/servicenow.png';

export const servicenowDestinationType = {
  id: 'servicenow',
  name: 'ServiceNow',
  description: 'Create incidents in ServiceNow',
  icon: 'servicenow',
  image: servicenowLogo,
  popular: true,
  category: 'incident'
};