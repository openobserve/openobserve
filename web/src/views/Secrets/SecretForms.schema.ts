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
import {
  CONSUMER_TYPES,
  type ConsumerType,
  type CreateSecretRequest,
  type SecretKind,
  type SecretPointer,
} from "@/services/secrets";

/** Store names are case-sensitive identifiers used as `{{secrets.NAME}}`. */
export const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Where a value lives: typed here (local) or read from a connected backend (external). */
const sourceFields = {
  value: z.string(),
  source: z.enum(["local", "external"]),
  backend_id: z.string(),
  locator: z.string().trim(),
  version: z.enum(["latest", "stage", "id"]),
  version_ref: z.string().trim(),
  json_key: z.string().trim(),
};
type SourceForm = z.infer<z.ZodObject<typeof sourceFields>>;

const sourceDefaults = (): SourceForm => ({
  value: "",
  source: "local",
  backend_id: "",
  locator: "",
  version: "latest",
  version_ref: "",
  json_key: "",
});

const refineSource = (t: TranslateFn, v: SourceForm, ctx: z.RefinementCtx) => {
  const need = (path: keyof SourceForm, ok: boolean, key: Parameters<TranslateFn>[0]) => {
    if (!ok) ctx.addIssue({ code: "custom", path: [path], message: t(key) });
  };
  if (v.source === "local") {
    need("value", v.value.length > 0, "secrets.values.valueRequired");
    return;
  }
  need("backend_id", !!v.backend_id, "secrets.external.backendRequired");
  need("locator", !!v.locator, "secrets.external.locatorRequired");
  need(
    "version_ref",
    v.version === "latest" || !!v.version_ref,
    "secrets.external.versionRequired",
  );
};

export const makeSecretValueSchema = (t: TranslateFn) =>
  z.object(sourceFields).superRefine((v, ctx) => refineSource(t, v, ctx));
export type SecretValueForm = z.infer<ReturnType<typeof makeSecretValueSchema>>;

export const valueDefaults = (): SecretValueForm => sourceDefaults();

/** The server's `Pointer`; an empty JSON key means the whole value. */
export const buildPointer = (v: SourceForm): SecretPointer => {
  const pointer: SecretPointer = {
    backend_id: v.backend_id,
    locator: v.locator.trim(),
    version_selector:
      v.version === "latest"
        ? "latest"
        : v.version === "stage"
          ? { stage: v.version_ref.trim() }
          : { id: v.version_ref.trim() },
  };
  if (v.json_key.trim()) pointer.json_key = v.json_key.trim();
  return pointer;
};

export const makeRenameSchema = (t: TranslateFn, current: string) =>
  z.object({
    new_name: z
      .string()
      .trim()
      .regex(SECRET_NAME_PATTERN, t("secrets.create.nameInvalid"))
      .refine((v) => v !== current, t("secrets.lifecycle.renameSame")),
  });
export type RenameForm = z.infer<ReturnType<typeof makeRenameSchema>>;

export const makePurgeSchema = (t: TranslateFn, name: string) =>
  z.object({
    confirm: z.string().refine((v) => v === name, t("secrets.lifecycle.purgeTypeName")),
  });
export type PurgeForm = z.infer<ReturnType<typeof makePurgeSchema>>;

export const makeDeleteSchema = (t: TranslateFn, inUse: boolean) =>
  z.object({
    force: z.boolean().refine((v) => !inUse || v, t("secrets.lifecycle.deleteForceRequired")),
  });
export type DeleteForm = z.infer<ReturnType<typeof makeDeleteSchema>>;

export const makeCreateSchema = (t: TranslateFn, kind: SecretKind) =>
  z
    .object({
      ...sourceFields,
      name: z.string().trim().regex(SECRET_NAME_PATTERN, t("secrets.create.nameInvalid")),
      description: z.string(),
      types: z.array(z.enum(CONSUMER_TYPES as [ConsumerType, ...ConsumerType[]])),
      use_roles: z.array(z.string()),
      manage_roles: z.array(z.string()),
      hosts: z.array(z.string()),
    })
    .superRefine((v, ctx) => {
      refineSource(t, kind === "variable" ? { ...v, source: "local" } : v, ctx);
      if (v.types.length === 0) {
        ctx.addIssue({ code: "custom", path: ["types"], message: t("secrets.policy.pickOneType") });
      }
      if (kind === "secret" && v.hosts.some((h) => h.trim() === "*" || /\s/.test(h.trim()))) {
        ctx.addIssue({ code: "custom", path: ["hosts"], message: t("secrets.policy.hostInvalid") });
      }
    });
export type CreateSecretForm = z.infer<ReturnType<typeof makeCreateSchema>>;

export const createDefaults = (kind: SecretKind): CreateSecretForm => ({
  ...sourceDefaults(),
  name: "",
  description: "",
  types: kind === "variable" ? [...CONSUMER_TYPES] : ["alert_destination"],
  use_roles: [],
  manage_roles: [],
  hosts: [],
});

/** Builds the create body with explicit keys; grants go only when FGA can hold them. */
export const buildCreateRequest = (
  kind: SecretKind,
  v: CreateSecretForm,
  fgaOn: boolean,
): CreateSecretRequest => {
  const body: CreateSecretRequest = {
    name: v.name.trim(),
    kind,
    description: v.description.trim(),
    allowed_consumers: v.types.map((type) => ({ type })),
  };
  if (kind === "secret" && v.source === "external") body.source = buildPointer(v);
  else body.value = v.value;
  const hosts = v.hosts.map((h) => h.trim()).filter(Boolean);
  if (kind === "secret" && hosts.length) body.allowed_hosts = hosts;
  if (fgaOn && (v.use_roles.length || v.manage_roles.length)) {
    body.grants = { use: [...v.use_roles], manage: [...v.manage_roles] };
  }
  return body;
};
