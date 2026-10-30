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

// Tile colour tells the module's category apart at a glance; every class is a registered token.
const GROUP_TONE: Record<string, string> = {
  data: "bg-badge-blue-soft-bg text-badge-blue-soft-text",
  dashboards: "bg-badge-purple-soft-bg text-badge-purple-soft-text",
  alerting: "bg-icon-chip-orange-bg text-icon-chip-orange-text",
  pipelines: "bg-badge-teal-soft-bg text-badge-teal-soft-text",
  monitoring: "bg-icon-chip-info-bg text-icon-chip-info-text",
  ai: "bg-icon-chip-primary-bg text-icon-chip-primary-text",
  access: "bg-icon-chip-success-bg text-icon-chip-success-text",
};

const NEUTRAL_TONE = "bg-surface-subtle text-text-secondary";

/** Icon tile classes for a module group or preset tone; unknown tones stay neutral. */
export const groupTone = (tone: string) => GROUP_TONE[tone] ?? NEUTRAL_TONE;
