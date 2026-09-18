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
 * to `destination_type` in the frontend form. It names a PREBUILT provider — Splunk,
 * Datadog, Elasticsearch, … — whose payload a workflow node cannot produce; anything
 * else is a plain HTTP webhook a workflow executes as-is.
 *
 * The field is `Option<String>` with `skip_serializing_if` on the backend, so it is
 * ABSENT from the JSON unless it was explicitly set at create time — every destination
 * made through the plain API is untyped. Untyped therefore means "plain webhook", not
 * "some other provider", and an unrecognised value is not assumed to be prebuilt
 * either: the authoritative gate is the server's `is_pipeline_destination()`
 * (module = pipeline), which both callers already satisfy by listing with
 * `module: "pipeline"`. This check only removes the provider shapes on top of that.
 */
const PREBUILT_DESTINATION_PROVIDERS = new Set([
  "openobserve",
  "splunk",
  "elasticsearch",
  "datadog",
  "dynatrace",
  "newrelic",
]);

export const isCustomDestination = (
  destination?: {
    destination_type_name?: string;
    destination_type?: string;
  } | null,
): boolean =>
  !PREBUILT_DESTINATION_PROVIDERS.has(
    (destination?.destination_type_name || destination?.destination_type || "")
      .trim()
      .toLowerCase(),
  );
