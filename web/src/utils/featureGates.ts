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

/**
 * Feature gates — one place to answer "is feature X available in this app".
 *
 * A gate combines the two things that decide availability:
 *   1. BUILD    — enterprise / cloud (some features never ship in OSS)
 *   2. RUNTIME  — a boolean flag on the backend `/config` response
 *
 * ── Why a gate exposes TWO predicates ──────────────────────────────────────
 *
 * `isEnabled()` and `isDisabled()` are deliberately NOT negations of each
 * other, and that is the whole reason this module exists.
 *
 * `main.ts` calls `getConfig()` WITHOUT awaiting it, so there is a window at
 * startup where `store.state.zoConfig` is still `{}` and every flag reads
 * `undefined`. The correct answer during that window differs by caller:
 *
 *   • A nav entry / picker should stay HIDDEN until the flag is known true —
 *     otherwise it flashes in and disappears when the config lands.
 *   • A route guard must NOT redirect until the flag is known false —
 *     otherwise a bookmarked deep link bounces to home on a cold load.
 *
 * So: unknown → `isEnabled() === false` AND `isDisabled() === false`.
 *
 * This split already exists in the codebase for `synthetics_enabled`
 * (truthy check in the menu, `=== false` in the route guard) but is
 * undocumented there, which makes it look like an inconsistency somebody
 * should "clean up". Unifying them silently breaks one case or the other.
 * Encoding it once is what stops that.
 *
 * ── Adding a feature ───────────────────────────────────────────────────────
 *
 *   export const featureGates = {
 *     workflows: createFeatureGate("workflows_enabled"),
 *     myThing:   createFeatureGate("my_thing_enabled"),
 *   };
 *
 * Then in a component:   featureGates.myThing.isEnabled()
 * ...and in a guard:     featureGates.myThing.isDisabled()
 *
 * In a `computed()` this stays reactive: the Vuex state is a reactive proxy,
 * so reading it inside the computed registers the dependency as normal.
 */

import config from "@/aws-exports";
import store from "@/stores";

export interface FeatureGate {
  /**
   * True only when we positively KNOW the feature is on.
   * Use for anything rendered: nav entries, buttons, pickers, tabs.
   */
  isEnabled(): boolean;
  /**
   * True only when we positively KNOW the feature is off.
   * Use for route guards — see the note above on why this is not `!isEnabled()`.
   */
  isDisabled(): boolean;
}

export interface FeatureGateOptions {
  /**
   * Require an enterprise/cloud build. Default true — most gated features are
   * enterprise-only. Set false for a feature that also ships in OSS and is
   * controlled purely by the backend flag.
   */
  requiresEnterprise?: boolean;
}

const isEnterpriseBuild = (): boolean =>
  config.isEnterprise === "true" || config.isCloud === "true";

/**
 * Build a gate for a backend `/config` boolean flag.
 *
 * @param flag  key on the `/config` response, e.g. "workflows_enabled".
 *              Pass `null` for a BUILD-ONLY feature (no runtime flag): the
 *              gate then reduces to the enterprise/cloud check and has no
 *              unknown state.
 */
export const createFeatureGate = (
  flag: string | null,
  { requiresEnterprise = true }: FeatureGateOptions = {},
): FeatureGate => {
  const buildOk = () => !requiresEnterprise || isEnterpriseBuild();
  // Read through on every call — never cache. `/config` can land after the
  // consumer was created, and the org switcher can swap the whole response.
  const flagValue = () =>
    flag === null ? true : (store.state.zoConfig as any)?.[flag];

  return {
    // `=== true` on purpose: a missing key (older backend, or config in
    // flight) must not read as enabled, and a truthy string like "true" from a
    // mis-typed backend field should not silently pass either.
    isEnabled: () => buildOk() && flagValue() === true,
    isDisabled: () => !buildOk() || flagValue() === false,
  };
};

/**
 * The gates in use. Add new features here rather than hand-rolling the
 * expression at each call site — the point is that the nav entry, the route
 * guard and any in-page affordance all read the SAME rule.
 */
export const featureGates = {
  workflows: createFeatureGate("workflows_enabled"),
} as const;

// Convenience wrappers for the workflows gate — the three surfaces that use it
// (sidebar entry, routes, the alert destination/workflow picker) read better
// with a named import than with `featureGates.workflows.isEnabled()`.
export const isWorkflowsEnabled = (): boolean =>
  featureGates.workflows.isEnabled();
export const isWorkflowsDisabled = (): boolean =>
  featureGates.workflows.isDisabled();
