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
 * Discord prebuilt destination configuration
 * Provides predefined template and configuration for Discord webhook notifications
 */
export const discordTemplate = {
  name: 'system-prebuilt-discord',
  body: JSON.stringify({
    username: "OpenObserve Alerts",
    avatar_url: "https://openobserve.ai/favicon.ico",
    content: "🚨 **Alert: {alert_name}**",
    embeds: [
      {
        title: "{alert_name}",
        description: "An alert has been triggered in your OpenObserve monitoring system.",
        color: 14366016, // Red color (#DB4437)
        fields: [
          {
            name: "Stream",
            value: "{stream_name}",
            inline: true
          },
          {
            name: "Type",
            value: "{stream_type}",
            inline: true
          },
          {
            name: "Status",
            value: "🔴 Firing",
            inline: true
          },
          {
            name: "Count",
            value: "{alert_count}",
            inline: true
          },
          {
            name: "Threshold",
            value: "{alert_operator} {alert_threshold}",
            inline: true
          },
          {
            name: "Time",
            value: "{alert_time}",
            inline: true
          }
        ],
        footer: {
          text: "OpenObserve Alert Notification"
        },
        timestamp: new Date().toISOString()
      }
    ]
  }, null, 2),
  type: 'http' as const,
  isDefault: false
};

export const discordConfig: PrebuiltConfig = {
  templateName: 'system-prebuilt-discord',
  templateBody: discordTemplate.body,
  headers: {
    'Content-Type': 'application/json'
  },
  method: 'post',
  urlValidator: (url: string) => {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      return (hostname === 'discord.com' || hostname.endsWith('.discord.com')) &&
             parsed.pathname.startsWith('/api/webhooks/');
    } catch {
      return false;
    }
  },
  credentialFields: [
    {
      key: 'webhookUrl',
      label: 'Discord Webhook URL',
      type: 'text',
      required: true,
      hint: 'Get your webhook URL from Discord channel settings',
      validator: (url: string) => {
        try {
          const parsed = new URL(url);
          const hostname = parsed.hostname.toLowerCase();
          return ((hostname === 'discord.com' || hostname.endsWith('.discord.com')) &&
                  parsed.pathname.startsWith('/api/webhooks/')) ||
                 'Invalid Discord webhook URL';
        } catch {
          return 'Invalid Discord webhook URL';
        }
      }
    },
    {
      key: 'username',
      label: 'Bot Username (optional)',
      type: 'text',
      required: false,
      hint: 'Custom username for the webhook bot'
    }
  ]
};

import discordLogo from '@/assets/images/alerts/destinations/discord.png';

export const discordDestinationType = {
  id: 'discord',
  name: 'Discord',
  description: 'Send notifications to Discord channels',
  icon: 'discord',
  image: discordLogo,
  popular: true,
  category: 'messaging'
};
