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

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import locale from "@/locales/languages/en-US.json";

import {
  ASSISTANT_ERROR_CODES,
  ERROR_LEDGER,
  isConsentPrompt,
  toAssistantError,
  WIRE_ACTIONS,
} from "./assistantErrors";
import type { AssistantErrorCode } from "./assistantStore.types";

const FIXTURES = join(__dirname, "__fixtures__", "errors");

// o2-ai vendors some of these fixtures; this repo's copy is the one they must agree with.
const O2AI_FIXTURES = join(
  process.env.O2AI_DIR ?? join(__dirname, "..", "..", "..", "..", "..", "o2-ai"),
  "tests",
  "fixtures",
  "assistant_frames",
  "errors",
);

const vendored = ["envelope", "wire"].flatMap((dir) =>
  existsSync(join(O2AI_FIXTURES, dir))
    ? readdirSync(join(O2AI_FIXTURES, dir)).map((file) => [dir, file] as const)
    : [],
);

const read = (dir: string, file: string) =>
  JSON.parse(readFileSync(join(FIXTURES, dir, file), "utf8")) as {
    status?: number;
    body: Record<string, unknown>;
  };

// The documented code of every wire shape (`80` §1.3, audit §2.3).
const WIRE: Record<string, AssistantErrorCode> = {
  "A.already_submitted_409.json": "already_submitted",
  "A.authz_503.json": "authorization_unavailable",
  "A.credits_exhausted_402.json": "credits_exhausted",
  "A.lease_409.json": "turn_busy",
  "A.not_enabled_400.json": "not_enabled",
  "A.subscription_required_402.json": "subscription_required",
  "B.agent_502.json": "agent_unavailable",
  "B.upstream_429.json": "rate_limited",
  "C.owner_unavailable_409.json": "session_owner_unavailable",
  "D.turn_limit_429.json": "turn_limit",
  "E.consent_412.json": "consent_declined",
  "F.history_unavailable_503.json": "history_unavailable",
  "G.confirm_500.json": "approval_delivery_failed",
  "H.llm_overload_frame.json": "provider_error",
  "I1.agent_unreachable_frame.json": "agent_unavailable",
  "I1.persistence_failed_frame.json": "persistence_failed",
  "I2.history_failed_turn_frame.json": "agent_unavailable",
  "J.stream_interrupted_frame.json": "agent_unavailable",
  "M1.restore_required_frame.json": "restore_required",
  "M1.stale_epoch_frame.json": "stale_epoch",
  "M2.owner_race_frame.json": "session_owner_unavailable",
};

// The B-01 envelope names its code; consent_required has no turn code of its own.
const ENVELOPE_ALIASES: Partial<Record<string, AssistantErrorCode>> = {
  consent_required: "consent_declined",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toAssistantError: the thirteen wire shapes", () => {
  it("covers every wire fixture on disk", () => {
    expect(readdirSync(join(FIXTURES, "wire")).sort()).toEqual(Object.keys(WIRE).sort());
  });

  it.each(Object.entries(WIRE))("maps %s to %s", (file, code) => {
    const fixture = read("wire", file);
    const error = toAssistantError(fixture);
    expect(error.code).toBe(code);
    expect(error.code).not.toBe("unknown");
    if (fixture.status) expect(error.httpStatus).toBe(fixture.status);
  });

  it("never reads this tab's own lock refusals from the wire", () => {
    for (const code of ["approval_elsewhere", "account_changed"])
      expect(toAssistantError({ code, message: "x" }).code).not.toBe(code);
  });

  it("keeps the raw server sentence for Details only", () => {
    const error = toAssistantError(read("wire", "A.lease_409.json"));
    expect(error.serverMessage).toBe("Another turn is already running in this conversation");
  });

  it("reads `recoverable:false` on a provider failure as Edit and resend", () => {
    const body = { type: "error", error_type: "llm_overload", message: "x", recoverable: false };
    expect(toAssistantError(body)).toMatchObject({
      code: "provider_error",
      retryable: false,
      action: "edit_resend",
    });
  });

  it("flips O2AIChat.stream.spec.ts:1288: an error frame is a typed provider_error, never answer text", () => {
    const frame = {
      type: "error",
      error_type: "llm_overload",
      message: "The language model provider is overloaded. Please try again in a moment.",
    };
    expect(toAssistantError(frame, { phase: "post_admission" })).toMatchObject({
      code: "provider_error",
      phase: "post_admission",
      action: "retry",
    });
  });
});

describe("toAssistantError: the B-01 envelope", () => {
  const files = readdirSync(join(FIXTURES, "envelope"));

  it.each(files)("maps the envelope %s to its own code", (file) => {
    const fixture = read("envelope", file);
    const named = String(fixture.body.code);
    const error = toAssistantError(fixture);
    expect(error.code).toBe(ENVELOPE_ALIASES[named] ?? named);
  });

  it("gives the envelope the same code as today's shape (parity)", () => {
    const pairs: [string, string][] = [
      ["A.lease_409.json", "turn_busy.json"],
      ["D.turn_limit_429.json", "turn_limit.json"],
      ["A.credits_exhausted_402.json", "credits_exhausted.json"],
      ["C.owner_unavailable_409.json", "session_owner_unavailable.json"],
      ["M1.stale_epoch_frame.json", "stale_epoch.json"],
      ["I1.persistence_failed_frame.json", "persistence_failed.json"],
    ];
    for (const [wire, envelope] of pairs)
      expect(toAssistantError(read("envelope", envelope)).code).toBe(
        toAssistantError(read("wire", wire)).code,
      );
  });

  it.each(files)("sends the envelope %s with WP-17's fields and a closed-set action", (file) => {
    const body = read("envelope", file).body;
    expect(WIRE_ACTIONS).toContain(body.action);
    expect(body).toMatchObject({ error_code: body.code, recoverable: body.retryable });
    expect(typeof body.turn_id).toBe("string");
  });

  it("words the button from the code, never from the wire action", () => {
    expect(toAssistantError(read("envelope", "turn_busy.json")).action).toBe("stop_it");
    expect(toAssistantError(read("envelope", "credits_exhausted.json")).action).toBe(
      ERROR_LEDGER.credits_exhausted.action,
    );
    expect(toAssistantError(read("envelope", "persistence_failed.json")).action).toBe("retry_save");
  });

  it("reads the wire action only for a code the ledger does not know", () => {
    const body = { code: "invalid_request", message: "x", retryable: false, action: "sign_in" };
    expect(toAssistantError({ status: 418, body })).toMatchObject({
      code: "unknown",
      action: "sign_in",
    });
    expect(toAssistantError({ status: 418, body: { ...body, action: "reload" } }).action).toBe(
      "reload_chat",
    );
    expect(toAssistantError({ status: 418, body: { ...body, action: "wait" } }).action).toBe(
      "retry",
    );
  });

  it("reads `retryable:false` on a provider error frame as Edit and resend", () => {
    const frame = {
      type: "error",
      code: "provider_error",
      message: "x",
      retryable: false,
      action: "none",
    };
    expect(toAssistantError(frame).action).toBe("edit_resend");
  });

  it("takes retry_after in seconds and the envelope's retryable flag", () => {
    const error = toAssistantError(read("envelope", "rate_limited.json"));
    expect(error).toMatchObject({ code: "rate_limited", retryAfterMs: 30_000, retryable: true });
  });
});

describe("toAssistantError: status beats body", () => {
  it("reads a 403 as permission_denied whatever the body says (constraint 12)", () => {
    const error = toAssistantError({
      status: 403,
      body: { code: "credits_exhausted", message: "AI credit limit exhausted" },
    });
    expect(error).toMatchObject({
      code: "permission_denied",
      httpStatus: 403,
      phase: "pre_admission",
    });
  });

  it("reads a 429 without error_code as rate_limited, never turn_limit (BE D4)", () => {
    expect(toAssistantError({ status: 429, body: { code: 429, error: "slow down" } }).code).toBe(
      "rate_limited",
    );
  });

  it("carries the active turn id of a turn_busy 409 (B-03)", () => {
    const error = toAssistantError(
      { status: 409, body: { error_code: "turn_busy", active_turn_id: "t-running" } },
      { turnId: "t-mine" },
    );
    expect(error).toMatchObject({ code: "turn_busy", turnId: "t-running", action: "stop_it" });
  });

  it("leaves turnId unset on a turn_busy without active_turn_id, so Stop it never cancels our own turn", () => {
    const error = toAssistantError(
      {
        status: 409,
        body: { code: 409, message: "Another turn is already running in this conversation" },
      },
      { turnId: "t-mine" },
    );
    expect(error.code).toBe("turn_busy");
    expect(error.turnId).toBeUndefined();
    expect(toAssistantError({ status: 429, body: {} }, { turnId: "t-mine" }).turnId).toBe("t-mine");
  });

  it.each([
    ["llm_overload", "overloaded"],
    ["llm_timeout", "timed_out"],
    ["llm_model_not_found", "model_unavailable"],
    ["llm_context_length_exceeded", "request_too_large"],
  ])("maps error_type %s to the fixed provider reason %s", (errorType, reason) => {
    expect(toAssistantError({ type: "error", error_type: errorType, message: "x" }).reason).toBe(
      reason,
    );
  });

  it("gives an untyped provider failure no reason, never one guessed from text", () => {
    const error = toAssistantError({
      type: "error",
      category: "llm",
      message: "the model is overloaded",
    });
    expect(error.code).toBe("provider_error");
    expect(error.reason).toBeUndefined();
  });

  it("reads an axios error by its response", () => {
    expect(toAssistantError({ response: { status: 502, data: {} } }).code).toBe(
      "agent_unavailable",
    );
  });

  it("falls back to unknown for a status the ledger does not name", () => {
    expect(toAssistantError({ status: 418, body: { message: "teapot" } }).code).toBe("unknown");
    expect(toAssistantError("garbage").code).toBe("unknown");
    expect(toAssistantError({ type: "error" }).code).toBe("unknown");
  });

  it("tells the consent prompt from any other 412", () => {
    expect(isConsentPrompt(412, read("wire", "E.consent_412.json").body)).toBe(true);
    expect(isConsentPrompt(412, { error_type: "paid_overage_consent_required" })).toBe(false);
    expect(isConsentPrompt(402, { code: "consent_required" })).toBe(false);
  });
});

describe("toAssistantError: fetch rejections", () => {
  it("is offline when the browser says so, unreachable otherwise", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(toAssistantError(new TypeError("Failed to fetch"))).toMatchObject({
      code: "offline",
      phase: "pre_admission",
      action: "retry",
    });
    vi.stubGlobal("navigator", { onLine: true });
    expect(toAssistantError(new TypeError("Failed to fetch")).code).toBe("unreachable");
  });

  it("never lets a null-body crash reach the user as text (HT-02 AC 7)", () => {
    vi.stubGlobal("navigator", { onLine: true });
    const error = toAssistantError(new TypeError("Cannot read properties of null (reading 'ok')"));
    expect(error.code).toBe("unreachable");
  });

  it("keeps the phase the caller names for reads, writes and client errors", () => {
    expect(toAssistantError({ status: 500, body: {} }, { phase: "read" }).phase).toBe("read");
    expect(toAssistantError({ status: 500, body: {} }, { phase: "pre_admission" }).phase).toBe(
      "pre_admission",
    );
  });

  it("returns an AssistantError unchanged", () => {
    const error = toAssistantError({ status: 401, body: {} });
    expect(toAssistantError(error)).toBe(error);
  });
});

describe("the error ledger", () => {
  const keys = locale.assistant.error as Record<string, Record<string, string>>;

  it("names exactly the assistant.error.* namespaces in en-US.json (HT-07 AC 7)", () => {
    expect([...ASSISTANT_ERROR_CODES].sort()).toEqual(Object.keys(keys).sort());
    expect(Object.keys(ERROR_LEDGER).sort()).toEqual([...ASSISTANT_ERROR_CODES].sort());
  });

  it.each(ASSISTANT_ERROR_CODES)(
    "gives %s a title, and an action unless it offers none",
    (code) => {
      expect(keys[code].title).toBeTruthy();
      if (ERROR_LEDGER[code].action !== "none") expect(keys[code].action).toBeTruthy();
      else expect(keys[code].action).toBeUndefined();
    },
  );

  it("keeps the copy in sentence case without Please, an exclamation mark or the product literal", () => {
    for (const entry of Object.values(keys))
      for (const [field, text] of Object.entries(entry)) {
        // The provider reasons are fragments inside `{reason}`, so they start lower case.
        if (field === "reason") continue;
        expect(text).not.toMatch(/Please|!$|O2 Assistant|AI Assistant/);
        expect(text[0]).toBe(text[0].toUpperCase());
      }
  });
});

describe.skipIf(!vendored.length)("o2-ai's vendored error fixtures", () => {
  it.each(vendored)("%s/%s agrees with this repo's fixture", (dir, file) => {
    const theirs = JSON.parse(readFileSync(join(O2AI_FIXTURES, dir, file), "utf8")) as {
      status?: number;
      body: Record<string, unknown>;
    };
    const ours = read(dir, file);
    expect(theirs.status).toBe(ours.status);
    expect(ours.body).toMatchObject(theirs.body);
  });
});
