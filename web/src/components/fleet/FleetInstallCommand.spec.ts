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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import FleetInstallCommand from "./FleetInstallCommand.vue";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: { listCollectors: vi.fn(), getCollector: vi.fn(), summary: vi.fn() },
}));

const CodeStub = {
  name: "FleetCodeEditor",
  props: ["code", "language"],
  template: '<pre data-test="fleet-install-command-code">{{ code }}</pre>',
};

function mountCommand(props: Record<string, unknown> = {}) {
  return mount(FleetInstallCommand, {
    props: { token: "o2ft_abc123", ...props },
    global: { plugins: [i18n, store], stubs: { FleetCodeEditor: CodeStub } },
  });
}

const choose = async (w: ReturnType<typeof mountCommand>, os: string) => {
  w.findComponent({ name: "OToggleGroup" }).vm.$emit("update:model-value", os);
  await w.vm.$nextTick();
};

describe("FleetInstallCommand", () => {
  beforeEach(() => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: { target_version: "0.162.0" } } as any);
  });

  afterEach(() => vi.clearAllMocks());

  it("shows the supervisor config for the current org and API endpoint on Linux", () => {
    const code = mountCommand().find('[data-test="fleet-install-command-code"]').text();
    expect(code).toContain(`org: ${store.state.selectedOrganization.identifier}`);
    expect(code).toContain("token: o2ft_abc123");
    expect(code).toMatch(/url: https?:\/\/\S+/);
    expect(code).toContain("o2c-supervisor -config /etc/o2c-supervisor/supervisor.yaml");
    expect(code).toContain("install -m 600");
  });

  it("names the org's target collector version in the prerequisites", async () => {
    const w = mountCommand();
    await flushPromises();
    expect(fleet.summary).toHaveBeenCalled();
    expect(w.find('[data-test="fleet-install-command-prereq"]').text()).toContain("0.162.0");
  });

  it("names an admin-set target version in the prerequisites", async () => {
    vi.mocked(fleet.summary).mockResolvedValue({ data: { target_version: "0.170.0" } } as any);
    const w = mountCommand();
    await flushPromises();
    expect(w.find('[data-test="fleet-install-command-prereq"]').text()).toContain("0.170.0");
  });

  it("falls back to wording, not a made-up version, until the summary loads", () => {
    vi.mocked(fleet.summary).mockReturnValue(new Promise(() => {}) as any);
    const text = mountCommand().find('[data-test="fleet-install-command-prereq"]').text();
    expect(text).toContain("the org's target version");
    expect(text).not.toMatch(/\d+\.\d+\.\d+/);
  });

  it("writes no initial configuration into the command", () => {
    const code = mountCommand().find('[data-test="fleet-install-command-code"]').text();
    expect(code).not.toContain("initial_config");
  });

  it("shows the macOS config on the macOS tab", async () => {
    const w = mountCommand();
    await choose(w, "macos");
    expect(w.find('[data-test="fleet-install-command-code"]').text()).toContain(
      "$HOME/o2c-supervisor/supervisor.yaml",
    );
  });

  it("offers only the systems that have an install command", () => {
    const w = mountCommand();
    const offered = w.findAll('[data-test^="fleet-install-command-os-"]').map((b) => b.text());
    expect(offered).toEqual(["Linux", "macOS"]);
  });
});
