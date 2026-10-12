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

import type { I18nKey } from "@/types/i18n";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { ProblemOutcome } from "./fixtures";

// One look per outcome, shared by the problem list and the problem drawer.
export const OUTCOME: Record<ProblemOutcome, { marker: string; tag: BadgeVariant; key: I18nKey }> =
  {
    active: {
      marker: "bg-status-error-text",
      tag: "error-soft",
      key: "autoobserve2.outcome.active",
    },
    fixing: { marker: "bg-accent", tag: "primary-soft", key: "autoobserve2.outcome.fixing" },
    fixed: { marker: "bg-accent", tag: "primary-soft", key: "autoobserve2.outcome.fixed" },
    contained: {
      marker: "bg-status-info-text",
      tag: "blue-soft",
      key: "autoobserve2.outcome.contained",
    },
    resolved: {
      marker: "bg-status-positive",
      tag: "success-soft",
      key: "autoobserve2.outcome.resolved",
    },
    held: { marker: "bg-border-strong", tag: "default-soft", key: "autoobserve2.outcome.held" },
    predicted: {
      marker: "bg-status-warning-text",
      tag: "warning-soft",
      key: "autoobserve2.outcome.predicted",
    },
  };
