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

export type TracesForm = { languages: string[] };

/** A library per language needs at least one language. */
export const makeTracesFormSchema = (t: TranslateFn) =>
  z.object({ languages: z.array(z.string()).min(1, t("onboarding.collect.languagesRequired")) });
