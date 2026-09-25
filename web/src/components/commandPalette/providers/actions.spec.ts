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

import { describe, it, expect, vi } from "vitest";
import { raw } from "@/types/i18n";
import { buildActionItems } from "./actions";

const t = raw as any;
const handlers = {
  toggleTheme: vi.fn(),
  openShortcuts: vi.fn(),
  openDocs: vi.fn(),
  openSlack: vi.fn(),
};

describe("buildActionItems", () => {
  it("drops create rows whose route is not registered", () => {
    const items = buildActionItems({
      t,
      handlers,
      hasRoute: (n) => n === "alertList",
      isDark: false,
    });
    const ids = items.map((i) => i.id);
    expect(ids).toContain("action:newAlert");
    expect(ids).not.toContain("action:newDashboard");
    expect(ids).not.toContain("action:newPipeline");
    expect(ids).toContain("action:toggleTheme");
    expect(ids).toContain("external:docs");
    expect(items.every((i) => !("requires" in i))).toBe(true);
  });

  it("navigates create rows with the query the target page reads", () => {
    const items = buildActionItems({ t, handlers, hasRoute: () => true, isDark: false });
    expect(items.find((i) => i.id === "action:newAlert")!.route).toEqual({
      name: "alertList",
      query: { action: "add" },
    });
    expect(items.find((i) => i.id === "action:newFunction")!.route).toEqual({
      name: "functionList",
      query: { action: "add" },
    });
    expect(items.find((i) => i.id === "action:newPipeline")!.route).toEqual({
      name: "createPipeline",
    });
  });

  it("flips the theme row with the current mode and wires the handlers", () => {
    const dark = buildActionItems({ t, handlers, hasRoute: () => true, isDark: true });
    const theme = dark.find((i) => i.id === "action:toggleTheme")!;
    expect(theme.label).toBe("palette.actions.lightMode");
    expect(theme.icon).toBe("light-mode");
    theme.run!();
    expect(handlers.toggleTheme).toHaveBeenCalled();
    dark.find((i) => i.id === "action:shortcuts")!.run!();
    expect(handlers.openShortcuts).toHaveBeenCalled();
    dark.find((i) => i.id === "external:docs")!.run!();
    expect(handlers.openDocs).toHaveBeenCalled();
  });
});
