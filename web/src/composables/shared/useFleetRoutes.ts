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

import { routeGuard } from "@/utils/zincutils";
import config from "@/aws-exports";

const FleetOverview    = () => import("@/views/Fleet/FleetOverview.vue");
const FleetAgents      = () => import("@/views/Fleet/FleetAgents.vue");
const FleetSources     = () => import("@/views/Fleet/FleetSources.vue");
const FleetCollectors  = () => import("@/views/Fleet/FleetCollectors.vue");
const FleetPipelines   = () => import("@/views/Fleet/FleetPipelines.vue");
const FleetConfig      = () => import("@/views/Fleet/FleetConfig.vue");
const FleetHealth      = () => import("@/views/Fleet/FleetHealth.vue");

const guard = (to: any, from: any, next: any) => {
  if (config.isEnterprise !== "true" && config.isCloud !== "true") {
    next({ path: "/", query: to.query });
    return;
  }
  routeGuard(to, from, next);
};

// Fleet Management solution-mode routes, mounted under the main shell.
const useFleetRoutes = () => {
  return [
    { path: "fleet",                  name: "fleetOverview",    component: FleetOverview,   meta: { keepAlive: false, title: "Fleet Overview"   }, beforeEnter: guard },
    { path: "fleet/agents",           name: "fleetAgents",      component: FleetAgents,     meta: { keepAlive: false, title: "Agents"            }, beforeEnter: guard },
    { path: "fleet/sources",          name: "fleetSources",     component: FleetSources,    meta: { keepAlive: false, title: "Data Sources"      }, beforeEnter: guard },
    { path: "fleet/collectors",       name: "fleetCollectors",  component: FleetCollectors, meta: { keepAlive: false, title: "Collector Groups"  }, beforeEnter: guard },
    { path: "fleet/pipelines",        name: "fleetPipelines",   component: FleetPipelines,  meta: { keepAlive: false, title: "Pipelines"         }, beforeEnter: guard },
    { path: "fleet/config",           name: "fleetConfig",      component: FleetConfig,     meta: { keepAlive: false, title: "Configuration"     }, beforeEnter: guard },
    { path: "fleet/health",           name: "fleetHealth",      component: FleetHealth,     meta: { keepAlive: false, title: "Fleet Health"      }, beforeEnter: guard },
  ];
};

export default useFleetRoutes;
