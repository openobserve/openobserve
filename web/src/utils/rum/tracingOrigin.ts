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
 * Whether RUM may inject tracing headers into API calls.
 *
 * Injection is safe only SAME-ORIGIN. A cross-origin API endpoint (local dev
 * pointed at a remote cluster) makes every instrumented XHR preflight, and the
 * SDK's headers (`x-openobserve-origin`, `x-openobserve-sampling-priority`, …)
 * must then each appear in the backend's CORS allow-list — one missing name
 * kills the request as an opaque "CORS error", which took the whole DBM
 * section down in dev. Same-origin traffic never preflights, so headers cost
 * nothing there.
 */
export function shouldPropagateTracing(apiEndpoint: string, pageOrigin: string): boolean {
  // "" and "/" are the same-origin sentinels the store normalizes to.
  if (!apiEndpoint || apiEndpoint === "/") return true;
  try {
    return new URL(apiEndpoint).origin === new URL(pageOrigin).origin;
  } catch {
    return false;
  }
}
