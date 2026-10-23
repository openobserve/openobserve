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

import { useWorkloadDetection } from "@/composables/useWorkloadDetection";
import { detectReadyMadeSources, type ReadyMadeSourceId } from "./catalog";

/** Ready-made detection over the same cached metrics stream list workload detection reads. */
export function useReadyMadeDetection() {
  const workloads = useWorkloadDetection();

  /** Detected sources in catalog order; null when the stream list could not be read. */
  const detect = async ({ force = false }: { force?: boolean } = {}): Promise<
    ReadyMadeSourceId[] | null
  > => {
    await workloads.refresh({ force });
    const names = workloads.metricNames.value;
    return names == null ? null : detectReadyMadeSources(names);
  };

  return { detect };
}
