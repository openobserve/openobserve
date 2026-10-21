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

import { orgKey } from "@/composables/query/keys";

export const fleetKeys = {
  all: (org: string) => orgKey(org, "fleet"),
  collectors: (org: string) => orgKey(org, "fleet", "collectors"),
  collector: (org: string, id: string) => orgKey(org, "fleet", "collector", id),
  collectorMetrics: (org: string, id: string, window: string) =>
    orgKey(org, "fleet", "collectorMetrics", id, window),
  summary: (org: string) => orgKey(org, "fleet", "summary"),
  tokens: (org: string) => orgKey(org, "fleet", "tokens"),
  fleets: (org: string) => orgKey(org, "fleet", "fleets"),
  configs: (org: string) => orgKey(org, "fleet", "configs"),
  config: (org: string, id: string) => orgKey(org, "fleet", "config", id),
  // Outside config(id), so refetching a config's detail never refetches its immutable versions.
  configVersions: (org: string, id: string) => orgKey(org, "fleet", "configVersion", id),
  configVersion: (org: string, id: string, v: number) =>
    orgKey(org, "fleet", "configVersion", id, v),
  audit: (org: string) => orgKey(org, "fleet", "audit"),
  settings: (org: string) => orgKey(org, "fleet", "settings"),
  rollouts: (org: string) => orgKey(org, "fleet", "rollouts"),
  rollout: (org: string, id: string) => orgKey(org, "fleet", "rollout", id),
  flows: (org: string) => orgKey(org, "fleet", "pipelines"),
  flow: (org: string, window: string) => orgKey(org, "fleet", "pipelines", window),
  fleetSettings: (org: string, id: string) => orgKey(org, "fleet", "fleetSettings", id),
  preview: (org: string, id: string, body: string) => orgKey(org, "fleet", "preview", id, body),
};
