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

import http from "./http";

// Authenticated admin surface for publishing a dashboard publicly. Requires the
// caller's normal RBAC on the parent dashboard (enforced server-side).
const public_dashboards_admin = {
  get: (org: string, dashboardId: string) =>
    http().get(`/api/${org}/dashboards/${dashboardId}/public`),
  publish: (org: string, dashboardId: string, config: any) =>
    http().post(`/api/${org}/dashboards/${dashboardId}/public`, config),
  revoke: (org: string, dashboardId: string) =>
    http().delete(`/api/${org}/dashboards/${dashboardId}/public`),
};

export default public_dashboards_admin;
