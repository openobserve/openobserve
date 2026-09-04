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

import { gt, raw } from "@/types/i18n";
import { PrebuiltConfig, PrebuiltType } from "./types";

/**
 * PagerDuty prebuilt destination configuration
 * Uses PagerDuty Events API v2 for incident creation
 */
export const pagerdutyTemplate = {
  name: "prebuilt_pagerduty",
  body: JSON.stringify(
    {
      payload: {
        summary: "OpenObserve Alert: {alert_name}",
        severity: "{severity}",
        source: "{source}",
        component: "{stream_name}",
        group: "{stream_type}",
        class: "alert",
        custom_details: {
          alert_name: "{alert_name}",
          stream_name: "{stream_name}",
          stream_type: "{stream_type}",
          alert_count: "{alert_count}",
          alert_operator: "{alert_operator}",
          alert_threshold: "{alert_threshold}",
          alert_time: "{alert_trigger_time_str}",
          alert_url: "{alert_url}",
        },
      },
      routing_key: "{routing_key}",
      event_action: "trigger",
      links: [
        {
          href: "{alert_url}",
          text: "View in OpenObserve",
        },
      ],
    },
    null,
    2,
  ),
  type: "http" as const,
  isDefault: false,
};

export const pagerdutyConfig: PrebuiltConfig = {
  templateName: "prebuilt_pagerduty",
  templateBody: pagerdutyTemplate.body,
  headers: {
    "Content-Type": "application/json",
  },
  method: "post",
  urlValidator: (url: string) => url === "https://events.pagerduty.com/v2/enqueue",
  credentialFields: [
    {
      key: "integrationKey",
      labelKey: "alerts.prebuiltDestinations.pagerdutyIntegrationKey",
      type: "password",
      required: true,
      hintKey: "alerts.prebuiltDestinations.pagerdutyIntegrationKeyHelp",
      validator: (key: string) =>
        key.length === 32 || {
          key: "alerts.prebuiltDestinations.pagerdutyIntegrationKeyLength",
        },
    },
    {
      key: "severity",
      labelKey: "alerts.prebuiltDestinations.pagerdutySeverity",
      type: "select",
      required: true,
      // Getters, not resolved strings: this config object is module scope, so a
      // plain call would freeze the copy at the boot locale.
      options: [
        {
          get label() {
            return gt("alerts.prebuiltDestinations.severityCritical");
          },
          value: "critical",
          get description() {
            return gt("alert_destinations.severityCriticalDescription");
          },
        },
        {
          get label() {
            return gt("alerts.prebuiltDestinations.severityError");
          },
          value: "error",
          get description() {
            return gt("alert_destinations.severityErrorDescription");
          },
        },
        {
          get label() {
            return gt("alerts.prebuiltDestinations.severityWarning");
          },
          value: "warning",
          get description() {
            return gt("alert_destinations.severityWarningDescription");
          },
        },
        {
          get label() {
            return gt("alerts.prebuiltDestinations.severityInfo");
          },
          value: "info",
          get description() {
            return gt("alert_destinations.severityInfoDescription");
          },
        },
      ],
    },
  ],
};

import pagerdutyLogo from "@/assets/images/alerts/destinations/pagerduty.png";

export const pagerdutyDestinationType: PrebuiltType = {
  id: "pagerduty",
  name: raw("PagerDuty"),
  descriptionKey: "alert_destinations.prebuilt.pagerdutyDescription",
  icon: "pagerduty",
  image: pagerdutyLogo,
  popular: true,
  category: "incident",
};
