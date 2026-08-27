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

/**
 * A destination's type is stored as `destination_type_name` (backend) and mirrored
 * to `destination_type` in the frontend form. "custom" is a plain HTTP webhook;
 * every other value — and an unset one, which the edit form defaults to
 * "openobserve" — is a prebuilt provider (Splunk, Datadog, Elasticsearch, …).
 *
 * Workflow destination nodes can only execute custom webhooks, so both the picker
 * (which offers destinations) and the read-only node summary (which flags an
 * already-saved one) decide from this single rule.
 */
export const isCustomDestination = (destination: {
  destination_type_name?: string;
  destination_type?: string;
}): boolean =>
  (destination?.destination_type_name || destination?.destination_type || "")
    .trim()
    .toLowerCase() === "custom";
