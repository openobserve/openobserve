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
  markSlackInviteOffered,
  markSlackInviteResolved,
  shouldOfferSlackInvite,
  shouldShowStandaloneSlackInvite,
} from "./slackCommunityInvite";

const EMAIL = "example@gmail.com";
const STATE_KEY = `slackCommunityInvite:${EMAIL}`;
const LEGACY_SEEN_KEY = `communitySlackInviteSeen:${EMAIL}`;
const DAY2_DELAY_MS = 24 * 60 * 60 * 1000;

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
});
