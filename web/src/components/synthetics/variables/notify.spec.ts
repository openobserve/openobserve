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
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "src/components/synthetics/variables";
const sources = readdirSync(DIR)
  .filter((f) => f.endsWith(".vue"))
  .map((f) => ({ file: f, text: readFileSync(join(DIR, f), "utf-8") }));

describe("notification API", () => {
  // `toast` is a plain function — `function toast(options: ToastOptions)`. It
  // has no .success/.error members, so `toast.success(...)` is a TypeError at
  // runtime, not a compile error. That shipped: every notification in this
  // directory was silently dead, and because the throw landed mid-handler it
  // also skipped the `emit("update:list")` on the next line — so a save that
  // had already succeeded on the server looked like it did nothing at all.
  it("never calls toast as if it had .success or .error members", () => {
    const offenders = sources
      .filter(({ text }) => /toast\s*\.\s*(success|error|warning|info)\s*\(/.test(text))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("calls toast with an options object carrying a variant", () => {
    const callers = sources.filter(({ text }) => text.includes("toast("));
    expect(callers.length).toBeGreaterThan(0);

    for (const { file, text } of callers) {
      for (const call of text.match(/toast\(\{[^}]*/g) ?? []) {
        expect(call, `${file}: ${call}`).toMatch(/variant:/);
      }
    }
  });
});

describe("side-effect ordering", () => {
  // The refresh and the close are what the user is waiting on; a toast is
  // cosmetic. Ordering the cosmetic call first is what turned one broken API
  // call into "saving does not refresh the list".
  it("emits the refresh before showing the success toast", () => {
    for (const { file, text } of sources) {
      const success = text.indexOf('variant: "success"');
      if (success === -1) continue;

      // The nearest preceding emit that makes the save visible.
      const before = text.slice(0, success);
      const hasEmit = /emit\("(update:list|refresh|done)"/.test(before);
      const after = text.slice(success);
      const onlyAfter = !hasEmit && /emit\("(update:list|refresh|done)"/.test(after);

      expect(onlyAfter, `${file} toasts before it emits`).toBe(false);
    }
  });
});
