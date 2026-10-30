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

import { createMemoryHistory, createRouter, type Router } from "vue-router";

/**
 * A router carrying only the alerting sibling routes.
 *
 * The shared `helpers/router` is the real application router: importing it pulls
 * in every view in the app and runs `routeGuard`, which reaches for org state
 * and the organization-summary API. Neither is part of what these components do,
 * and paying for both on every `router.push` is what made the specs crawl.
 */
export const makeAlertSectionRouter = (): Router => {
  const blank = { template: "<div />" };
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: blank },
      { path: "/alerts", name: "alertList", component: blank },
      { path: "/alert-library", name: "alertLibrary", component: blank },
      { path: "/alert-destinations", name: "alertDestinations", component: blank },
      { path: "/alert-templates", name: "alertTemplates", component: blank },
      { path: "/ingestion", name: "ingestion", component: blank },
    ],
  });
};
