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

import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";
import type { StaleChildPolicy } from "@/ts/interfaces/alert";

const STALE_POLICY_COPY: Record<StaleChildPolicy, { label: I18nKey; help: I18nKey }> = {
  use_last_state: {
    label: "alerts.composite.useLastState",
    help: "alerts.form.composite.staleHelp.useLastState",
  },
  treat_as_false: {
    label: "alerts.composite.treatStaleFalse",
    help: "alerts.form.composite.staleHelp.treatAsFalse",
  },
  treat_as_true: {
    label: "alerts.composite.treatStaleTrue",
    help: "alerts.form.composite.staleHelp.treatAsTrue",
  },
};

const copyOf = (policy: unknown) =>
  STALE_POLICY_COPY[policy as StaleChildPolicy] ?? STALE_POLICY_COPY.use_last_state;

export const stalePolicyLabel = (policy: unknown, t: TranslateFn): I18nText =>
  t(copyOf(policy).label);

/** What the picked option does once a picked alert misses its checks. */
export const stalePolicyHelpText = (policy: unknown, t: TranslateFn): I18nText =>
  t(copyOf(policy).help);

export const stalePolicyOptions = (t: TranslateFn) =>
  (Object.keys(STALE_POLICY_COPY) as StaleChildPolicy[]).map((value) => ({
    label: stalePolicyLabel(value, t),
    value,
  }));
