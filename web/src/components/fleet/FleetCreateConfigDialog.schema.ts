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

const CONFIG_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
// `new` is the editor's new-config route and `validate` a static API path.
const RESERVED_IDS = ["new", "validate"];

export const makeConfigSchema = (t: TranslateFn) =>
  z.object({
    id: z
      .string()
      .regex(CONFIG_ID, t("fleet.configs.idInvalid"))
      .refine((v) => !RESERVED_IDS.includes(v), t("fleet.configs.idReserved")),
    description: z.string().max(1024, t("fleet.configs.descriptionTooLong")),
  });

export type ConfigForm = z.infer<ReturnType<typeof makeConfigSchema>>;
