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

import type { FleetOs } from "./fleetFormat";

/** Platforms the o2c-supervisor runs on today; the rest have no install path yet. */
export type SupervisedOs = Extract<FleetOs, "linux" | "macos">;

export interface InstallTarget {
  baseUrl: string;
  org: string;
  token: string;
}

interface SupervisorLayout {
  prepare: string;
  /** Config lines the generator can write literally inside the quoted heredoc. */
  literal: string[];
  /** Shell lines run after the heredoc, for values only the user's shell knows. */
  append: string[];
  install: string;
  run: (auth: string) => string;
}

// Quoted heredocs keep url, org and token literal; install -m 600 sets the mode even when the file exists.
const LAYOUT: Record<SupervisedOs, SupervisorLayout> = {
  linux: {
    prepare: "sudo mkdir -p /etc/o2c-supervisor",
    literal: [
      "collector:",
      "  executable: /usr/local/bin/otelcol-contrib",
      "  config: /etc/o2c-supervisor/collector.yaml",
      "storage:",
      "  directory: /var/lib/o2c-supervisor",
    ],
    append: [],
    install: 'sudo install -m 600 "$tmp" /etc/o2c-supervisor/supervisor.yaml && rm -f "$tmp"',
    run: (auth) =>
      `sudo env O2_AUTH=${auth} o2c-supervisor -config /etc/o2c-supervisor/supervisor.yaml`,
  },
  // The supervisor expands neither ~ nor $HOME, so the shell resolves HOME outside the quoted heredoc.
  macos: {
    prepare: 'mkdir -p "$HOME/o2c-supervisor"',
    literal: ["collector:", "  executable: /usr/local/bin/otelcol-contrib"],
    append: [
      `printf '  config: %s\\nstorage:\\n  directory: %s\\n' "$HOME/o2c-supervisor/collector.yaml" "$HOME/o2c-supervisor/state" >> "$tmp"`,
    ],
    install: 'install -m 600 "$tmp" "$HOME/o2c-supervisor/supervisor.yaml" && rm -f "$tmp"',
    run: (auth) => `O2_AUTH=${auth} o2c-supervisor -config "$HOME/o2c-supervisor/supervisor.yaml"`,
  },
};

export function isSupervisedOs(os: FleetOs): os is SupervisedOs {
  return Object.hasOwn(LAYOUT, os);
}

/** Shell lines that write the supervisor config as 0600 and start the supervisor with its exporter credential. */
export function installScript(os: SupervisedOs, target: InstallTarget): string {
  const layout = LAYOUT[os];
  // Set on the command alone, so the credential never lands in the user's shell environment.
  const auth = `"Basic $(printf '%s' 'fleet:${target.token}' | base64)"`;
  return [
    layout.prepare,
    'tmp="$(mktemp)"',
    `cat > "$tmp" <<'EOF'`,
    "server:",
    `  url: ${target.baseUrl}`,
    `  org: ${target.org}`,
    "auth:",
    "  email: fleet",
    `  token: ${target.token}`,
    ...layout.literal,
    "EOF",
    ...layout.append,
    layout.install,
    layout.run(auth),
  ].join("\n");
}

/** Absolute base URL for `server.url`; a relative endpoint means the app's own origin. */
export function resolveBaseUrl(endpoint: string, origin: string): string {
  let url: URL;
  try {
    url = new URL(endpoint || "/", origin);
  } catch {
    url = new URL(origin);
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}
