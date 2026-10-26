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

export type FleetOs = "linux" | "macos" | "windows" | "kubernetes";

export const OS_LABEL: Record<FleetOs, string> = {
  linux: "Linux",
  macos: "macOS",
  windows: "Windows",
  kubernetes: "Kubernetes",
};

const COUNT_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Version order; a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/i, "").split("-");
    return { nums: core.split(".").map(Number), pre: !!pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
  }
  return x.pre === y.pre ? 0 : x.pre ? -1 : 1;
}

/** Compact count with at most one decimal, e.g. 15.4K. */
export function formatCount(n: number): string {
  const text = COUNT_FORMAT.format(n);
  // A positive value that rounds to 0 must not read as a measured zero.
  return n > 0 && text === "0" ? "<0.1" : text;
}
