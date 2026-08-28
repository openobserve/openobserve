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

import type { WireStep } from "@/types/synthetics";
import type { ResolvedVariable } from "./resolved";
import { placeholderNames } from "./placeholders";
import { effectiveVariables } from "./resolved";

/**
 * Shared secrets the steps about to replay actually reference.
 *
 * Replay substitutes in the browser, so any value it can use is a value the
 * page can read - which is the same property as "write-only", with the sign
 * flipped. A shared secret therefore has no value on the client, and the only
 * honest options are to prompt or to let it type as literal text.
 *
 * Only the names the steps reference are asked for. Prompting for every secret
 * in the environment would make replay a bulk credential-collection screen.
 */
export function secretsNeededForReplay(steps: WireStep[], resolved: ResolvedVariable[]): string[] {
  const secrets = new Set(
    effectiveVariables(resolved)
      .filter((v) => v.kind === "secret")
      .map((v) => v.name),
  );
  const needed = new Set<string>();
  for (const step of steps) {
    for (const field of [step.value, step.url, step.key, step.text, step.selector]) {
      for (const name of placeholderNames(field ?? "")) {
        if (secrets.has(name)) needed.add(name);
      }
    }
  }
  return [...needed].sort();
}

/**
 * Values the author supplied for this browser session.
 *
 * In memory, deliberately. `sessionStorage` would survive a reload and remain
 * readable by any script on the origin; other tools' "remember locally" is a
 * file on a developer's machine, ours would be a browser origin that XSS can
 * reach. A module-level map dies with the tab and never serialises.
 */
const sessionSecrets = new Map<string, string>();

export function rememberReplaySecret(name: string, value: string): void {
  sessionSecrets.set(name, value);
}

/** Which of `names` already have a value, and which still have to be asked for. */
export function partitionReplaySecrets(names: string[]): {
  known: Record<string, string>;
  missing: string[];
} {
  const known: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const value = sessionSecrets.get(name);
    if (value === undefined) missing.push(name);
    else known[name] = value;
  }
  return { known, missing };
}

/** Drops every remembered value. Called on sign-out and when the org changes. */
export function forgetReplaySecrets(): void {
  sessionSecrets.clear();
}

/**
 * Merges supplied secrets into the check's own variables for one replay.
 *
 * The check's own values win: they are what the check would actually run with,
 * and a supplied secret is only standing in for a value the client cannot see.
 * Anything still unsupplied is simply absent, so it types as literal text and
 * the failure names itself on the page.
 */
export function mergeReplayVariables(
  checkVariables: { name: string; value: string }[],
  supplied: Record<string, string>,
): { name: string; value: string }[] {
  const own = new Set(checkVariables.map((v) => v.name));
  const extra = Object.entries(supplied)
    .filter(([name]) => !own.has(name))
    .map(([name, value]) => ({ name, value }));
  return [...checkVariables, ...extra];
}
