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

import type { AxiosResponse } from "axios";
import http from "./http";
import type {
  NamedActionRule,
  NamedEventRule,
  SavedFunnelBody,
} from "@/utils/rum/productAnalyticsModel";

export interface NamedEventBody {
  name: string;
  rules: (NamedEventRule | NamedActionRule)[];
}
export interface FunnelRef {
  id: string;
  name: string;
}
/** A deleted named event's id and the name it had when it was deleted. */
export interface NamedEventRef {
  id: string;
  name: string;
}
type Versioned<T> = T & { version: number };
type Rows = AxiosResponse<{ list: unknown[] }>;

const base = (org: string) => `/api/${encodeURIComponent(org)}/rum/analytics`;
const events = (org: string, id?: string) =>
  `${base(org)}/named_events${id ? `/${encodeURIComponent(id)}` : ""}`;
const funnels = (org: string, id?: string) =>
  `${base(org)}/funnels${id ? `/${encodeURIComponent(id)}` : ""}`;
// An app name is free text up to 256 characters and may hold "/", so it never goes in the path.
const inApp = (app: string) => ({ params: { app } });

const rumProductAnalytics = {
  listEvents: (org: string, app: string): Promise<Rows> => http().get(events(org), inApp(app)),
  getEvent: (org: string, app: string, id: string): Promise<AxiosResponse<unknown>> =>
    http().get(events(org, id), inApp(app)),
  createEvent: (org: string, app: string, body: NamedEventBody): Promise<AxiosResponse<unknown>> =>
    http().post(events(org), body, inApp(app)),
  updateEvent: (
    org: string,
    app: string,
    id: string,
    body: Versioned<NamedEventBody>,
  ): Promise<AxiosResponse<unknown>> => http().put(events(org, id), body, inApp(app)),
  deleteEvent: (org: string, app: string, id: string, force = false): Promise<AxiosResponse> =>
    http().delete(events(org, id), force ? { params: { app, force: true } } : inApp(app)),
  eventUsages: (
    org: string,
    app: string,
    id: string,
  ): Promise<AxiosResponse<{ list: FunnelRef[] }>> =>
    http().get(`${events(org, id)}/funnels`, inApp(app)),
  deletedEventNames: (
    org: string,
    ids: readonly string[],
  ): Promise<AxiosResponse<{ list: NamedEventRef[] }>> =>
    http().get(`${events(org)}/deleted_names`, { params: { ids: ids.join(",") } }),
  listFunnels: (org: string, app: string): Promise<Rows> => http().get(funnels(org), inApp(app)),
  getFunnel: (org: string, app: string, id: string): Promise<AxiosResponse<unknown>> =>
    http().get(funnels(org, id), inApp(app)),
  createFunnel: (
    org: string,
    app: string,
    body: SavedFunnelBody,
  ): Promise<AxiosResponse<unknown>> => http().post(funnels(org), body, inApp(app)),
  updateFunnel: (
    org: string,
    app: string,
    id: string,
    body: Versioned<SavedFunnelBody>,
  ): Promise<AxiosResponse<unknown>> => http().put(funnels(org, id), body, inApp(app)),
  deleteFunnel: (org: string, app: string, id: string): Promise<AxiosResponse> =>
    http().delete(funnels(org, id), inApp(app)),
};

export default rumProductAnalytics;
