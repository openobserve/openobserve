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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import template from "./alert_templates";
import { templateKeys } from "./alert_templates.querykeys";
import { CONFIG_STALE_TIME, LONG_GC_TIME } from "@/composables/query/cachePolicy";
import { localStoragePersister } from "@/composables/query/persisters";

export const templatesQuery = (org: string) =>
  queryOptions({
    queryKey: templateKeys.list(org),
    queryFn: async (): Promise<any[]> =>
      (await template.list({ org_identifier: org })).data ?? [],
    staleTime: CONFIG_STALE_TIME,
    gcTime: LONG_GC_TIME,
    persister: localStoragePersister,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

export const saveTemplateMutation = (org: string, isUpdate: () => boolean) =>
  mutationOptions({
    mutationFn: (vars: { template_name: string; data: any }) =>
      isUpdate()
        ? template.update({ org_identifier: org, ...vars })
        : template.create({ org_identifier: org, ...vars }),
    // The form composes its own success/error toasts.
    meta: { invalidates: [templateKeys.all(org)], silentError: true },
  });
