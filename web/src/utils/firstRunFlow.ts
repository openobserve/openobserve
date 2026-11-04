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

/** The `/config` switches (ZO_ONBOARDING_FLOW_ENABLED, ZO_SAMPLE_DATA_ONBOARDING_ENABLED) that pick the first-run flow. */
interface FirstRunConfig {
  onboarding_flow_enabled?: boolean;
  sample_data_onboarding_enabled?: boolean;
}

/** The welcome dialog with one-click sample data: off unless the deployment turns it on. */
export const sampleDataFlowOn = (cfg?: FirstRunConfig): boolean =>
  cfg?.sample_data_onboarding_enabled === true;

/** The full-page onboarding: on unless turned off or replaced by sample data; a backend without the switch counts as on. */
export const onboardingFlowOn = (cfg?: FirstRunConfig): boolean =>
  !sampleDataFlowOn(cfg) && cfg?.onboarding_flow_enabled !== false;
