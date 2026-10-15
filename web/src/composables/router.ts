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

import useIngestionRoutes from "./shared/useIngestionRoutes";
import {
  useAIObservabilityShellRoute,
  useAIObservabilityExtraRoutes,
} from "./shared/useAIObservabilityRoutes";

const useOSRoutes = () => {
  const parentRoutes: any = [];

  // LLM Insights + Sessions are the only AI Observability sections OSS
  // actually serves from its own backend; every other section's route is
  // still registered (not just hidden in the rail) so the locked-but-visible
  // nav items in AIObservabilityShell (Index.vue) resolve to something —
  // `withFeatureGate`, applied inside `useAIObservabilityShellRoute`, redirects
  // to the shared `enterpriseFeatureLocked` page since a true OSS build never
  // satisfies `isEnterprise`/`isCloud`. This is the SAME route table the
  // enterprise/cloud router registers (see enterprise/composables/router.ts) —
  // one definition, not two hand-duplicated copies.
  const homeChildRoutes: any[] = [
    ...useIngestionRoutes(),
    useAIObservabilityShellRoute(),
    ...useAIObservabilityExtraRoutes(),
  ];

  return { parentRoutes, homeChildRoutes };
};

export default useOSRoutes;
