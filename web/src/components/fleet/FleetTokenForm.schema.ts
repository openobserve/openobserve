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

import { z } from "zod";
import type { TranslateFn } from "@/types/i18n";

export const EXPIRY_CHOICES = ["7", "30", "90", "never"] as const;

// A number input emits a string, so the raw value is validated and coerced when the payload is built.
const isLimit = (v: unknown) =>
  v === "" || v == null || (Number.isInteger(Number(v)) && Number(v) > 0);

export const makeTokenSchema = (t: TranslateFn) =>
  z.object({
    name: z.string().trim().min(1, t("fleet.enrollment.nameRequired")),
    expiry: z.enum(EXPIRY_CHOICES),
    maxUses: z.any().refine(isLimit, t("fleet.enrollment.maxUsesInvalid")),
  });

export type TokenForm = z.infer<ReturnType<typeof makeTokenSchema>>;

export const tokenDefaults = (): TokenForm => ({ name: "", expiry: "90", maxUses: "100" });
