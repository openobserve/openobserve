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
import { installCommand, opampEndpoint, resolveBaseUrl } from "./fleetInstall";

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
      "curl -fsSL https://raw.githubusercontent.com/openobserve/agents/main/linux/install.sh | sudo bash -s --",
    );
    expect(cmd).toContain("--url 'https://o2.example.com'");
    expect(cmd).toContain("--org 'acme'");
    expect(cmd).toContain("--token 'o2ft_abc123'");
    expect(cmd).toContain("--version '0.163.1'");
    expect(cmd).not.toContain("--transport");
  });

  it("uses the macOS script on macOS", () => {
    expect(installCommand("macos", target)).toContain("/agents/main/macos/install.sh");
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
      "irm https://raw.githubusercontent.com/openobserve/agents/main/windows/install.ps1",
    );
    expect(cmd).toContain("-Token 'o2ft_abc123'");
  });

  it("installs the Helm chart with the fleet collector image at the target version", () => {
    const cmd = installCommand("kubernetes", target);
    expect(cmd).toContain("helm upgrade --install");
    expect(cmd).toContain("--set image.repository=ghcr.io/openobserve/otel-fleet-collector");
    expect(cmd).toContain("--set image.tag='0.163.1'");
    expect(cmd).toContain("--set opamp.endpoint='wss://o2.example.com/api/acme/v1/opamp'");
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
