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

/** `all` is the invalidation scope; the rest are entries beneath it. */
export const secretKeys = {
  all: (org: string) => orgKey(org, "settings", "secrets"),
  list: (org: string, kind: string, deleted = false) =>
    orgKey(org, "settings", "secrets", "list", kind, deleted ? "deleted" : "active"),
  picker: (org: string, usableBy: string, consumerId: string, q = "", locations = "") =>
    orgKey(org, "settings", "secrets", "picker", usableBy, consumerId, q, locations),
  status: (org: string) => orgKey(org, "settings", "secrets", "status"),
  prescan: (org: string) => orgKey(org, "settings", "secrets", "prescan"),
  detail: (org: string, id: string) => orgKey(org, "settings", "secrets", "detail", id),
  usage: (org: string, id: string) => orgKey(org, "settings", "secrets", "usage", id),
  grants: (org: string, id: string) => orgKey(org, "settings", "secrets", "grants", id),
  createGrants: (org: string) => orgKey(org, "settings", "secrets", "createGrants"),
  metaStatus: () => orgKey("_meta", "settings", "secrets", "metaStatus"),
  backends: (org: string) => orgKey(org, "settings", "secrets", "backends"),
  environments: (org: string) => orgKey(org, "settings", "secrets", "environments"),
  backendIdentity: (org: string, id: string) =>
    orgKey(org, "settings", "secrets", "backends", id, "identity"),
};
