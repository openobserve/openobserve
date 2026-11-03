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

/** One delivery row of `GET /api/{org}/notifications/deliveries`. */
export interface DeliveryRow {
  id: string;
  kind: string;
  object_id: string;
  episode_id: string;
  event: string;
  destination: string;
  channel: string;
  template_source: string;
  template_name: string;
  status: "pending" | "queued" | "sent" | "failed" | "skipped";
  status_code: number | null;
  attempt: number;
  max_attempts: number;
  retryable: boolean;
  error: string | null;
  skip_reason: string | null;
  claimed_at: number | null;
  finished_at: number | null;
  next_retry_at: number | null;
}

export interface DeliveriesQuery {
  kind: string;
  object_id?: string;
  episode_id?: string;
  event?: string;
  from?: number;
  size?: number;
}

const notificationDeliveries = {
  list: (org_identifier: string, query: DeliveriesQuery) => {
    return http().get(`/api/${org_identifier}/notifications/deliveries`, { params: query });
  },
};

export default notificationDeliveries;
