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

import { gt } from "@/types/i18n";

import { INJECTION, expectNoInjection } from "./__fixtures__/prompts";
import { buildIngestionPrompt } from "./ingestion";

const ctx = {
  guideName: "Kubernetes",
  org: "acme-prod",
  endpoint: "https://api.openobserve.ai",
};

describe("buildIngestionPrompt", () => {
  it("keeps the localised guide prompt with the status, org and endpoint, never the token", () => {
    const build = buildIngestionPrompt(
      {
        ...ctx,
        diagnosis: {
          form: "rejected",
          trigger: "auto",
          rejections: [
            { status: 401, reason: "invalid_credentials", path: "/api/acme-prod/_json", at: 1 },
          ],
        },
      } as Parameters<typeof buildIngestionPrompt>[0],
      gt,
    );
    expect(build.text).toContain("Kubernetes");
    expect(build.text).toContain("401");
    expect(build.text).toContain("acme-prod");
    expect(build.text).toContain("https://api.openobserve.ai");
    expect(build.text).not.toMatch(/secret-token-value|Basic |Bearer /);
    expect(build.chips).toEqual([]);
    expect(build.title).toBe("Set up ingestion");
  });

  it("sends the English prompt whatever the UI language, with that language's messages loaded (F7, V1)", async () => {
    const i18n = (await import("@/locales")).default;
    const global = i18n.global as unknown as {
      locale: string | { value: string };
      setLocaleMessage: (locale: string, messages: unknown) => void;
    };
    global.setLocaleMessage("fr", {
      ingestion: {
        firstEvent: {
          askAiPrompt: "Je configure {guide}. {details}",
          askAiNoRequests: "rien n'est arrivé.",
          thisGuide: "une source",
        },
      },
    });
    const before = typeof global.locale === "string" ? global.locale : global.locale.value;
    const set = (v: string) =>
      typeof global.locale === "string" ? (global.locale = v) : (global.locale.value = v);
    set("fr");
    expect(i18n.global.t("ingestion.firstEvent.askAiNoRequests")).toBe("rien n'est arrivé.");
    const build = buildIngestionPrompt({
      ...ctx,
      diagnosis: { form: "no-requests", trigger: "auto", rejections: [] },
    } as Parameters<typeof buildIngestionPrompt>[0]);
    set(before);
    expect(build.text).toContain("nothing has arrived and no request was refused");
    expect(build.text).not.toContain("rien");
    expect(build.text).not.toContain("Je configure");
  });

  it("says nothing arrived when no request reached the server", () => {
    const build = buildIngestionPrompt({
      ...ctx,
      diagnosis: { form: "no-requests", trigger: "auto", rejections: [] },
    } as Parameters<typeof buildIngestionPrompt>[0]);
    expect(build.text).toContain("nothing has arrived and no request was refused");
  });

  it("keeps a planted string in any input out of the prompt text (S1)", () => {
    const build = buildIngestionPrompt({
      guideName: INJECTION,
      org: INJECTION,
      endpoint: INJECTION,
      diagnosis: {
        form: "rejected",
        trigger: "auto",
        rejections: [{ status: 400, reason: "malformed_body", path: INJECTION, at: 1 }],
      },
    } as Parameters<typeof buildIngestionPrompt>[0]);
    expectNoInjection(build);
    expect(build.text).toContain("400");
  });
});
