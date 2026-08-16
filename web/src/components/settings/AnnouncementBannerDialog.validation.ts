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
 * The same rules the API enforces, checked here so an author is told at the
 * field rather than by a rejected save that names a banner index.
 *
 * Hand-rolled rather than schema-driven: this branch carries no validation
 * library, and the rule set is small enough that a plain function states it more
 * directly than a dependency would.
 */

import { parseDurationMs, type BannerDraft } from "./announcementDrafts";

/** Field name → message. Empty means the draft is publishable. */
export type BannerErrors = Partial<Record<keyof BannerDraft, string>>;

export function validateBanner(
  draft: BannerDraft,
  t: (_key: string) => string,
): BannerErrors {
  const errors: BannerErrors = {};

  if (!draft.message.trim()) {
    errors.message = t("announcements.form.messageRequired");
  }

  // Only the fields the chosen schedule actually uses are checked — a leftover
  // bad duration from a previous choice must not block a save.
  if (draft.schedule === "duration" && !parseDurationMs(draft.duration ?? "")) {
    errors.duration = t("announcements.form.durationInvalid");
  }

  if (draft.schedule === "window") {
    if (!draft.startsAt && !draft.endsAt) {
      errors.startsAt = t("announcements.form.windowRequired");
    }
    // The API rejects a backwards window; catching it here saves a round trip.
    if (
      draft.startsAt &&
      draft.endsAt &&
      new Date(draft.endsAt).getTime() <= new Date(draft.startsAt).getTime()
    ) {
      errors.endsAt = t("announcements.form.windowBackwards");
    }
  }

  if (draft.hasCta) {
    if (!draft.ctaText?.trim()) {
      errors.ctaText = t("announcements.form.ctaTextRequired");
    }
    const url = draft.ctaUrl?.trim() ?? "";
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      errors.ctaUrl = t("announcements.form.ctaUrlInvalid");
    }
  }

  return errors;
}
