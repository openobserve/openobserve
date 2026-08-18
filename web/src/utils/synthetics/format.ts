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

import { gt } from "@/types/i18n";

/** Humanizes an epoch-microseconds timestamp as "5s ago" / "2h ago". */
export function formatTimeAgoUs(us: number): string {
  const s = Math.max(0, Math.floor((Date.now() - us / 1000) / 1000));
  if (s < 60) return gt("synthetics.secondsAgo", { count: s });
  const m = Math.floor(s / 60);
  if (m < 60) return gt("synthetics.minutesAgo", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return gt("synthetics.hoursAgo", { count: h });
  return gt("synthetics.daysAgo", { count: Math.floor(h / 24) });
}

/** Renders a check interval in seconds as a compact label ("30s", "5m", "1h"). */
export function formatIntervalSecs(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

/** "Name (region)", omitting the region when it's blank or a mechanical
 *  duplicate of the name — private locations without an explicit region
 *  default to a slug of their own name server-side, which reads as
 *  pointless noise ("private-location-5660 (private-location-5660)"). */
export function locationDisplayLabel(name: string, region: string | undefined | null): string {
  const r = region?.trim();
  if (!r || r.toLowerCase() === name.trim().toLowerCase()) return name;
  return `${name} (${r})`;
}
