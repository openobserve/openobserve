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

import axios from "axios";
import store from "@/stores";

// A bare client, deliberately WITHOUT the shared http() auth-refresh
// interceptor: an anonymous visitor must never be bounced to /login on a 401,
// and these endpoints carry no credentials.
const client = () =>
  axios.create({
    baseURL: store.state.API_ENDPOINT || "",
  });

// 304 answers a matching If-None-Match and 202 a build still running; both are normal replies, not errors.
const acceptsNotModified = (status: number) => (status >= 200 && status < 300) || status === 304;

const public_dashboards = {
  getConfig: (slug: string) => client().get(`/api/public_dashboards/${slug}`),
  /** `rev` is the body already on screen; the server answers 304 while it is still current. */
  getData: (slug: string, rangeKey: string, rev?: string) =>
    client().get(`/api/public_dashboards/${slug}/data`, {
      params: { range: rangeKey },
      headers: rev ? { "If-None-Match": `"${rev}"` } : undefined,
      validateStatus: acceptsNotModified,
    }),
};

export default public_dashboards;
