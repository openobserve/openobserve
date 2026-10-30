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

export const makeCreateStatusPageSchema = (t: (k: string) => string) =>
  z.object({
    name: z.string().trim().min(1, t("statusPages.validation.nameRequired")),
    description: z.string().optional().default(""),
  });

export type CreateStatusPageForm = z.infer<ReturnType<typeof makeCreateStatusPageSchema>>;

export const createStatusPageDefaults = (): CreateStatusPageForm => ({
  name: "",
  description: "",
});
