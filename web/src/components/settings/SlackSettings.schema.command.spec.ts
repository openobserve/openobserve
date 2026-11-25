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
import { defaultSlackCommand, isSlackCommand } from "./SlackSettings.schema";

// Issue 3608: the same cases as `default_command_is_a_valid_command_for_any_name` in
// o2-enterprise slack/manifest.rs, so the wizard shows the command the server would pick.
describe("defaultSlackCommand", () => {
  it.each([
    ["OpenObserve", "/o2"],
    [" openobserve ", "/o2"],
    ["", "/o2"],
    ["main-dev-app", "/main-dev-app"],
    ["Main Dev App", "/main-dev-app"],
    ["Acme O2 (prod)", "/acme-o2-prod"],
    ["--x--", "/x"],
    ["über-app", "/ber-app"],
    ["日本語", "/o2"],
    ["!!!", "/o2"],
    ["my_app", "/my_app"],
    [`${"a".repeat(30)}-b`, `/${"a".repeat(30)}`],
  ])("%s gives %s", (name, want) => {
    expect(defaultSlackCommand(name)).toBe(want);
    expect(isSlackCommand(want)).toBe(true);
  });
});

describe("isSlackCommand", () => {
  it("accepts what Slack accepts and refuses the rest", () => {
    expect(isSlackCommand("/o2-dev")).toBe(true);
    expect(isSlackCommand(`/${"a".repeat(31)}`)).toBe(true);
    for (const bad of [
      "o2",
      "/",
      "/O2",
      "/o2 dev",
      "/o2.dev",
      "//o2",
      "/ö2",
      `/${"a".repeat(32)}`,
    ]) {
      expect(isSlackCommand(bad), bad).toBe(false);
    }
  });
});
