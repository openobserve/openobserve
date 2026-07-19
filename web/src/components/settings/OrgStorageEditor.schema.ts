// Copyright 2026 OpenObserve Inc.
//
// Provider-discriminated validation schema for OrgStorageEditor.vue. The storage
// provider is chosen from a custom card grid (not an <input>), so it is bridged
// into the form as `selectedProvider` and `superRefine` branches on it.
//
// Per-provider required credentials (all trimmed):
//   • AwsCredentials  → bucket_name, access_key, secret_key
//   • AzureCredentials→ storage_account, bucket_name, secret_key
//   • GcpCredentials  → bucket_name, access_key
//   • AwsRoleArn      → bucket_name, region, role_arn, external_id

import { z } from "zod";

export const makeOrgStorageEditorSchema = (t: (_key: string) => string) =>
  z
    .object({
      // Bridged discriminator (the provider card grid).
      selectedProvider: z.string().optional().default(""),
      // All credential fields are loose at the object level; the per-provider
      // requireds are enforced in superRefine below.
      server_url: z.string().optional().default(""),
      region: z.string().optional().default(""),
      bucket_name: z.string().optional().default(""),
      access_key: z.string().optional().default(""),
      storage_account: z.string().optional().default(""),
      secret_key: z.string().optional().default(""),
      role_arn: z.string().optional().default(""),
      external_id: z.string().optional().default(""),
    })
    .superRefine((val, ctx) => {
      const require = (field: keyof typeof val, msgKey: string) => {
        if (!String(val[field] ?? "").trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: t(msgKey),
          });
        }
      };

      switch (val.selectedProvider) {
        case "AwsCredentials":
          require("bucket_name", "storage_settings.bucketNameRequired");
          require("access_key", "storage_settings.accessKeyRequired");
          require("secret_key", "storage_settings.secretKeyRequired");
          break;
        case "AzureCredentials":
          require("storage_account", "storage_settings.storageAccountRequired");
          require("bucket_name", "storage_settings.bucketNameRequired");
          require("secret_key", "storage_settings.secretKeyRequired");
          break;
        case "GcpCredentials":
          require("bucket_name", "storage_settings.bucketNameRequired");
          require("access_key", "storage_settings.accessKeyRequired");
          break;
        case "AwsRoleArn":
          require("bucket_name", "storage_settings.bucketNameRequired");
          require("region", "storage_settings.regionRequired");
          require("role_arn", "storage_settings.roleARNRequired");
          require("external_id", "storage_settings.externalIdRequired");
          break;
      }
    });

export type OrgStorageEditorForm = z.infer<
  ReturnType<typeof makeOrgStorageEditorSchema>
>;
