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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/styles/tailwind.css"), "utf8");

const keyframesBody = (name: string) =>
  css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";

describe("popup reveal keyframes", () => {
  // clip-path drops the clipped part from hit-testing, so a click while a menu opens would fall through.
  it.each(["o2-reveal-down-in", "o2-reveal-up-in"])(
    "%s reveals with a mask instead of clip-path",
    (name) => {
      const body = keyframesBody(name);

      expect(body).toContain("mask-size");
      expect(body).not.toContain("clip-path");
    },
  );
});
