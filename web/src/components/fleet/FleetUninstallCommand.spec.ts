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
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import FleetUninstallCommand from "./FleetUninstallCommand.vue";

const CodeStub = {
  name: "OCodeBlock",
  props: ["code", "lang"],
  template: '<pre data-test="fleet-uninstall-command-code">{{ code }}</pre>',
};

function mountCommand(props: Record<string, unknown>) {
  return mount(FleetUninstallCommand, {
    props: { platform: "linux", ...props },
    global: { plugins: [i18n], stubs: { OCodeBlock: CodeStub } },
  });
}

const note = (w: ReturnType<typeof mountCommand>) =>
  w.find('[data-test="fleet-uninstall-command-note"]').text();

describe("FleetUninstallCommand", () => {
  it("names the macOS state and log directories the script keeps", () => {
    const w = mountCommand({ platform: "macos" });
    expect(w.find('[data-test="fleet-uninstall-command-code"]').text()).toContain("--uninstall");
    expect(note(w)).toContain("/Library/Application Support/opampsupervisor");
    expect(note(w)).toContain("/Library/Logs/opampsupervisor");
  });

  it("runs PowerShell on Windows and names the state directory it keeps", () => {
    const w = mountCommand({ platform: "windows" });
    expect(w.findComponent(CodeStub).props("lang")).toBe("powershell");
    expect(note(w)).toContain("C:\\ProgramData\\opampsupervisor\\state");
  });

  it("hides the platform picker unless asked, and reports a pick", async () => {
    expect(mountCommand({}).find('[data-test="fleet-uninstall-command-os"]').exists()).toBe(false);
    const w = mountCommand({ showPlatforms: true });
    w.findComponent({ name: "OToggleGroup" }).vm.$emit("update:model-value", "kubernetes");
    expect(w.emitted("update:platform")).toEqual([["kubernetes"]]);
  });
});
