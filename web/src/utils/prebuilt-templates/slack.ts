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
 * Slack prebuilt destination configuration
 * Provides predefined template and configuration for Slack webhook notifications
 */
export const slackTemplate = {
  name: 'system-prebuilt-slack',
  body: JSON.stringify({
    text: "🚨 *Alert: {alert_name}*",
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🚨 {alert_name}"
        }
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: "*Stream:*\n{stream_name}" },
          { type: "mrkdwn", text: "*Type:*\n{stream_type}" },
          { type: "mrkdwn", text: "*Status:*\n🔴 Firing" },
          { type: "mrkdwn", text: "*Count:*\n{alert_count}" }
        ]
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Threshold Exceeded:* {alert_operator} {alert_threshold}"
        }
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View in OpenObserve" },
            url: "{alert_url}"
          }
        ]
      }
    ]
  }, null, 2),
  type: 'http' as const,
  isDefault: false
};

export const slackConfig: PrebuiltConfig = {
  templateName: 'system-prebuilt-slack',
  templateBody: slackTemplate.body,
  headers: {
    'Content-Type': 'application/json'
  },
  method: 'post',
  urlValidator: (url: string) => {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      return parsed.protocol === 'https:' &&
             (hostname === 'hooks.slack.com' || hostname.endsWith('.hooks.slack.com'));
    } catch {
      return false;
    }
  },
  credentialFields: [
    {
      key: 'webhookUrl',
      label: 'Slack Webhook URL',
      type: 'text',
      required: true,
      hint: 'Get your webhook URL from Slack App settings',
      validator: (url: string) => {
        try {
          const parsed = new URL(url);
          const hostname = parsed.hostname.toLowerCase();
          return (parsed.protocol === 'https:' &&
                  (hostname === 'hooks.slack.com' || hostname.endsWith('.hooks.slack.com'))) ||
                 'Invalid Slack webhook URL';
        } catch {
          return 'Invalid Slack webhook URL';
        }
      }
    },
    {
      key: 'channel',
      label: 'Channel (optional)',
      type: 'text',
      required: false,
      hint: 'e.g., #alerts'
    }
  ]
};

import slackLogo from '@/assets/images/alerts/destinations/slack.png';

export const slackDestinationType = {
  id: 'slack',
  name: 'Slack',
  description: 'Send notifications to Slack channels',
  icon: 'slack',
  image: slackLogo,
  popular: true,
  category: 'messaging'
};