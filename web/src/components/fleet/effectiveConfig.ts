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

import { dump, load } from "js-yaml";

type Doc = Record<string, unknown>;

const isMap = (v: unknown): v is Doc => typeof v === "object" && v !== null && !Array.isArray(v);

// The supervisor injects the OpAMP extension and the server owns service.telemetry, so neither is the user's.
const SYSTEM_EXTENSIONS = /^opamp(\/|$)/;

/** The reported configuration split into what the user wrote and what the system manages; null system when there is none or the YAML does not parse. */
export function splitSystemSections(yaml: string): { user: string; system: string | null } {
  let doc: unknown;
  try {
    doc = load(yaml);
  } catch {
    return { user: yaml, system: null };
  }
  if (!isMap(doc)) return { user: yaml, system: null };
  const user: Doc = { ...doc };
  const system: Doc = {};
  if (isMap(doc.extensions)) {
    const ext: Doc = {};
    const own: Doc = {};
    for (const [k, v] of Object.entries(doc.extensions))
      (SYSTEM_EXTENSIONS.test(k) ? ext : own)[k] = v;
    if (Object.keys(ext).length) {
      system.extensions = ext;
      if (Object.keys(own).length) user.extensions = own;
      else delete user.extensions;
    }
  }
  if (isMap(doc.service) && "telemetry" in doc.service) {
    const { telemetry, ...rest } = doc.service;
    system.service = { telemetry };
    user.service = rest;
  }
  if (!Object.keys(system).length) return { user: yaml, system: null };
  return { user: dump(user, { lineWidth: -1 }), system: dump(system, { lineWidth: -1 }) };
}
