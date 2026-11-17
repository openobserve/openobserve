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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isHeardFromPending } from "@/components/login/heardFrom";
import billings from "@/services/billings";
import { shouldShowStandaloneSlackInvite } from "@/utils/slackCommunityInvite";

import {
  markStartPending,
  recordStart,
  redirectPending,
  startPending,
  suppressConnectPrompt,
} from "./onboardingFlow";

vi.mock("@/services/billings", () => ({ default: { submit_new_user_info: vi.fn() } }));

const ORG = "org1";
const EMAIL = "user@example.com";
const submit = vi.mocked(billings.submit_new_user_info);

describe("recordStart", () => {
  const PENDING = `o2.onboarding.pendingStart.${EMAIL}`;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    submit.mockReset();
    submit.mockResolvedValue({ status: 200 } as never);
  });

  it("sends nothing without the first-login marker, but still keeps the first source", async () => {
    await recordStart(ORG, EMAIL, "kubernetes", false);
    expect(submit).not.toHaveBeenCalled();
    expect(localStorage.getItem(`o2.onboarding.firstSource.${ORG}`)).toBe("kubernetes");
  });

  it("sends once with the marker and takes it, even on a double click", async () => {
    markStartPending(EMAIL);
    await Promise.all([
      recordStart(ORG, EMAIL, "kubernetes", false),
      recordStart(ORG, EMAIL, "kubernetes", false),
    ]);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(ORG, {
      from: "",
      company: "",
      first_source: "kubernetes",
      skipped: false,
    });
    expect(localStorage.getItem(PENDING)).toBeNull();
    expect(isHeardFromPending(EMAIL)).toBe(true);
  });

  it("puts the marker back when the call fails, so a later exit retries", async () => {
    markStartPending(EMAIL);
    submit.mockResolvedValue({ status: 500 } as never);
    await recordStart(ORG, EMAIL, "kubernetes", false);
    expect(localStorage.getItem(PENDING)).toBe("true");
    submit.mockRejectedValue(new Error("down"));
    await recordStart(ORG, EMAIL, "kubernetes", false);
    expect(localStorage.getItem(PENDING)).toBe("true");
    expect(submit).toHaveBeenCalledTimes(2);
    expect(isHeardFromPending(EMAIL)).toBe(false);
  });

  it("leaves the heard-from question pending after a skip", async () => {
    markStartPending(EMAIL);
    await recordStart(ORG, EMAIL, undefined, true);
    expect(isHeardFromPending(EMAIL)).toBe(true);
    expect(submit.mock.calls[0][1]).toMatchObject({ skipped: true, first_source: undefined });
  });
});

describe("the Slack invite's day-two clock", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const status = () =>
    JSON.parse(localStorage.getItem(`slackCommunityInvite:${EMAIL}`) ?? "{}").status;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    submit.mockResolvedValue({ status: 200 } as never);
  });
  afterEach(() => vi.useRealTimers());

  it("starts when onboarding records a first login's start, and the invite waits a day and a new session", async () => {
    vi.useFakeTimers();
    markStartPending(EMAIL);
    await recordStart(ORG, EMAIL, undefined, true);
    expect(status()).toBe("pending_day2");
    expect(sessionStorage.getItem(`connectDataSourcePromptShown:${EMAIL}`)).toBe("true");
    expect(shouldShowStandaloneSlackInvite(EMAIL)).toBe(false);
    vi.setSystemTime(Date.now() + DAY_MS);
    expect(shouldShowStandaloneSlackInvite(EMAIL)).toBe(true);
  });

  it("starts when a user leaves onboarding without a pending start", async () => {
    await recordStart(ORG, EMAIL, undefined, true);
    expect(status()).toBe("pending_day2");
  });

  it("starts when a guide claims the session", () => {
    suppressConnectPrompt(EMAIL);
    expect(status()).toBe("pending_day2");
  });
});

describe("startPending", () => {
  beforeEach(() => localStorage.clear());

  it("is true from a first login until the start is recorded", async () => {
    expect(startPending(EMAIL)).toBe(false);
    markStartPending(EMAIL);
    expect(startPending(EMAIL)).toBe(true);
    submit.mockResolvedValue({ status: 200 } as never);
    await recordStart(ORG, EMAIL, undefined, true);
    expect(startPending(EMAIL)).toBe(false);
  });
});

describe("suppressConnectPrompt", () => {
  it("marks this session's prompt as shown, so the Slack invite waits for a later session", () => {
    suppressConnectPrompt(EMAIL);
    expect(sessionStorage.getItem(`connectDataSourcePromptShown:${EMAIL}`)).toBe("true");
  });
});

describe("redirectPending", () => {
  afterEach(() => {
    sessionStorage.clear();
    document.cookie = "aws_marketplace_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("is false on a clean Home", () => {
    expect(redirectPending("home")).toBe(false);
  });

  it("is true on any route other than home", () => {
    expect(redirectPending("logs")).toBe(true);
  });

  it("is true for a pending redirectURI or marketplace token", () => {
    for (const key of ["redirectURI", "azure_marketplace_token"]) {
      sessionStorage.clear();
      sessionStorage.setItem(key, "x");
      expect(redirectPending("home")).toBe(true);
    }
  });

  it("is true for the aws marketplace cookie", () => {
    document.cookie = "aws_marketplace_token=tok";
    expect(redirectPending("home")).toBe(true);
  });
});
