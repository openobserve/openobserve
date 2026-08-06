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
// Validation schema for the "Create Token" dialog in SyntheticsTokens.vue. Name
// is required + max 256; "default" is reserved (the default token is replaced via
// Rotate, not created). No description field for synthetics tokens.

import { z } from "zod";

export const makeCreateTokenSchema = (
  t: (_key: string, _params?: Record<string, unknown>) => string,
) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("common.nameRequired"))
      .max(256, t("common.nameMaxLength", { max: 256 }))
      .refine((n) => n.toLowerCase() !== "default", {
        message: t("synthetics.tokens.nameReserved"),
      }),
  });

export type CreateTokenForm = z.infer<ReturnType<typeof makeCreateTokenSchema>>;

export const createTokenDefaults = (): CreateTokenForm => ({
  name: "",
});
