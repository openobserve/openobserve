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

import { describe, it, expect, beforeEach } from "vitest";
import {
  markSlackInviteDismissed,
  markSlackInviteOffered,
  markSlackInviteResolved,
  shouldOfferSlackInvite,
  shouldShowStandaloneSlackInvite,
} from "./slackCommunityInvite";

const EMAIL = "example@gmail.com";
const STATE_KEY = `slackCommunityInvite:${EMAIL}`;
const LEGACY_SEEN_KEY = `communitySlackInviteSeen:${EMAIL}`;
const DAY2_DELAY_MS = 24 * 60 * 60 * 1000;
const SNOOZE_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

describe("slackCommunityInvite", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("legacy state migration", () => {
    it("treats a legacy communitySlackInviteSeen:<email> flag as already resolved", () => {
      localStorage.setItem(LEGACY_SEEN_KEY, "true");

      expect(shouldOfferSlackInvite(EMAIL)).toBe(false);
      expect(shouldShowStandaloneSlackInvite(EMAIL)).toBe(false);
    });

    it("ignores the legacy flag once a new-format record exists", () => {
      localStorage.setItem(LEGACY_SEEN_KEY, "true");
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ status: "pending_day2", shownAt: Date.now() - DAY2_DELAY_MS - 1 }),
      );

      // The new-format pending_day2 record wins over the legacy resolved flag.
      expect(shouldShowStandaloneSlackInvite(EMAIL)).toBe(true);
    });

    it("does not treat a missing or non-'true' legacy flag as resolved", () => {
      localStorage.setItem(LEGACY_SEEN_KEY, "false");

      expect(shouldOfferSlackInvite(EMAIL)).toBe(true);
    });
  });

  describe("not_asked -> pending_day2 -> resolved", () => {
    it("starts as not_asked and offers the embedded invite", () => {
      expect(shouldOfferSlackInvite(EMAIL)).toBe(true);
    });

    it("moves to pending_day2 on first offer and stops offering the embedded invite again", () => {
      markSlackInviteOffered(EMAIL);

      expect(shouldOfferSlackInvite(EMAIL)).toBe(false);
      const record = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
      expect(record.status).toBe("pending_day2");
    });

    it("does not show the standalone invite before the day-2 delay has elapsed", () => {
      markSlackInviteOffered(EMAIL);

      expect(shouldShowStandaloneSlackInvite(EMAIL)).toBe(false);
    });

    it("shows the standalone invite once the day-2 delay has elapsed", () => {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ status: "pending_day2", shownAt: Date.now() - DAY2_DELAY_MS - 1 }),
      );

      expect(shouldShowStandaloneSlackInvite(EMAIL)).toBe(true);
    });

    it("resolving suppresses the standalone invite for good", () => {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ status: "pending_day2", shownAt: Date.now() - DAY2_DELAY_MS - 1 }),
      );

      markSlackInviteResolved(EMAIL);

      expect(shouldShowStandaloneSlackInvite(EMAIL)).toBe(false);
    });
  });

  describe("dismissing the standalone invite (cooldown, not permanent)", () => {
    it("does not show again immediately after a dismissal, even though the day-2 delay already elapsed", () => {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ status: "pending_day2", shownAt: Date.now() - DAY2_DELAY_MS - 1 }),
      );

      markSlackInviteDismissed(EMAIL);

      expect(shouldShowStandaloneSlackInvite(EMAIL)).toBe(false);
    });

    it("shows again once the snooze period has elapsed after a dismissal", () => {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ status: "pending_day2", shownAt: Date.now() - DAY2_DELAY_MS - 1 }),
      );
      markSlackInviteDismissed(EMAIL);

      // Fast-forward past the snooze window by rewriting shownAt directly.
      const record = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ ...record, shownAt: Date.now() - SNOOZE_DELAY_MS - 1 }),
      );

      expect(shouldShowStandaloneSlackInvite(EMAIL)).toBe(true);
    });

    it("stops asking for good after the max number of standalone prompts is dismissed", () => {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ status: "pending_day2", shownAt: Date.now() - DAY2_DELAY_MS - 1 }),
      );

      // Dismiss 1: snoozes.
      markSlackInviteDismissed(EMAIL);
      let record = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ ...record, shownAt: Date.now() - SNOOZE_DELAY_MS - 1 }),
      );

      // Dismiss 2: snoozes again.
      markSlackInviteDismissed(EMAIL);
      record = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ ...record, shownAt: Date.now() - SNOOZE_DELAY_MS - 1 }),
      );

      // Dismiss 3: the third dismissal hits the cap and resolves for good.
      markSlackInviteDismissed(EMAIL);

      expect(shouldShowStandaloneSlackInvite(EMAIL)).toBe(false);
      record = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
      expect(record.status).toBe("resolved");
    });

    it("does nothing once the invite is already resolved", () => {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ status: "resolved", shownAt: null, dismissCount: 0 }),
      );

      markSlackInviteDismissed(EMAIL);

      const record = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
      expect(record.status).toBe("resolved");
    });
  });
});
