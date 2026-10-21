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
  default: { getSettings: vi.fn() },
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

const code = (w: ReturnType<typeof mountCommand>) =>
  w.find('[data-test="fleet-install-command-code"]').text();

describe("FleetInstallCommand", () => {
  beforeEach(() => {
    vi.mocked(fleet.getSettings).mockResolvedValue({
      data: { target_collector_version: "0.163.1", restricted_components: [] },
    } as any);
  });

  afterEach(() => vi.clearAllMocks());

  it("offers Linux, macOS, Windows, Docker and Kubernetes", () => {
    const offered = mountCommand()
      .findAll('[data-test^="fleet-install-command-os-"]')
      .map((b) => b.text());
    expect(offered).toEqual(["Linux", "macOS", "Windows", "Docker", "Kubernetes"]);
  });

  it("runs the install script for the current org with the token", () => {
    const text = code(mountCommand());
    expect(text).toContain("/agents/main/fleet/install.sh");
    expect(text).toContain(`--org '${store.state.selectedOrganization.identifier}'`);
    expect(text).toContain("--token 'o2ft_abc123'");
  });

  it("installs and names the org's target collector version", async () => {
    const w = mountCommand();
    await flushPromises();
    expect(w.find('[data-test="fleet-install-command-version"]').text()).toContain("0.163.1");
    expect(code(w)).toContain("--version '0.163.1'");
  });

  it("says the script picks the version when the org sets none", async () => {
    vi.mocked(fleet.getSettings).mockResolvedValue({
      data: { target_collector_version: null, restricted_components: [] },
    } as any);
    const w = mountCommand();
    await flushPromises();
    expect(w.find('[data-test="fleet-install-command-version"]').text()).toBe(
      "Installs the latest supported collector version",
    );
    expect(code(w)).not.toContain("--version");
  });

  it("switches to HTTP polling with the proxy checkbox", async () => {
    const w = mountCommand();
    w.findComponent({ name: "OCheckbox" }).vm.$emit("update:modelValue", true);
    await w.vm.$nextTick();
    expect(code(w)).toContain("--transport http");
  });

  it("shows Helm with the fleet collector image on Kubernetes, without the proxy option", async () => {
    const w = mountCommand();
    await flushPromises();
    await choose(w, "kubernetes");
    expect(code(w)).toContain("o2cr.ai/openobserve/otel-fleet-collector");
    expect(w.find('[data-test="fleet-install-command-http"]').exists()).toBe(false);
  });
});
