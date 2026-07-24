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

// Shared building blocks for data-source cards that ingest via the OpenTelemetry
// Collector (Contrib). The pieces that are identical across databases — installing
// the collector per-OS, and writing config.yaml via a copy-paste command per-shell
// — live here so every card stays consistent and we don't duplicate them per DB.
//
// Per-DB content (the prepare/grant SQL, the receiver config, run, verify) stays
// in each card's own file (e.g. sqlServer.ts, postgres.ts).

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardStep, RichCardStepVariant } from "../types";
import { applySubs, applySubsMasked } from "../subs";

/** Pinned collector release used by the install commands. Bump in one place. */
export const COLLECTOR_VERSION = "0.115.1";
const relUrl = (version: string) =>
  `https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${version}`;

const osIcons = () => ({
  linux: getImageURL("images/rum/linux.png"),
  mac: getImageURL("images/rum/mac.png"),
  windows: getImageURL("images/rum/windows.png"),
});

/** Icons shared by the per-DB "prepare" step's client tabs (terminal + docker). */
export const sharedToolIcons = () => ({
  terminal: getImageURL("images/rum/events/terminal.png"),
  docker: getImageURL("images/common/docker.svg"),
});

// Linux/macOS differ only by the release asset; Windows uses PowerShell.
const unixInstall = (asset: string, version: string) =>
  `curl --proto '=https' --tlsv1.2 -fOL ${relUrl(version)}/otelcol-contrib_${version}_${asset}.tar.gz
tar -xvf otelcol-contrib_${version}_${asset}.tar.gz
sudo mv otelcol-contrib /usr/local/bin/
otelcol-contrib --version`;
const winInstall = (version: string) =>
  `Invoke-WebRequest -Uri ${relUrl(version)}/otelcol-contrib_${version}_windows_amd64.tar.gz -OutFile otelcol-contrib.tar.gz
tar -xvf otelcol-contrib.tar.gz
.\\otelcol-contrib.exe --version`;
const MAC_QUARANTINE_NOTE =
  "If macOS blocks the unsigned binary, clear the quarantine flag: xattr -d com.apple.quarantine ./otelcol-contrib";

/**
 * The "Install OpenTelemetry Collector Contrib" step — identical across DBs: a
 * per-OS/arch toggle (Linux x86_64/ARM64, macOS Apple Silicon/Intel, Windows)
 * with the matching download command. The sqlserver/postgresql/etc. receivers
 * all ship only in the Contrib build.
 */
export function collectorInstallStep(version: string = COLLECTOR_VERSION): RichCardStep {
  const icon = osIcons();
  return {
    id: "install",
    title: "Install OpenTelemetry Collector Contrib",
    description: "The receiver is in the Contrib build only — pick your platform.",
    chip: { kind: "terminal", label: "Terminal" },
    completeOn: "copy",
    // The OS chosen here also drives the configure step (shared "os" group).
    variantGroup: "os",
    variants: [
      {
        id: "linux-amd64",
        label: "Linux (x86_64)",
        icon: icon.linux,
        code: { lang: "bash", raw: unixInstall("linux_amd64", version) },
      },
      {
        id: "linux-arm64",
        label: "Linux (ARM64)",
        icon: icon.linux,
        code: { lang: "bash", raw: unixInstall("linux_arm64", version) },
      },
      {
        id: "darwin-arm64",
        label: "macOS (Apple Silicon)",
        icon: icon.mac,
        iconInvertDark: true,
        code: { lang: "bash", raw: unixInstall("darwin_arm64", version) },
        note: MAC_QUARANTINE_NOTE,
      },
      {
        id: "darwin-amd64",
        label: "macOS (Intel)",
        icon: icon.mac,
        iconInvertDark: true,
        code: { lang: "bash", raw: unixInstall("darwin_amd64", version) },
        note: MAC_QUARANTINE_NOTE,
      },
      {
        id: "windows-amd64",
        label: "Windows (x86_64)",
        icon: icon.windows,
        code: { lang: "powershell", raw: winInstall(version) },
      },
    ],
  };
}

// A copy-paste command writes config.yaml in one shot (more reliable than
// hand-creating the file). Linux/macOS share a quoted heredoc; Windows uses a
// single-quoted PowerShell here-string — both literal, so tokens/quotes survive.
const bashWriteConfig = (yaml: string) => `cat > config.yaml <<'EOF'
${yaml}
EOF`;
const psWriteConfig = (yaml: string) => `@'
${yaml}
'@ | Set-Content -Path config.yaml`;

/**
 * "Write config.yaml" command variants, keyed to MATCH collectorInstallStep's OS
 * ids so the configure step can share the install step's "os" selection
 * (variantGroup) — the file-write command only differs by shell, so all unix
 * builds use the bash heredoc and Windows uses the PowerShell here-string.
 * `configYaml` may carry {url}/{org}/{token} (substituted here) and live `{...}`
 * input placeholders (left intact for the renderer to fill).
 */
export function writeConfigVariants(
  configYaml: string,
  subs: CardSubstitutions,
): RichCardStepVariant[] {
  const icon = osIcons();
  const bashCfg = {
    lang: "bash",
    raw: bashWriteConfig(applySubs(configYaml, subs)),
    masked: bashWriteConfig(applySubsMasked(configYaml, subs)),
  };
  const psCfg = {
    lang: "powershell",
    raw: psWriteConfig(applySubs(configYaml, subs)),
    masked: psWriteConfig(applySubsMasked(configYaml, subs)),
  };
  return [
    { id: "linux-amd64", label: "Linux (x86_64)", icon: icon.linux, code: bashCfg },
    { id: "linux-arm64", label: "Linux (ARM64)", icon: icon.linux, code: bashCfg },
    {
      id: "darwin-arm64",
      label: "macOS (Apple Silicon)",
      icon: icon.mac,
      iconInvertDark: true,
      code: bashCfg,
    },
    {
      id: "darwin-amd64",
      label: "macOS (Intel)",
      icon: icon.mac,
      iconInvertDark: true,
      code: bashCfg,
    },
    { id: "windows-amd64", label: "Windows (x86_64)", icon: icon.windows, code: psCfg },
  ];
}
