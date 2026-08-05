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
//
// Add/Edit Alert Source drawer. Destinations are optional — an empty list
// falls back to the org default (the list page flags that row).

import { z } from "zod";

export const makeAlertSourceSchema = (
  t: (_key: string, _params?: Record<string, unknown>) => string,
) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("common.nameRequired"))
      .max(256, t("common.nameMaxLength", { max: 256 })),
    destinations: z.array(z.string()).default([]),
  });

export type AlertSourceForm = z.infer<ReturnType<typeof makeAlertSourceSchema>>;

export const alertSourceDefaults = (
  integration?: { name: string; destinations: string[] } | undefined,
): AlertSourceForm => ({
  name: integration?.name ?? "",
  destinations: [...(integration?.destinations ?? [])],
});
