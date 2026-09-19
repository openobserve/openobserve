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

import { ref } from "vue";
import config from "@/aws-exports";

export type SlackInviteStatus = "not_asked" | "pending_day2" | "resolved";

interface SlackInviteRecord {
  status: SlackInviteStatus;
  shownAt: number | null;
}

// Gives the day-2 dedicated popup a full day to elapse, not a same-session retry.
const DAY2_DELAY_MS = 24 * 60 * 60 * 1000;

// Legacy key from the exit-intent invite this replaced — set "true" on that invite's
// dismiss or join, both of which were permanent. Migrated below so those users aren't
// re-invited under the new state machine.
const legacySeenKey = (email: string): string => `communitySlackInviteSeen:${email}`;

const storageKey = (email: string): string => `slackCommunityInvite:${email}`;

// Shared with ConnectDataSourcePopup so both read/write the same session key.
export const connectDataPromptSessionKey = (email: string): string =>
  `connectDataSourcePromptShown:${email}`;

// Flips false while ConnectDataSourcePopup is deciding whether to open this session (that
// decision crosses an await), so CommunitySlackInvite never opens before it lands — the two
// popups must never be open at once. Defaults true so a standalone mount (tests, or when
// ConnectDataSourcePopup itself bails out) is never blocked.
export const connectDataPopupSettled = ref(true);

const readRecord = (email: string): SlackInviteRecord => {
  try {
    const raw = localStorage.getItem(storageKey(email));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.status === "pending_day2" || parsed?.status === "resolved") {
        return { status: parsed.status, shownAt: parsed.shownAt ?? null };
      }
    }
    if (localStorage.getItem(legacySeenKey(email)) === "true") {
      return { status: "resolved", shownAt: null };
    }
    return { status: "not_asked", shownAt: null };
  } catch {
    return { status: "not_asked", shownAt: null };
  }
};

const writeRecord = (email: string, record: SlackInviteRecord): void => {
  try {
    localStorage.setItem(storageKey(email), JSON.stringify(record));
  } catch {
    // Persistence failing just means the invite may be asked again later; survivable.
  }
};

// Whether ConnectDataSourcePopup should offer its embedded "Join Slack" action.
export const shouldOfferSlackInvite = (email: string): boolean =>
  readRecord(email).status === "not_asked";

// Starts the day-2 clock on the invite's first touchpoint, shown or silent — an ignored offer resolves to exactly one later dedicated ask.
export const markSlackInviteOffered = (email: string): void => {
  if (readRecord(email).status !== "not_asked") return;
  writeRecord(email, { status: "pending_day2", shownAt: Date.now() });
};

// Only joining resolves the ask for good — dismiss()/"Maybe later" leaves it pending so the day-2 popup can re-show.
export const markSlackInviteResolved = (email: string): void => {
  writeRecord(email, { status: "resolved", shownAt: readRecord(email).shownAt });
};

// Whether the dedicated day-2 popup is due: offered once, at least a day ago, still unresolved.
export const shouldShowStandaloneSlackInvite = (email: string): boolean => {
  const record = readRecord(email);
  if (record.status !== "pending_day2" || record.shownAt == null) return false;
  return Date.now() - record.shownAt >= DAY2_DELAY_MS;
};

// Shared so the embedded and standalone entry points never resolve two different links.
export const getCommunitySlackUrl = (customSlackUrl: string | undefined): string => {
  if (config.isEnterprise === "true" && customSlackUrl) return customSlackUrl;
  return "https://short.openobserve.ai/community";
};
