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

import { PrebuiltConfig } from "./types";

const TEAMS_WEBHOOK_ALLOWED_HOSTS = ["outlook.office.com", "webhook.office.com"];
const TEAMS_WORKFLOW_ALLOWED_HOST_SUFFIXES = [".logic.azure.com", ".api.powerplatform.com"];

function hasTeamsWorkflowPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return path.includes("/workflows/") && path.includes("/triggers/manual/paths/invoke");
}

function isTeamsWorkflowHost(hostname: string): boolean {
  return TEAMS_WORKFLOW_ALLOWED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function isValidTeamsWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:") {
      return false;
    }

    return (
      TEAMS_WEBHOOK_ALLOWED_HOSTS.includes(hostname) ||
      (isTeamsWorkflowHost(hostname) && hasTeamsWorkflowPath(parsed.pathname))
    );
  } catch {
    return false;
  }
}

/**
 * Microsoft Teams prebuilt destination configuration
 * Uses Adaptive Cards for rich formatting
 */
export const msteamsTemplate = {
  name: "prebuilt_msteams",
  body: JSON.stringify(
    {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      themeColor: "D63638",
      summary: "Alert: {alert_name}",
      sections: [
        {
          activityTitle: "🚨 Alert: {alert_name}",
          activitySubtitle: "OpenObserve Alert Notification",
          activityImage: "https://openobserve.ai/favicon.ico",
          facts: [
            {
              name: "Stream",
              value: "{stream_name}",
            },
            {
              name: "Type",
              value: "{stream_type}",
            },
            {
              name: "Status",
              value: "🔴 Firing",
            },
            {
              name: "Count",
              value: "{alert_count}",
            },
            {
              name: "Threshold",
              value: "{alert_operator} {alert_threshold}",
            },
            {
              name: "Time",
              value: "{alert_time}",
            },
          ],
          markdown: true,
        },
      ],
      potentialActions: [
        {
          "@type": "OpenUri",
          name: "View in OpenObserve",
          targets: [
            {
              os: "default",
              uri: "{alert_url}",
            },
          ],
        },
      ],
    },
    null,
    2,
  ),
  type: "http" as const,
  isDefault: false,
};

export const msteamsConfig: PrebuiltConfig = {
  templateName: "prebuilt_msteams",
  templateBody: msteamsTemplate.body,
  headers: {
    "Content-Type": "application/json",
  },
  method: "post",
  urlValidator: (url: string) => isValidTeamsWebhookUrl(url),
  credentialFields: [
    {
      key: "webhookUrl",
      labelKey: "alerts.prebuiltDestinations.msteamsWebhookUrl",
      type: "text",
      required: true,
      hint: "Get your webhook URL from Teams channel connectors or Workflows",
      validator: (url: string) =>
        isValidTeamsWebhookUrl(url) || {
          key: "alerts.prebuiltDestinations.invalidMsteamsWebhookUrl",
        },
    },
  ],
};

import msteamsLogo from "@/assets/images/alerts/destinations/msteams.png";

export const msteamsDestinationType = {
  id: "msteams",
  name: "Microsoft Teams",
  description: "Send notifications to Teams channels",
  icon: "msteams",
  image: msteamsLogo,
  popular: true,
  category: "messaging",
};
