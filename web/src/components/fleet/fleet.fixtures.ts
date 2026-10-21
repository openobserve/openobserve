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

import type {
  Fleet,
  FleetCollector,
  FleetCollectorDetail,
  FleetRollout,
  FleetSettings,
} from "@/services/fleet";

/** API payload builders shared by the Fleet specs; each takes overrides for the fields a test cares about. */

export const NO_OVERRIDES: FleetSettings = {
  heartbeat_interval_secs: null,
  offline_heartbeats: null,
  retention_days: null,
  offline_ratio_percent: null,
  phase_timeout_secs: null,
  gate: null,
};

export const apiCollector = (over: Partial<FleetCollector> = {}): FleetCollector => ({
  id: "c1",
  name: "web-01",
  hostname: null,
  status: "online",
  os: "linux",
  arch: "amd64",
  distribution: null,
  version: "0.162.0",
  outdated: false,
  last_connected_from: null,
  config: "edge",
  config_version: 2,
  delivery: "running",
  delivery_error: null,
  fleet: { id: "default", name: "default" },
  token_id: null,
  last_seen: Date.now(),
  enrolled_at: Date.now() - 86_400_000,
  ...over,
});

export const apiDetail = (over: Partial<FleetCollectorDetail> = {}): FleetCollectorDetail => ({
  ...apiCollector(),
  capabilities: [],
  health: null,
  effective_config: null,
  effective_reported_at: null,
  assignment: null,
  evidence: null,
  history: [],
  ...over,
});

export const apiRollout = (over: Partial<FleetRollout> = {}): FleetRollout => ({
  id: "r1",
  fleet: { id: "default", name: "default" },
  config: "edge",
  from_version: 1,
  to_version: 2,
  start: { kind: "now" },
  batching: { kind: "one" },
  verify: false,
  auto_rollback: false,
  status: "completed",
  halt: null,
  total: 1,
  running: 1,
  phases: [
    {
      index: 0,
      size: 1,
      status: "done",
      targeted: 1,
      sent: 1,
      confirmed: 1,
      rejected: 0,
      gate: null,
    },
  ],
  members: [{ collector_id: "c1", phase: 0, state: "running", excluded: false }],
  events: [],
  started_by: "ana@acme.io",
  started_at: Date.now() - 3_600_000,
  ended_at: null,
  ...over,
});

export const apiFleet = (over: Partial<Fleet> = {}): Fleet => ({
  id: "default",
  name: "default",
  state: {
    desired: { config: "edge", version: 2 },
    stable: { config: "edge", version: 2 },
    rollout: null,
    collectors: 1,
    online: 1,
    at_desired: 1,
  },
  settings: NO_OVERRIDES,
  ...over,
});
