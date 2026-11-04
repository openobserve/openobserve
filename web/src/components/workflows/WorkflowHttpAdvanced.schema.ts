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

/** 1 MiB is the server's hard cap (spike S2), so the field may only lower it. */
export const MAX_BODY_KIB = 1024;

const wholeNumberIn = (max: number, message: string) =>
  z.coerce.number({ message }).int(message).min(1, message).max(max, message);

/** The trigger's own limits; `orgBudget` is the org's per-minute budget, which the server also clamps to. */
export const makeHttpLimitsSchema = (t: TranslateFn, orgBudget: number) =>
  z.object({
    maxBodyKib: wholeNumberIn(MAX_BODY_KIB, t("workflow.http.maxBodyRange")),
    rateLimit: wholeNumberIn(orgBudget, t("workflow.http.rateLimitRange", { org: orgBudget })),
  });

export type HttpLimitsForm = z.infer<ReturnType<typeof makeHttpLimitsSchema>>;

export const httpLimitsDefaults = (maxBodyBytes: number, rateLimit: number): HttpLimitsForm => ({
  maxBodyKib: Math.round(maxBodyBytes / 1024),
  rateLimit,
});
