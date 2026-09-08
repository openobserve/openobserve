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

import type { EntityProvider } from "../usePaletteEntities";
import type { EntityProviderContext } from "./context";
import { createAlertsProvider } from "./alerts";
import { createDashboardsProvider } from "./dashboards";
import { createFunctionsProvider } from "./functions";
import { createPipelinesProvider } from "./pipelines";
import { createSavedViewsProvider } from "./savedViews";
import { createStreamsProvider } from "./streams";
import { createServiceAccountsProvider, createUsersProvider } from "./users";

/** Every entity source the palette can search, in scope-chip order. */
export function createEntityProviders(ctx: EntityProviderContext): EntityProvider[] {
  return [
    createDashboardsProvider(ctx),
    createAlertsProvider(ctx),
    createStreamsProvider(ctx),
    createSavedViewsProvider(ctx),
    createFunctionsProvider(ctx),
    createPipelinesProvider(ctx),
    createUsersProvider(ctx),
    createServiceAccountsProvider(ctx),
  ];
}
