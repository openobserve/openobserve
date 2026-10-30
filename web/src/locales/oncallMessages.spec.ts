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

// vue-i18n COMPILES each message the first time it is used, and a message with
// unescaped syntax throws at that moment — taking the whole component subtree
// with it while the rest of the page renders normally. That failure mode is
// invisible to lint, to vue-tsc and to any test that stubs i18n, so it is
// worth compiling every message in the namespace here.
//
// The bug this exists for: `engineer@example.com` as a placeholder. `@` opens a
// linked message in vue-i18n, so the Members tab rendered blank in the browser
// while every test passed.

import { describe, expect, it } from "vitest";

import enLocale from "@/locales/languages/en-US.json";

type Messages = Record<string, unknown>;

/** Every leaf string under a namespace, keyed by its dotted path. */
function leaves(node: unknown, prefix = ""): Array<[string, string]> {
  if (typeof node === "string") return [[prefix, node]];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node as Messages).flatMap(([k, v]) =>
    leaves(v, prefix ? `${prefix}.${k}` : k),
  );
}

const oncallMessages = [
  ...leaves((enLocale as Messages).oncall, "oncall"),
  ...leaves((enLocale as Messages).emptyState, "emptyState").filter(([path]) =>
    path.toLowerCase().includes("oncall"),
  ),
];

describe("on-call locale messages", () => {
  it("has messages to check", () => {
    expect(oncallMessages.length).toBeGreaterThan(50);
  });

  // `@` is the linked-message operator. A literal one must be written
  // `{'@'}`, or compilation throws.
  it("escapes every literal @", () => {
    const offenders = oncallMessages.filter(
      ([, text]) => text.includes("@") && !text.includes("{'@'}"),
    );
    expect(offenders).toEqual([]);
  });

  // `|` separates plural branches. A message using it must have a non-empty
  // message on both sides, or the compiler reports
  // MUST_HAVE_MESSAGES_IN_PLURAL.
  it("gives every plural branch a message", () => {
    const offenders = oncallMessages.filter(([, text]) => {
      if (!text.includes("|")) return false;
      return text.split("|").some((branch) => branch.trim() === "");
    });
    expect(offenders).toEqual([]);
  });

  // Backstop only. Runtime compilation behaviour varies with config — this
  // did NOT reject `engineer@example.com`, which is why the syntactic checks
  // above are the primary guard rather than this one.
  it("compiles every message without throwing", async () => {
    const { createI18n } = await import("vue-i18n");
    const failures: Array<{ path: string; error: string }> = [];

    for (const [path, text] of oncallMessages) {
      // A fresh instance per message so one failure cannot mask another, and
      // so a cached compilation never hides a broken source string.
      const i18n = createI18n({
        legacy: false,
        locale: "en",
        messages: { en: { probe: text } },
      });
      try {
        // Plural messages need a count to select a branch; passing one is
        // harmless for the rest.
        i18n.global.t("probe", { count: 1 }, 1);
      } catch (e) {
        failures.push({ path, error: String(e) });
      }
    }

    expect(failures).toEqual([]);
  });
});
