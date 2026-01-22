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
 * Email prebuilt destination configuration
 * Uses HTML email template for rich formatting
 */
export const emailTemplate = {
  name: 'system-prebuilt-email',
  body: `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OpenObserve Alert</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background-color: #d63638; color: white; padding: 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { padding: 30px; }
        .alert-info { background-color: #f8f9fa; border-left: 4px solid #d63638; padding: 15px; margin: 20px 0; }
        .alert-info h2 { margin: 0 0 10px 0; color: #d63638; font-size: 18px; }
        .details { margin: 20px 0; }
        .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
        .detail-row:last-child { border-bottom: none; }
        .detail-label { font-weight: bold; color: #666; }
        .detail-value { color: #333; }
        .button { display: inline-block; background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0; }
        .footer { background-color: #f8f9fa; padding: 15px; text-align: center; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚨 Alert Notification</h1>
        </div>
        <div class="content">
            <div class="alert-info">
                <h2>{alert_name}</h2>
                <p>An alert has been triggered in your OpenObserve monitoring system.</p>
            </div>

            <div class="details">
                <div class="detail-row">
                    <span class="detail-label">Stream:</span>
                    <span class="detail-value">{stream_name}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Type:</span>
                    <span class="detail-value">{stream_type}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Status:</span>
                    <span class="detail-value">🔴 Firing</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Count:</span>
                    <span class="detail-value">{alert_count}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Threshold:</span>
                    <span class="detail-value">{alert_operator} {alert_threshold}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Time:</span>
                    <span class="detail-value">{alert_time}</span>
                </div>
            </div>

            <a href="{alert_url}" class="button">View in OpenObserve</a>
        </div>
        <div class="footer">
            This alert was generated automatically by OpenObserve. Do not reply to this email.
        </div>
    </div>
</body>
</html>`,
  type: 'email' as const,
  isDefault: false
};

export const emailConfig: PrebuiltConfig = {
  templateName: 'system-prebuilt-email',
  templateBody: emailTemplate.body,
  headers: {
    'Content-Type': 'text/html'
  },
  method: 'post',
  urlValidator: (url: string) => false, // Email doesn't use URLs - always return false
  credentialFields: [
    {
      key: 'recipients',
      label: 'Recipient Email Addresses',
      type: 'email',
      required: true,
      hint: 'Comma-separated email addresses',
      validator: (emails: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const emailList = emails.split(',').map(e => e.trim());
        const invalidEmails = emailList.filter(email => !emailRegex.test(email));
        return invalidEmails.length === 0 || `Invalid email addresses: ${invalidEmails.join(', ')}`;
      }
    },
    {
      key: 'ccRecipients',
      label: 'CC Recipients (optional)',
      type: 'email',
      required: false,
      hint: 'Comma-separated CC email addresses'
    },
    {
      key: 'subject',
      label: 'Email Subject (optional)',
      type: 'text',
      required: false,
      hint: 'Custom subject line (defaults to alert name)'
    }
  ]
};

import emailLogo from '@/assets/images/alerts/destinations/email.png';

export const emailDestinationType = {
  id: 'email',
  name: 'Email',
  description: 'Send HTML formatted email notifications',
  icon: 'email',
  image: emailLogo,
  popular: true,
  category: 'email'
};