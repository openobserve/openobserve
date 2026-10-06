// Copyright 2026 OpenObserve Inc.

import { z } from "zod";
import type { TranslateFn } from "@/types/i18n";
import type { RemoteTaskAuthType, RemoteTaskSecretMaterial } from "@/services/remote-tasks.service";

export interface RemoteTaskCredentialsValues {
  token: string;
  username: string;
  password: string;
}

const filled = (message: string) =>
  z.string().refine((value) => value.trim().length > 0, { message });

/** Only the fields the task's auth type stores are required. */
export const makeRemoteTaskCredentialsSchema = (t: TranslateFn, authType: RemoteTaskAuthType) =>
  authType === "basic"
    ? z.object({
        token: z.string(),
        username: filled(t("aiObservability.remoteTasks.form.validation.usernameRequired")),
        password: filled(t("aiObservability.remoteTasks.form.validation.passwordRequired")),
      })
    : z.object({
        token: filled(t("aiObservability.remoteTasks.form.validation.tokenRequired")),
        username: z.string(),
        password: z.string(),
      });

/** Bearer and API-key auth both store a token; the header name lives on the version. */
export function toSecretMaterial(
  authType: RemoteTaskAuthType,
  values: RemoteTaskCredentialsValues,
): RemoteTaskSecretMaterial {
  return authType === "basic"
    ? { type: "basic", username: values.username, password: values.password }
    : { type: "token", value: values.token };
}
