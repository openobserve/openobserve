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

import type { useI18nTyped } from "@/types/i18n";

type Translate = ReturnType<typeof useI18nTyped>["t"];

export interface TurnOnNeeds {
  critical: () => boolean;
  warning: () => boolean;
}

export const turnOnDefaults = () => ({ critical: "", warning: "" });

export const makeTurnOnSchema = (t: Translate, needs: TurnOnNeeds) =>
  z.object({ critical: z.string(), warning: z.string() }).superRefine((values, context) => {
    if (needs.critical() && !values.critical) {
      context.addIssue({
        code: "custom",
        path: ["critical"],
        message: t("starterPacks.turnOn.criticalRequired"),
      });
    }
    if (needs.warning() && !values.warning) {
      context.addIssue({
        code: "custom",
        path: ["warning"],
        message: t("starterPacks.turnOn.warningRequired"),
      });
    }
  });
