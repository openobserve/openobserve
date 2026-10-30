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

import { describe, expect, it } from "vitest";

import i18n from "@/locales";
import type {
  TelephonyReason,
  TelephonyState,
  TelephonyStatus,
  TelephonyView,
} from "@/ts/interfaces/oncall";
import type { TranslateFn } from "@/types/i18n";
import { makeTelephonySchema, type TelephonyForm } from "./TelephonyAccountDialog.schema";
import {
  liveTelephonyStatus,
  telephonyHealth,
  telephonyPageState,
  telephonyRefusalOf,
  telephonyRefusalText,
} from "./telephony";

const t = i18n.global.t as unknown as TranslateFn;

describe("telephonyRefusalText", () => {
  const rows: [TelephonyReason, string][] = [
    ["bad_provider", "The provider must be Twilio."],
    ["bad_sid", "That is not a Twilio Account SID; it starts with AC."],
    ["bad_from_number", "Use the full number with country code, for example +18335550100."],
    ["token_required", "An auth token is required to connect."],
    ["no_master_key", "Ask your operator to set O2_MASTER_ENCRYPTION_KEY."],
    [
      "account_rejected",
      "Twilio did not accept this account. Check the Account SID and auth token, and that the account is active.",
    ],
    [
      "from_not_on_account",
      "This number is not on this Twilio account. Use one from Phone Numbers → Active numbers in Twilio.",
    ],
    ["unavailable", "Twilio could not be reached. Try again."],
    ["unreadable", "This organisation's phone provider account could not be read."],
  ];

  it.each(rows)("%s reads as the mockup words it", (reason, expected) => {
    expect(String(telephonyRefusalText(t, reason))).toBe(expected);
  });

  it("reads a refusal body, and nothing that lacks a known reason", () => {
    const err = (data: unknown) => ({ response: { status: 400, data } });
    expect(telephonyRefusalOf(err({ message: "m", reason: "bad_sid" }))?.reason).toBe("bad_sid");
    expect(telephonyRefusalOf(err({ message: "m", reason: "wrong_code" }))).toBeNull();
    expect(telephonyRefusalOf(err({ message: "m" }))).toBeNull();
    expect(telephonyRefusalOf(new Error("network"))).toBeNull();
  });
});

describe("makeTelephonySchema", () => {
  const SID = "ACtestaccountsid000000000001";
  const valid: TelephonyForm = {
    account_sid: SID,
    auth_token: "secret",
    from_number: "+18335550100",
  };
  const fieldsFailing = (
    mode: "connect" | "update",
    over: Partial<TelephonyForm>,
    savedSid?: string,
  ) => {
    const result = makeTelephonySchema(t, mode, savedSid).safeParse({ ...valid, ...over });
    return result.success ? [] : [...new Set(result.error.issues.map((i) => i.path.join(".")))];
  };

  it.each<[string, "connect" | "update", Partial<TelephonyForm>, string[]]>([
    ["connect needs a token", "connect", { auth_token: "" }, ["auth_token"]],
    ["update of the same account keeps the stored token", "update", { auth_token: "" }, []],
    [
      "update to another account needs its token",
      "update",
      { account_sid: "ACother", auth_token: " " },
      ["auth_token"],
    ],
    ["update to another account with its token", "update", { account_sid: "ACother" }, []],
  ])("%s", (_, mode, over, failing) => {
    expect(fieldsFailing(mode, over, SID)).toEqual(failing);
  });

  const rows: [string, Partial<TelephonyForm>, string[]][] = [
    ["a well-formed account", {}, []],
    ["a blank SID", { account_sid: "" }, ["account_sid"]],
    ["a SID without AC", { account_sid: "SK0123" }, ["account_sid"]],
    ["a SID with a symbol", { account_sid: "AC01-23" }, ["account_sid"]],
    ["a bare AC", { account_sid: "AC" }, ["account_sid"]],
    ["a local number", { from_number: "0833 555 0100" }, ["from_number"]],
    ["a number with spaces", { from_number: "+1 833 555 0100" }, ["from_number"]],
    ["a leading zero country code", { from_number: "+0833555010" }, ["from_number"]],
    ["too short", { from_number: "+123456" }, ["from_number"]],
    ["the shortest E.164", { from_number: "+1234567" }, []],
    ["the longest E.164", { from_number: "+123456789012345" }, []],
    ["one digit too long", { from_number: "+1234567890123456" }, ["from_number"]],
  ];

  it.each(rows)("%s", (_, over, failing) => {
    expect(fieldsFailing("connect", over)).toEqual(failing);
  });

  it("words the From number error as the mockup does", () => {
    const result = makeTelephonySchema(t, "connect").safeParse({ ...valid, from_number: "0833" });
    expect(result.success ? "" : result.error.issues[0].message).toBe(
      "Use the full number with country code, for example +18335550100.",
    );
  });
});

describe("telephonyPageState", () => {
  const none: TelephonyView = { deployment_account_present: false, press4_available: true };
  const org: TelephonyView = {
    ...none,
    org: { provider: "twilio", account_sid: "AC1", from_number: "+18335550100" },
  };
  const deployment: TelephonyView = { ...none, deployment_account_present: true };
  const failed = { response: { status: 500 } };
  const denied = { response: { status: 403 } };

  it.each<[string, TelephonyView | null, unknown, string]>([
    ["nothing read yet", null, null, "loading"],
    ["no account anywhere", none, null, "empty"],
    ["only the deployment's", deployment, null, "deployment"],
    ["the org's own wins", { ...deployment, org: org.org }, null, "connected"],
    ["a first read that failed", null, failed, "failed"],
    ["a first read that was denied", null, denied, "forbidden"],
    ["a refetch that failed keeps the data", org, failed, "connected"],
    ["a refetch that was denied keeps the data", none, denied, "empty"],
  ])("%s", (_, view, err, expected) => {
    expect(telephonyPageState(view, err)).toBe(expected);
  });
});

describe("telephonyHealth", () => {
  const status = (state: TelephonyState): TelephonyStatus => ({
    state,
    trial: false,
    can_text: false,
    can_call: false,
  });

  it.each<[string, TelephonyStatus | null, unknown, string]>([
    ["no answer yet", null, null, "checking"],
    ["the check itself failed", null, { response: { status: 500 } }, "unchecked"],
    ["ok", status("ok"), null, "ok"],
    [
      "a re-check failed after an earlier answer",
      status("ok"),
      { response: { status: 500 } },
      "unchecked",
    ],
    ["credentials refused", status("account_rejected"), null, "broken"],
    ["number not on the account", status("from_not_on_account"), null, "broken"],
    ["stored account unreadable", status("unreadable"), null, "broken"],
    ["Twilio unreachable", status("unavailable"), null, "unchecked"],
    ["no account to check", status("none"), null, "unchecked"],
  ])("%s", (_, given, err, expected) => {
    expect(telephonyHealth(given, err)).toBe(expected);
  });
});

describe("liveTelephonyStatus", () => {
  const ok: TelephonyStatus = { state: "ok", trial: false, can_text: true, can_call: true };

  it.each<[string, TelephonyStatus | undefined, unknown, TelephonyStatus | null]>([
    ["the latest answer", ok, null, ok],
    ["no answer yet", undefined, null, null],
    ["a cached answer after a failed re-check", ok, { response: { status: 500 } }, null],
  ])("%s", (_, cached, err, expected) => {
    expect(liveTelephonyStatus(cached, err)).toEqual(expected);
  });
});
