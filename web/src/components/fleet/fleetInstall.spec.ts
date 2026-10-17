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
import { installScript, resolveBaseUrl } from "./fleetInstall";

const target = { baseUrl: "https://o2.example.com", org: "acme", token: "o2ft_abc123" };

describe("installScript", () => {
  const AUTH = `"Basic $(printf '%s' 'fleet:o2ft_abc123' | base64)"`;

  it("writes the Linux config through a temp file and installs it as 0600", () => {
    const lines = installScript("linux", target).split("\n");
    expect(lines.slice(0, 3)).toEqual([
      "sudo mkdir -p /etc/o2c-supervisor",
      'tmp="$(mktemp)"',
      `cat > "$tmp" <<'EOF'`,
    ]);
    const end = lines.indexOf("EOF");
    expect(lines.slice(end + 1, end + 2)).toEqual([
      'sudo install -m 600 "$tmp" /etc/o2c-supervisor/supervisor.yaml && rm -f "$tmp"',
    ]);
  });

  it("puts the org, token and Linux system paths in the config", () => {
    const script = installScript("linux", target);
    expect(script).toContain("  url: https://o2.example.com\n  org: acme");
    expect(script).toContain("auth:\n  email: fleet\n  token: o2ft_abc123");
    expect(script).toContain("  executable: /usr/local/bin/otelcol-contrib");
    expect(script).toContain("  config: /etc/o2c-supervisor/collector.yaml");
    expect(script).toContain("  directory: /var/lib/o2c-supervisor");
  });

  it("runs the Linux supervisor as root with O2_AUTH scoped to that one command", () => {
    const lines = installScript("linux", target).split("\n");
    expect(lines[lines.length - 1]).toBe(
      `sudo env O2_AUTH=${AUTH} o2c-supervisor -config /etc/o2c-supervisor/supervisor.yaml`,
    );
  });

  it("writes the macOS config under HOME, installed as 0600, with HOME expanded outside the heredoc", () => {
    const script = installScript("macos", target);
    const lines = script.split("\n");
    expect(lines.slice(0, 3)).toEqual([
      'mkdir -p "$HOME/o2c-supervisor"',
      'tmp="$(mktemp)"',
      `cat > "$tmp" <<'EOF'`,
    ]);
    expect(script).toContain("  executable: /usr/local/bin/otelcol-contrib");
    expect(lines).toContain(
      `printf '  config: %s\\nstorage:\\n  directory: %s\\n' "$HOME/o2c-supervisor/collector.yaml" "$HOME/o2c-supervisor/state" >> "$tmp"`,
    );
    expect(lines).toContain(
      'install -m 600 "$tmp" "$HOME/o2c-supervisor/supervisor.yaml" && rm -f "$tmp"',
    );
    expect(lines[lines.length - 1]).toBe(
      `O2_AUTH=${AUTH} o2c-supervisor -config "$HOME/o2c-supervisor/supervisor.yaml"`,
    );
    expect(script).not.toContain("~");
    expect(script).not.toContain("sudo");
  });

  it.each(["linux", "macos"] as const)("never exports O2_AUTH into the user's shell (%s)", (os) => {
    expect(installScript(os, target)).not.toMatch(/export /);
  });

  it.each(["linux", "macos"] as const)(
    "quotes every heredoc so $ in data stays literal (%s)",
    (os) => {
      const script = installScript(os, { ...target, baseUrl: "https://h/$x", org: "a$b" });
      expect(script).not.toMatch(/<<EOF/);
      expect(script).toContain("  url: https://h/$x");
      expect(script).toContain("  org: a$b");
    },
  );

  it.each(["linux", "macos"] as const)(
    "never relies on a umask or on tee keeping a file mode (%s)",
    (os) => {
      const script = installScript(os, target);
      expect(script).not.toContain("umask");
      expect(script).not.toContain("tee ");
      expect(script).not.toMatch(/install -m 600 \/dev\/stdin/);
    },
  );

  const heredoc = (script: string) => {
    const lines = script.split("\n");
    return lines.slice(lines.indexOf(`cat > "$tmp" <<'EOF'`) + 1, lines.indexOf("EOF"));
  };

  it.each(["linux", "macos"] as const)(
    "never asks for an initial configuration, since the token's fleet decides it (%s)",
    (os) => {
      const body = heredoc(installScript(os, target));
      expect(body).not.toContain("fleet:");
      expect(body.join("\n")).not.toContain("initial_config");
    },
  );

  it("carries a placeholder token through unchanged", () => {
    const script = installScript("linux", { ...target, token: "<TOKEN>" });
    expect(script).toContain("  token: <TOKEN>");
    expect(script).toContain("'fleet:<TOKEN>'");
  });

  it("never mentions a downloader, endpoint or chart that does not exist", () => {
    for (const os of ["linux", "macos"] as const) {
      const script = installScript(os, target);
      for (const fake of [
        "curl",
        "brew install",
        "/opt/homebrew",
        "helm",
        "enrollment-token",
        "opamp-endpoint",
        "wss://",
      ]) {
        expect(script).not.toContain(fake);
      }
    }
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
