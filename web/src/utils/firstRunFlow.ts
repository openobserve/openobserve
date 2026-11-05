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

import config from "@/aws-exports";
import { isFullConfigLoaded } from "@/services/config.queries";

/** The `/config` switches (ZO_ONBOARDING_FLOW_ENABLED, ZO_SAMPLE_DATA_ONBOARDING_ENABLED) that pick the first-run flow. */
type FirstRunConfig = {
  version?: string;
  onboarding_flow_enabled?: boolean;
  sample_data_onboarding_enabled?: boolean;
};

/** The switches come only with the full config (the bootstrap subset lacks them), so until it loads no flow is on. */
export const flowsKnown = (cfg?: FirstRunConfig): boolean => isFullConfigLoaded(cfg);

/** The full-page onboarding exists on cloud only; it wins when on, and a backend without the switch counts as on. */
export const onboardingFlowOn = (cfg?: FirstRunConfig): boolean =>
  flowsKnown(cfg) && config.isCloud === "true" && cfg?.onboarding_flow_enabled !== false;

/** The sample-data welcome shows whenever the full-page onboarding does not; a backend without the switch counts as on. */
export const sampleDataFlowOn = (cfg?: FirstRunConfig): boolean =>
  flowsKnown(cfg) && cfg?.sample_data_onboarding_enabled !== false && !onboardingFlowOn(cfg);
