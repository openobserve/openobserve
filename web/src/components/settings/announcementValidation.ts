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

import { isHexColor } from "@/utils/announcementAppearance";

import { parseDurationMs, type BannerDraft } from "./announcementDrafts";

export const CTA_TEXT_MAX = 30;

export const MESSAGE_MAX = 300;

/** Counted in code points, as the API counts them, so an emoji is one character and not two. */
export const messageChars = (value: string) => Array.from(value).length;

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim());

// Mirrors the API's link check: `[text](target)` and `<scheme:target>` autolinks.
const MESSAGE_LINK_TARGET = /\]\(\s*<?([^)\s>]*)|<([A-Za-z][A-Za-z0-9+.-]*:[^>\s]*)>/g;

/** Whether every link written into the message points at an http(s) address. */
export const messageLinksSafe = (message: string) =>
  Array.from(message.matchAll(MESSAGE_LINK_TARGET)).every((match) =>
    isHttpUrl(match[1] ?? match[2]),
  );

export interface LinkErrors {
  text?: string;
  url?: string;
}

/** Field name → message, with one entry per link button. Empty means the draft is publishable. */
export type BannerErrors = Partial<Record<Exclude<keyof BannerDraft, "links">, string>> & {
  links?: LinkErrors[];
};

type Translate = (_key: string, _params?: Record<string, unknown>) => string;

function validateSchedule(draft: BannerDraft, t: Translate, errors: BannerErrors): void {
  // Only the fields the chosen start and end use are checked — a leftover from a previous choice must not block a save.
  if (draft.start === "at" && !draft.startsAt) {
    errors.startsAt = t("announcements.editor.startRequired");
  }
  if (draft.end === "after" && !parseDurationMs(draft.duration ?? "")) {
    errors.duration = t("announcements.editor.durationInvalid");
  }
  if (draft.end === "at") {
    if (!draft.endsAt) {
      errors.endsAt = t("announcements.editor.endRequired");
      return;
    }
    const startMs =
      draft.start === "at" && draft.startsAt ? new Date(draft.startsAt).getTime() : Date.now();
    if (new Date(draft.endsAt).getTime() <= startMs) {
      errors.endsAt = t("announcements.editor.windowBackwards");
    }
  }
}

function validateLinks(draft: BannerDraft, t: Translate): LinkErrors[] | undefined {
  const errors = draft.links.map((link) => {
    const found: LinkErrors = {};
    if (!link.text.trim()) found.text = t("announcements.editor.ctaTextRequired");
    else if (link.text.trim().length > CTA_TEXT_MAX) {
      found.text = t("announcements.editor.ctaTextTooLong", { max: CTA_TEXT_MAX });
    }
    if (!isHttpUrl(link.url)) {
      found.url = t("announcements.editor.ctaUrlInvalid");
    }
    return found;
  });
  return errors.some((e) => e.text || e.url) ? errors : undefined;
}

export function validateBanner(draft: BannerDraft, t: Translate): BannerErrors {
  const errors: BannerErrors = {};

  const message = draft.message.trim();
  if (!message) {
    errors.message = t("announcements.editor.messageRequired");
  } else if (messageChars(message) > MESSAGE_MAX) {
    errors.message = t("announcements.editor.messageTooLong", { max: MESSAGE_MAX });
  } else if (!messageLinksSafe(message)) {
    errors.message = t("announcements.editor.messageLinkInvalid");
  }

  validateSchedule(draft, t, errors);

  const links = validateLinks(draft, t);
  if (links) errors.links = links;

  if (draft.colorLight && !isHexColor(draft.colorLight)) {
    errors.colorLight = t("announcements.editor.colorInvalid");
  }
  if (draft.colorDark && !isHexColor(draft.colorDark)) {
    errors.colorDark = t("announcements.editor.colorInvalid");
  }

  return errors;
}
