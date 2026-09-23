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

const public_dashboards = {
  getConfig: (slug: string) => client().get(`/api/public_dashboards/${slug}`),
  getData: (slug: string, preset: number) =>
    client().get(`/api/public_dashboards/${slug}/data`, { params: { preset } }),
};

export default public_dashboards;
