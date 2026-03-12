// Copyright 2023 OpenObserve Inc.
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
 * Maps OTEL numeric span kind IDs to human-readable display names.
 * Reference: https://opentelemetry.io/docs/specs/otel/trace/api/#spankind
 */
export const SPAN_KIND_MAP: Record<string, string> = {
  "0": "Unspecified",
  "1": "Internal",
  "2": "Server",
  "3": "Client",
  "4": "Producer",
  "5": "Consumer",
};

/** OTEL span kind ID for UNSPECIFIED (0) */
export const SPAN_KIND_UNSPECIFIED = "0";

/** OTEL span kind ID for CLIENT (3) */
export const SPAN_KIND_CLIENT = "3";
