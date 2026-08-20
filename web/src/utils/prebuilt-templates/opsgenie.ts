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
 * Opsgenie prebuilt destination configuration
 * Creates alerts via Opsgenie Alert API
 */
export const opsgenieTemplate = {
  name: "prebuilt_opsgenie",
  body: JSON.stringify(
    {
      message: "OpenObserve Alert: {alert_name}",
      alias: "openobserve-{alert_name}",
      description:
        "Alert Details:\n\nStream: {stream_name}\nType: {stream_type}\nCount: {alert_count}\nThreshold: {alert_operator} {alert_threshold}\nTime: {alert_time}",
      tags: ["openobserve", "{stream_type}", "{stream_name}"],
      priority: "P3",
      entity: "{stream_name}",
      source: "OpenObserve",
      details: {
        alert_name: "{alert_name}",
        stream_name: "{stream_name}",
        stream_type: "{stream_type}",
        alert_count: "{alert_count}",
        alert_operator: "{alert_operator}",
        alert_threshold: "{alert_threshold}",
        alert_time: "{alert_time}",
        alert_url: "{alert_url}",
      },
      actions: ["View in OpenObserve"],
    },
    null,
    2,
  ),
  type: "http" as const,
  isDefault: false,
};

export const opsgenieConfig: PrebuiltConfig = {
  templateName: "prebuilt_opsgenie",
  templateBody: opsgenieTemplate.body,
  headers: {
    "Content-Type": "application/json",
    Authorization: "GenieKey {api_key}",
  },
  method: "post",
  urlValidator: (url: string) =>
    url === "https://api.opsgenie.com/v2/alerts" || url === "https://api.eu.opsgenie.com/v2/alerts",
  credentialFields: [
    {
      key: "apiKey",
      labelKey: "alerts.prebuiltDestinations.opsgenieApiKey",
      type: "password",
      required: true,
      hintKey: "alerts.prebuiltDestinations.opsgenieApiKeyHelp",
      validator: (key: string) =>
        key.length > 30 || {
          key: "alerts.prebuiltDestinations.opsgenieApiKeyLength",
        },
    },
    {
      key: "euRegion",
      labelKey: "alerts.prebuiltDestinations.opsgenieEuRegion",
      type: "toggle",
      required: false,
      hintKey: "alerts.prebuiltDestinations.opsgenieEuRegionHelp",
    },
    {
      key: "priority",
      labelKey: "alerts.prebuiltDestinations.opsgeniePriority",
      type: "select",
      required: false,
      // Getters, not resolved strings: this config object is module scope, so a
      // plain call would freeze the copy at the boot locale.
      options: [
        {
          get label() {
            return gt("alerts.prebuiltDestinations.priorityP1");
          },
          value: "P1",
          get description() {
            return gt("alert_destinations.priorityP1Description");
          },
        },
        {
          get label() {
            return gt("alerts.prebuiltDestinations.priorityP2");
          },
          value: "P2",
          get description() {
            return gt("alert_destinations.priorityP2Description");
          },
        },
        {
          get label() {
            return gt("alerts.prebuiltDestinations.priorityP3");
          },
          value: "P3",
          get description() {
            return gt("alert_destinations.priorityP3Description");
          },
        },
        {
          get label() {
            return gt("alerts.prebuiltDestinations.priorityP4");
          },
          value: "P4",
          get description() {
            return gt("alert_destinations.priorityP4Description");
          },
        },
        {
          get label() {
            return gt("alerts.prebuiltDestinations.priorityP5");
          },
          value: "P5",
          get description() {
            return gt("alert_destinations.priorityP5Description");
          },
        },
      ],
    },
  ],
};

import opsgenieLogo from "@/assets/images/alerts/destinations/opsgenie.png";

export const opsgenieDestinationType: PrebuiltType = {
  id: "opsgenie",
  name: raw("Opsgenie"),
  descriptionKey: "alert_destinations.prebuilt.opsgenieDescription",
  icon: "opsgenie",
  image: opsgenieLogo,
  popular: true,
  category: "incident",
};
