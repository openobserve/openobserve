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

import { describe, it, expect } from "vitest";
import { gt } from "@/types/i18n";
import { aiCreditsNotice, aiCreditsRemedy, isAiCreditsExhausted } from "./aiCredits";

const body = (over: Record<string, unknown>) => ({
  error_type: "ai_credits_exhausted",
  message: "server wording",
  ...over,
});

describe("aiCredits", () => {
  it("recognises only the AI-credits 402 body", () => {
    expect(isAiCreditsExhausted(body({}))).toBe(true);
    expect(isAiCreditsExhausted({ message: "x" })).toBe(false);
    expect(isAiCreditsExhausted(null)).toBe(false);
  });

  it("maps each remedy to its guidance", () => {
    expect(aiCreditsRemedy(body({ remedy: "subscribe" }), gt)).toBe(
      "Subscribe to keep using AI. Further usage is billed on this organization's invoice.",
    );
    expect(aiCreditsRemedy(body({ remedy: "subscribe", payer_org_id: "acme" }), gt)).toContain(
      "managed by acme",
    );
    expect(aiCreditsRemedy(body({ remedy: "contact_account_manager" }), gt)).toBe(
      "Contact your account manager to add more AI credits",
    );
    expect(aiCreditsRemedy(body({ remedy: "retry" }), gt)).toBe("server wording");
  });

  it("joins the headline and remedy for one-line surfaces", () => {
    expect(aiCreditsNotice(body({ remedy: "contact_account_manager" }), gt)).toBe(
      "Your organization has used all of its AI credits. Contact your account manager to add more AI credits",
    );
  });
});
