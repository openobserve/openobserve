// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { raw } from "@/types/i18n";
import type { ProtocolCheck, SyntheticsLocation } from "@/types/synthetics";
import { defaultProtocolConfig } from "@/utils/synthetics/buildPayload";
import type { SyntheticPrefillInput } from "@/components/synthetics/prefill/syntheticPrefillContract";

export const internalPrefill: SyntheticPrefillInput = {
  version: 1,
  source: "autoobserve",
  sourceLabel: "Suggested by AutoObserve for svc-c",
  name: "svc-c health",
  folder: "ops",
  type: "http",
  url: "http://svc-c.ns-a.svc.cluster.local:8080/healthz",
  method: "GET",
  locations: ["cluster-k-agents", "us-east"],
  destinations: ["ops-webhook"],
  intervalMinutes: 5,
  tags: ["service:svc-c", "namespace:ns-a", "cluster:cluster-k"],
  suggested: ["folder", "tags", "url", "locations", "destinations"],
  service: { name: "svc-c", cluster: "cluster-k", namespace: "ns-a" },
  evidence: { reach: "private", urlFrom: "traces", folderAlerts: 3, destinationAlerts: 3 },
};

export const publicPrefill: SyntheticPrefillInput = {
  ...internalPrefill,
  name: "checkout health",
  url: "https://checkout.demo.test/health",
  locations: ["us-east", "eu-west", "ap-south"],
  tags: ["service:checkout", "namespace:shop", "cluster:cluster-p"],
  service: { name: "checkout", cluster: "cluster-p", namespace: "shop" },
  evidence: { reach: "public", urlFrom: "traces", folderAlerts: 3, destinationAlerts: 3 },
};

export const prefillLocations = [
  { id: "us-east", label: raw("US East"), region: "us-east-1", provider: "aws", kind: "public" },
  { id: "eu-west", label: raw("EU West"), region: "eu-west-1", provider: "aws", kind: "public" },
  { id: "ap-south", label: raw("Asia Pacific"), region: "ap-south-1", provider: "aws" },
  {
    id: "cluster-k-agents",
    label: raw("cluster-k agents"),
    region: "cluster-k",
    provider: "private",
    kind: "private",
    types: ["http"],
    status: "online",
  },
  {
    id: "dc-east",
    label: raw("dc-east"),
    region: "dc-east",
    provider: "private",
    kind: "private",
    types: [],
    status: "pending",
  },
] satisfies SyntheticsLocation[];

export function blankHttpCheck(): ProtocolCheck {
  return {
    checkType: "http",
    name: "",
    url: "",
    enabled: true,
    folder: "default",
    tags: [],
    journey: [],
    schedule: { type: "interval", intervalValue: 5, intervalUnit: "minutes" },
    locations: [],
    retries: 0,
    waitBeforeRetrySecs: 5,
    alertIfFails: 1,
    cooldownMins: 5,
    notifications: { destinations: [] },
    rum: { collect: false, sessionReplay: false },
    capture: { screenshot: "off", trace: "off" },
    variables: [],
    ...defaultProtocolConfig("http"),
  };
}
