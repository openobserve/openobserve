// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { formatToDateOnly } from "@/utils/date";

const AVATAR_COLORS = [
  "var(--color-error-500)",
  "var(--color-amber-500)",
  "var(--color-ai-accent)",
  "var(--color-blue-500)",
  "var(--color-success-500)",
  "var(--color-purple-500)",
  "var(--color-cyan-500)",
  "var(--color-orange-500)",
  "var(--color-teal-500)",
  "var(--color-indigo-500)",
];

/** Deterministic avatar tint from a username's first character. Shared by every
 * ActivityTimeline consumer so the same person gets the same color everywhere. */
export const getActivityAvatarColor = (username: string): string => {
  const firstChar = username.charAt(0).toUpperCase();
  const charCode = firstChar.charCodeAt(0);
  return AVATAR_COLORS[charCode % AVATAR_COLORS.length];
};

/** "just now" / "5 minutes ago" / ... from a microsecond timestamp. */
export const formatActivityRelativeTime = (timestampMicros: number): string => {
  const now = Date.now();
  const diff = now - timestampMicros / 1000;

  if (diff < 60000) return "just now";

  const minutes = Math.floor(diff / 60000);
  if (diff < 3600000) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(diff / 3600000);
  if (diff < 86400000) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(diff / 86400000);
  if (diff < 604800000) return `${days} day${days === 1 ? "" : "s"} ago`;

  return formatToDateOnly(timestampMicros);
};
