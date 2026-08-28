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

const announcements = {
  /**
   * Banners active right now for this org, most severe first. Readable by any
   * member of the org; the per-banner org allowlist is applied server-side.
   */
  getActive: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/announcements`);
  },

  /**
   * The authored JSON, for the editor. Meta org only.
   */
  getConfig: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/announcements/config`);
  },

  /**
   * Replace the banner configuration. Meta org only. The server validates and
   * normalizes before storing, so a rejected payload comes back as a 400 whose
   * message names the offending banner index and field.
   */
  setConfig: (org_identifier: string, payload: unknown) => {
    return http().put(`/api/${org_identifier}/announcements/config`, payload);
  },
};

export default announcements;
