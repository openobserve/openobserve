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

import { ref } from "vue";
import onlineEvalsService, {
  type EvalJob,
  type EvalJobHealth,
} from "@/services/online-evals.service";
import { statusOf } from "../utils/evalEntity";

/** The server's per-request cap. */
export const MAX_HEALTH_JOBS = 500;

/**
 * Read-time health for the listed jobs, in one request per list load. Drafts
 * never run, so they are not asked about. A failed request leaves the map
 * empty — the list renders "—" and is otherwise unaffected.
 */
export function useEvalJobHealth() {
  const healthById = ref<Record<string, EvalJobHealth>>({});
  // Only the newest request may write: a reload can overtake a slow one.
  let latestRequest = 0;

  async function loadHealth(orgId: string, jobs: EvalJob[]) {
    const request = ++latestRequest;
    const jobIds = jobs
      .filter((job) => statusOf(job) !== "draft")
      .map((job) => job.id)
      .slice(0, MAX_HEALTH_JOBS);
    if (!orgId || jobIds.length === 0) {
      healthById.value = {};
      return;
    }
    try {
      const items = await onlineEvalsService.jobs.health(orgId, jobIds);
      if (request !== latestRequest) return;
      healthById.value = Object.fromEntries(items.map((item) => [item.jobId, item]));
    } catch (err) {
      if (request !== latestRequest) return;
      console.warn("[EvalJobHealth] failed to load job health", err);
      healthById.value = {};
    }
  }

  return { healthById, loadHealth };
}
