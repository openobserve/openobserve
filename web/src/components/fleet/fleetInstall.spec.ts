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
import {
  GATEWAY_RELEASE,
  INSTALL_ENV,
  installCommand,
  opampEndpoint,
  resolveBaseUrl,
} from "./fleetInstall";

const target = {
  baseUrl: "https://o2.example.com",
  org: "acme",
  token: "o2ft_abc123",
  version: "0.163.1",
  http: false,
};

describe("installCommand", () => {
  it("pipes the Linux script from the agents repository into sudo bash with the target", () => {
    const cmd = installCommand("linux", target);
    expect(cmd).toContain(
      "curl -fsSL https://raw.githubusercontent.com/openobserve/agents/main/fleet/install.sh | sudo bash -s --",
    );
    expect(cmd).toContain("--url 'https://o2.example.com'");
    expect(cmd).toContain("--org 'acme'");
    expect(cmd).toContain("--token 'o2ft_abc123'");
    expect(cmd).toContain("--version '0.163.1'");
    expect(cmd).not.toContain("--transport");
  });

  it("uses the macOS script on macOS", () => {
    expect(installCommand("macos", target)).toContain("/agents/main/fleet/install.sh");
  });

  it("adds --transport http only when the proxy cannot carry WebSocket", () => {
    expect(installCommand("linux", { ...target, http: true })).toContain("--transport http");
    expect(installCommand("windows", { ...target, http: true })).toContain("-Transport http");
  });

  it("leaves the version to the script when the org sets none", () => {
    expect(installCommand("linux", { ...target, version: null })).not.toContain("--version");
  });

  it("quotes values so a token with a quote stays one shell word", () => {
    expect(installCommand("linux", { ...target, token: "a'b" })).toContain(`--token 'a'\\''b'`);
  });

  it("runs the PowerShell script on Windows", () => {
    const cmd = installCommand("windows", target);
    expect(cmd).toContain(
      "irm https://raw.githubusercontent.com/openobserve/agents/main/fleet/install.ps1",
    );
    expect(cmd).toContain("-Token 'o2ft_abc123'");
  });

  it("writes a supervisor.yaml and runs one container for Docker, reaching a local server through host.docker.internal", () => {
    const cmd = installCommand("docker", { ...target, baseUrl: "http://localhost:5080" });
    expect(cmd).toContain("AUTH=$(printf 'fleet:%s' 'o2ft_abc123' | base64");
    expect(cmd).toContain("endpoint: ws://host.docker.internal:5080/api/acme/v1/opamp");
    expect(cmd).toContain("insecure: true");
    expect(cmd).toContain("  config_apply_timeout: 30s");
    expect(cmd).toContain("O2_ENDPOINT: http://host.docker.internal:5080/api/acme");
    expect(cmd).toContain("-v otel-fleet-state:/var/lib/opampsupervisor");
    expect(cmd).toContain('--hostname "$(hostname)"');
    expect(cmd).toContain("o2cr.ai/openobserve/otel-fleet-collector:0.163.1");
    const remote = installCommand("docker", { ...target, version: null });
    expect(remote).toContain("endpoint: wss://o2.example.com/api/acme/v1/opamp");
    expect(remote).not.toContain("insecure");
    expect(remote).toContain("otel-fleet-collector:latest");
  });

  it("gives the collector every variable the Variables panel calls installed", () => {
    const cmd = installCommand("docker", target);
    for (const name of INSTALL_ENV) expect(cmd).toContain(`${name}:`);
  });

  it("installs the Helm chart with the fleet collector image at the target version", () => {
    const cmd = installCommand("kubernetes", target);
    expect(cmd).toContain("helm upgrade --install");
    expect(cmd).toContain("--set image.repository=o2cr.ai/openobserve/otel-fleet-collector");
    expect(cmd).toContain("--set image.tag='0.163.1'");
    expect(cmd).toContain("--set opamp.endpoint='wss://o2.example.com/api/acme/v1/opamp'");
  });

  it("installs agents as the otel-fleet-collector release with the chart's agent default", () => {
    const cmd = installCommand("kubernetes", { ...target, role: "agent" });
    expect(cmd).toContain("helm upgrade --install otel-fleet-collector openobserve/");
    expect(cmd).not.toContain("gateway");
  });

  it("installs a gateway as its own release with agents off and the chart's single replica", () => {
    const cmd = installCommand("kubernetes", { ...target, role: "gateway" });
    expect(cmd).toContain(
      `helm upgrade --install ${GATEWAY_RELEASE} openobserve/otel-fleet-collector`,
    );
    expect(cmd).toContain("--set agent.enabled=false");
    expect(cmd).toContain("--set gateway.enabled=true");
    expect(cmd).not.toContain("replicas");
    expect(cmd).toContain("--set opamp.token='o2ft_abc123'");
  });

  it("ignores the role outside Kubernetes", () => {
    expect(installCommand("docker", { ...target, role: "gateway" })).toBe(
      installCommand("docker", target),
    );
  });
});

describe("opampEndpoint", () => {
  it("uses WebSocket by default and the page scheme for HTTP polling", () => {
    expect(opampEndpoint({ ...target })).toBe("wss://o2.example.com/api/acme/v1/opamp");
    expect(opampEndpoint({ ...target, http: true })).toBe(
      "https://o2.example.com/api/acme/v1/opamp",
    );
    expect(opampEndpoint({ ...target, baseUrl: "http://localhost:5080/o2" })).toBe(
      "ws://localhost:5080/o2/api/acme/v1/opamp",
    );
  });
});

describe("resolveBaseUrl", () => {
  it("keeps an absolute endpoint and drops its trailing slash", () => {
    expect(resolveBaseUrl("https://o2.example.com/", "http://ui")).toBe("https://o2.example.com");
  });

  it("keeps a path prefix", () => {
    expect(resolveBaseUrl("https://host/o2/", "http://ui")).toBe("https://host/o2");
  });

  it("resolves a relative or empty endpoint against the page origin", () => {
    expect(resolveBaseUrl("/", "https://ui.example.com")).toBe("https://ui.example.com");
    expect(resolveBaseUrl("", "https://ui.example.com")).toBe("https://ui.example.com");
  });

  it("falls back to the origin for a malformed endpoint", () => {
    expect(resolveBaseUrl("http://", "https://ui.example.com")).toBe("https://ui.example.com");
  });
});
