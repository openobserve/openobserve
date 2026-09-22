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
  // How many times the standalone popup has been dismissed without joining.
  dismissCount: number;
}

// Gives the day-2 dedicated popup a full day to elapse, not a same-session retry.
const DAY2_DELAY_MS = 24 * 60 * 60 * 1000;

// A dismissal (close/overlay/Escape/"Maybe later") snoozes the next ask by a
// week rather than leaving it permanently due the moment DAY2_DELAY_MS elapses.
const SNOOZE_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

// Total times the standalone popup will ask before giving up for good: the
// initial day-2 ask plus this many snoozed re-asks.
const MAX_STANDALONE_PROMPTS = 3;

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
        return {
          status: parsed.status,
          shownAt: parsed.shownAt ?? null,
          dismissCount: parsed.dismissCount ?? 0,
        };
      }
    }
    if (localStorage.getItem(legacySeenKey(email)) === "true") {
      return { status: "resolved", shownAt: null, dismissCount: 0 };
    }
    return { status: "not_asked", shownAt: null, dismissCount: 0 };
  } catch {
    return { status: "not_asked", shownAt: null, dismissCount: 0 };
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
  writeRecord(email, { status: "pending_day2", shownAt: Date.now(), dismissCount: 0 });
};

// Joining ends the ask for good.
export const markSlackInviteResolved = (email: string): void => {
  const record = readRecord(email);
  writeRecord(email, { status: "resolved", shownAt: record.shownAt, dismissCount: record.dismissCount });
};

// Dismissing without joining (✕ / overlay / Escape / "Maybe later") snoozes the
// next ask by SNOOZE_DELAY_MS instead of leaving it permanently due. After
// MAX_STANDALONE_PROMPTS total asks, stops for good rather than nagging forever.
export const markSlackInviteDismissed = (email: string): void => {
  const record = readRecord(email);
  if (record.status !== "pending_day2") return;
  const dismissCount = record.dismissCount + 1;
  if (dismissCount >= MAX_STANDALONE_PROMPTS) {
    writeRecord(email, { status: "resolved", shownAt: record.shownAt, dismissCount });
    return;
  }
  writeRecord(email, { status: "pending_day2", shownAt: Date.now(), dismissCount });
};

// Whether the dedicated day-2 popup is due: offered once, at least a day ago
// (or a full snooze period, for a re-ask after a prior dismissal), still unresolved.
export const shouldShowStandaloneSlackInvite = (email: string): boolean => {
  const record = readRecord(email);
  if (record.status !== "pending_day2" || record.shownAt == null) return false;
  const delay = record.dismissCount === 0 ? DAY2_DELAY_MS : SNOOZE_DELAY_MS;
  return Date.now() - record.shownAt >= delay;
};

// Shared so the embedded and standalone entry points never resolve two different links.
export const getCommunitySlackUrl = (customSlackUrl: string | undefined): string => {
  if (config.isEnterprise === "true" && customSlackUrl) return customSlackUrl;
  return "https://short.openobserve.ai/community";
};
