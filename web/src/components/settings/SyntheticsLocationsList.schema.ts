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
// Validation schema for SyntheticsLocationForm.vue. `provider`, `region`, and
// `label` are required. When provider is "custom", `customProvider` becomes
// required. `enabled` defaults to true. Built via a factory so the required
// messages stay i18n-driven (pass useI18n's `t`).

import { z } from "zod";

export const makeSyntheticsLocationFormSchema = (t: (_key: string) => string) =>
  z
    .object({
      provider: z.enum(["aws", "gcp", "azure", "custom"], {
        message: t("synthetics.locations.providerRequired"),
      }),
      customProvider: z.string().optional().default(""),
      region: z.string().trim().min(1, t("synthetics.locations.regionRequired")),
      label: z.string().trim().min(1, t("synthetics.locations.labelRequired")),
      enabled: z.boolean().default(true),
    })
    .superRefine((val, ctx) => {
      if (val.provider === "custom" && !val.customProvider?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customProvider"],
          message: t("synthetics.locations.customProviderRequired"),
        });
      }
    });

export type SyntheticsLocationForm = z.infer<ReturnType<typeof makeSyntheticsLocationFormSchema>>;
