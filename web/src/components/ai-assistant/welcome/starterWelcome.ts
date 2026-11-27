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

import { reactive } from "vue";

import { byteSize, type ContextChip, type Sid, type Starter } from "@/composables/assistant";
import i18n from "@/locales";
import { gt, raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { uiIntlLocale } from "@/utils/formatters";

export type StarterWelcomeMode = "none" | "loading" | "starter" | "askAdmin";

/** Packs show only for an onboarding org with a match; anything unanswered keeps today's welcome. */
export const starterWelcomeMode = (state: {
  visible: boolean;
  showSection: boolean;
  loading: boolean;
  /** Packs fit the data, but this user may not set them up. */
  askAdmin?: boolean;
}): StarterWelcomeMode => {
  if (!state.visible) return "none";
  if (state.showSection) return "starter";
  if (state.askAdmin) return "askAdmin";
  return state.loading ? "loading" : "none";
};

/** Pack titles as one list in the UI locale: "Kubernetes, NGINX and PostgreSQL". */
export const joinTitles = (titles: string[]): I18nText =>
  raw(new Intl.ListFormat(uiIntlLocale(), { type: "conjunction" }).format(titles));

/** One id, so the welcome finds its own digest chip in the composer and the store never holds two. */
export const PACK_DIGEST_CHIP_ID = "starter-pack-digest";

/** The matched packs as a composer chip; it is sent as a text block the assistant reads. */
export const packDigestChip = (text: string, t: TranslateFn = gt): ContextChip => ({
  id: PACK_DIGEST_CHIP_ID,
  kind: "pasted_text",
  label: t("starterPacks.offer.title"),
  // Narrow chip rows show this; it still names the chip in full.
  short: t("starterPacks.offer.chipShort"),
  data: text,
  sizeBytes: byteSize(text),
  provenance: "attach",
  sent: "serialized",
});

const PACK_PROMPT = "starterPacks.offer.question";

/** The pack question as the model reads it: English whatever the UI locale, like every welcome starter. */
export const packQuestion = (): string =>
  (i18n.global as unknown as { t(key: string, named: object, opts: object): string }).t(
    PACK_PROMPT,
    {},
    { locale: "en-us" },
  );

/** The welcome's first starter while packs are offered: the question, with the digest chip staged beside it. */
export const packStarter = (digest: string, t: TranslateFn = gt): Starter => ({
  id: "pack",
  kind: "pack",
  label: t(PACK_PROMPT),
  prompt: packQuestion(),
  chips: [packDigestChip(digest, t)],
  dataTest: "assistant-starter-0",
});

/** The key a removal is kept under while the panel's empty chat has no session yet. */
export const PENDING_DIGEST = "pending";

// Chats whose user removed the digest; in memory only, so a reload offers it again.
const dismissed = reactive(new Set<string>());

export const digestDismissed = (key: string): boolean => dismissed.has(key);

export function dismissDigest(key: string): void {
  dismissed.add(key);
}

/** The first keystroke starts a session; a removal made before it moves to that chat. */
export function adoptPendingDismissal(sid: Sid): void {
  if (!dismissed.delete(PENDING_DIGEST)) return;
  dismissed.add(sid);
}

/** A removal that never got a chat is dropped, so the next empty chat offers the digest again. */
export function clearPendingDismissal(): void {
  dismissed.delete(PENDING_DIGEST);
}

/** Lets a spec start from a fresh page session; never called by app code. */
export function resetDigestDismissalsForTests(): void {
  dismissed.clear();
}
