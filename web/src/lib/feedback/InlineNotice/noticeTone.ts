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

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { InlineNoticeTone } from "./OInlineNotice.types";

// The banner tokens, not the badge ones: `data-banner-theme` re-declares only these, so a light preview stays light.
export const NOTICE_TONE_CLASS: Record<InlineNoticeTone, string> = {
  neutral: "border-border-default bg-banner-default-bg text-banner-default-text",
  info: "border-banner-info-border bg-banner-info-bg text-banner-info-text",
  warn: "border-banner-warning-border bg-banner-warning-bg text-banner-warning-text",
  err: "border-banner-error-soft-border bg-banner-error-soft-bg text-banner-error-soft-text",
  ok: "border-banner-success-border bg-banner-success-bg text-banner-success-text",
};

export const NOTICE_TONE_ICON: Record<InlineNoticeTone, IconName> = {
  neutral: "info",
  info: "info",
  warn: "warning",
  err: "error-outline",
  ok: "check-circle",
};

/** Problems interrupt a screen reader; everything else waits its turn. */
export function noticeRole(tone: InlineNoticeTone): "alert" | "status" {
  return tone === "err" || tone === "warn" ? "alert" : "status";
}
