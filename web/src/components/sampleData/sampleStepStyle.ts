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

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { SampleStepStatus } from "@/composables/sampleData/useSampleDataSession";

export const stepIcon = (s: SampleStepStatus): IconName => {
  if (s === "done") return "check-circle";
  if (s === "failed") return "error";
  if (s === "running") return "progress-activity";
  return "radio-button-unchecked";
};
export const stepIconClass = (s: SampleStepStatus) => {
  if (s === "done") return "text-status-success-text";
  if (s === "failed") return "text-status-error-text";
  if (s === "running") return "text-accent animate-spin";
  return "text-text-muted";
};
export const chipClass = (s: SampleStepStatus) => {
  if (s === "running") return "border-accent/40 bg-accent/5 text-text-body";
  if (s === "pending") return "border-border-default text-text-secondary";
  return "border-border-default text-text-body";
};
