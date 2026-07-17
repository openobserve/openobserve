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

const SecurityOverview = () => import("@/views/Security/SecurityOverview.vue");
const SecurityEvents = () => import("@/views/Security/SecurityEvents.vue");
const SecurityDetections = () =>
  import("@/views/Security/SecurityDetections.vue");
const SecurityAlerts = () => import("@/views/Security/SecurityAlerts.vue");
const SecurityCases = () => import("@/views/Security/SecurityCases.vue");
const SecurityIntel = () => import("@/views/Security/SecurityIntel.vue");
const SecurityEntities = () => import("@/views/Security/SecurityEntities.vue");
const SecurityUEBA = () => import("@/views/Security/SecurityUEBA.vue");
const SecurityMitre = () => import("@/views/Security/SecurityMitre.vue");
const SecurityCompliance = () =>
  import("@/views/Security/SecurityCompliance.vue");
const SecuritySources = () => import("@/views/Security/SecuritySources.vue");
const SecurityContent = () => import("@/views/Security/SecurityContent.vue");

const guard = (to: any, from: any, next: any) => routeGuard(to, from, next);

// Security (SIEM) solution-mode routes, mounted under the main shell.
const useSecurityRoutes = () => {
  return [
    { path: "security", name: "securityOverview", component: SecurityOverview, meta: { keepAlive: false, title: "Security Overview" }, beforeEnter: guard },
    { path: "security/events", name: "securityEvents", component: SecurityEvents, meta: { keepAlive: false, title: "Explore Events" }, beforeEnter: guard },
    { path: "security/detections", name: "securityDetections", component: SecurityDetections, meta: { keepAlive: false, title: "Detections" }, beforeEnter: guard },
    { path: "security/alerts", name: "securityAlerts", component: SecurityAlerts, meta: { keepAlive: false, title: "Alerts" }, beforeEnter: guard },
    { path: "security/cases", name: "securityCases", component: SecurityCases, meta: { keepAlive: false, title: "Cases" }, beforeEnter: guard },
    { path: "security/threat-intel", name: "securityIntel", component: SecurityIntel, meta: { keepAlive: false, title: "Threat Intel" }, beforeEnter: guard },
    { path: "security/entities", name: "securityEntities", component: SecurityEntities, meta: { keepAlive: false, title: "Entities" }, beforeEnter: guard },
    { path: "security/ueba", name: "securityUeba", component: SecurityUEBA, meta: { keepAlive: false, title: "UEBA" }, beforeEnter: guard },
    { path: "security/mitre", name: "securityMitre", component: SecurityMitre, meta: { keepAlive: false, title: "MITRE ATT&CK" }, beforeEnter: guard },
    { path: "security/compliance", name: "securityCompliance", component: SecurityCompliance, meta: { keepAlive: false, title: "Compliance" }, beforeEnter: guard },
    { path: "security/sources", name: "securitySources", component: SecuritySources, meta: { keepAlive: false, title: "Data Sources" }, beforeEnter: guard },
    { path: "security/content", name: "securityContent", component: SecurityContent, meta: { keepAlive: false, title: "Content & Rules" }, beforeEnter: guard },
  ];
};

export default useSecurityRoutes;
