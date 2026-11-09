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

import type { VoiceBrand } from "./voiceEngine";
import { raw, type I18nText } from "@/types/i18n";

/** The strip's line, title and links together, never cut mid-word (K5). */
export const STRIP_MAX_CHARS = 44;

/** Between the title and each link. */
export const STRIP_SEPARATOR = " · ";

/** Every notice the strip can show, most urgent first; one shows at a time. */
export const NOTICE_PRIORITY = [
  "prefill",
  "inert",
  "reply",
  "access",
  "voice",
  "blocked",
  "busy",
  "runLimit",
  "orgBusy",
  "credits",
  "offline",
  "unreachable",
  "cap",
  "cleared",
  "queued",
  "entry",
  "paste",
  "dropped",
  "answering",
  "pending",
  "thread",
  "storage",
] as const;

// Browser help for unblocking the microphone; an unknown brand gets no link rather than a wrong one.
const MIC_HELP_URLS: Partial<Record<NonNullable<VoiceBrand>, string>> = {
  chrome: "https://support.google.com/chrome/answer/2693767",
  safari: "https://support.apple.com/guide/safari/websites-ibrwe2159f50/mac",
  edge: "https://support.microsoft.com/en-us/windows/windows-camera-microphone-and-privacy-a83257bc-e990-d54a-d212-b5e41beba857",
};

export type NoticeId = (typeof NOTICE_PRIORITY)[number];

/** The glyph colour says the kind; `paused` is the inert composer's pause glyph. */
export type NoticeTone = "warning" | "info" | "success" | "paused";

export type NoticeAction =
  | "prefillReplace"
  | "prefillAppend"
  | "prefillCancel"
  | "goToRequest"
  | "replyCancel"
  | "askAdmin"
  | "micHelp"
  | "voiceRetry"
  | "turnOn"
  | "showRunning"
  | "retry"
  | "manageUsage"
  | "undo"
  | "bringDraft"
  | "editQueued"
  | "pasteInline"
  | "startNew";

export interface NoticeLink {
  action: NoticeAction;
  label: I18nText;
}

export interface ComposerNotice {
  id: NoticeId;
  tone: NoticeTone;
  /** The short title; `fitNotice` shortens it by whole words. */
  title: I18nText;
  /** The full shipped sentence, for `title=` and screen readers. */
  sentence: I18nText;
  links: NoticeLink[];
}

/** The text the strip shows for a notice. */
export function stripText(notice: Pick<ComposerNotice, "title" | "links">): string {
  return [notice.title, ...notice.links.map((link) => link.label)].join(STRIP_SEPARATOR);
}

/** Whole words of `text` up to `max` characters, trailing punctuation dropped; a first word longer than `max` stays whole. */
export function fitWords(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const words = clean.split(/\s+/);
  let out = words[0];
  for (const word of words.slice(1)) {
    if (out.length + 1 + word.length > max) break;
    out = `${out} ${word}`;
  }
  return out.replace(/[\s.,;:·]+$/u, "");
}

/** Keeps every link and shortens the title so the line fits; the sentence is never touched. */
export function fitNotice(notice: ComposerNotice): ComposerNotice {
  if (stripText(notice).length <= STRIP_MAX_CHARS) return notice;
  const linksLength = notice.links.reduce(
    (sum, link) => sum + STRIP_SEPARATOR.length + link.label.length,
    0,
  );
  const budget = Math.max(1, STRIP_MAX_CHARS - linksLength);
  return { ...notice, title: raw(fitWords(notice.title, budget)) };
}

/** The most urgent notice, fitted to the strip, or null when the strip shows chips. */
export function pickNotice(
  candidates: readonly (ComposerNotice | null | undefined | false)[],
): ComposerNotice | null {
  let best: ComposerNotice | null = null;
  for (const notice of candidates) {
    if (!notice) continue;
    if (!best || NOTICE_PRIORITY.indexOf(notice.id) < NOTICE_PRIORITY.indexOf(best.id))
      best = notice;
  }
  return best ? fitNotice(best) : null;
}

/** A notice whose short title is its own sentence cut to whole words. */
export function sentenceNotice(
  id: NoticeId,
  sentence: I18nText,
  tone: NoticeTone = "warning",
  links: NoticeLink[] = [],
): ComposerNotice {
  return { id, tone, title: sentence, sentence, links };
}

/** The browser's own help page for allowing the microphone, or null when the brand is unknown. */
export function micHelpUrl(brand: VoiceBrand): string | null {
  return (brand && MIC_HELP_URLS[brand]) ?? null;
}

/** Lines in a paste, for the "Pasted N lines" title. */
export function lineCount(text: string): number {
  return text ? text.split(/\r\n|\r|\n/).length : 0;
}
