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

/** Same grammar the server validates, and the same reserved prefix. */
export const VARIABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const RESERVED_VARIABLE_PREFIX = "_AUTH_";

export const makeSyntheticsVariableFormSchema = (
  t: (_key: string) => string,
  keepsStoredSecret: boolean,
) =>
  z
    .object({
      name: z
        .string()
        .trim()
        .min(1, t("synthetics.variables.nameRequired"))
        .max(128, t("synthetics.variables.nameTooLong"))
        .regex(VARIABLE_NAME_RE, t("synthetics.variables.nameInvalid")),
      kind: z.enum(["plain", "secret"]).default("plain"),
      value: z.string().optional().default(""),
      description: z.string().max(4096).optional().default(""),
      example: z.string().max(4096).optional().default(""),
    })
    .superRefine((val, ctx) => {
      if (val.name.toUpperCase().startsWith(RESERVED_VARIABLE_PREFIX)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["name"],
          message: t("synthetics.variables.nameReserved"),
        });
      }
      // Only a stored secret the author is not replacing may leave the value blank.
      if (!keepsStoredSecret && !val.value?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: t("synthetics.variables.valueRequired"),
        });
      }
    });

export type SyntheticsVariableForm = z.infer<ReturnType<typeof makeSyntheticsVariableFormSchema>>;

/** Environment names become OpenFGA object ids, so `_` is reserved for its wildcards. */
export const ENVIRONMENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const makeSyntheticsEnvironmentFormSchema = (t: (_key: string) => string) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("synthetics.environments.nameRequired"))
      .max(64, t("synthetics.environments.nameTooLong"))
      .regex(ENVIRONMENT_NAME_RE, t("synthetics.environments.nameInvalid")),
    description: z.string().max(4096).optional().default(""),
  });

export type SyntheticsEnvironmentForm = z.infer<
  ReturnType<typeof makeSyntheticsEnvironmentFormSchema>
>;
