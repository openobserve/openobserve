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
  urlValidator: (url: string) =>
    url.includes('.service-now.com') && url.includes('/api/now/table/incident'),
  credentialFields: [
    {
      key: 'instanceUrl',
      label: 'ServiceNow Instance URL',
      type: 'text',
      required: true,
      hint: 'https://your-instance.service-now.com/api/now/table/incident',
      validator: (url: string) =>
        (url.includes('.service-now.com') && url.includes('/api/now/table/incident')) ||
        'URL should be like https://instance.service-now.com/api/now/table/incident'
    },
    {
      key: 'username',
      label: 'Username',
      type: 'text',
      required: true,
      hint: 'ServiceNow username with incident creation permissions'
    },
    {
      key: 'password',
      label: 'Password',
      type: 'password',
      required: true,
      hint: 'ServiceNow password or API token'
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

export const servicenowDestinationType = {
  id: 'servicenow',
  name: 'ServiceNow',
  description: 'Create incidents in ServiceNow',
  icon: 'servicenow-icon',
  popular: false,
  category: 'incident'
};