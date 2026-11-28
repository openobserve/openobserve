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
  type AllowedConsumer,
  type ConsumerType,
  type PolicyRequest,
  type SecretDetail,
  type SecretKind,
} from "@/services/secrets";

const consumerSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["all", "selected"]),
  ids: z.array(z.string()),
});

export const makeSecretPolicySchema = (t: TranslateFn, kind: SecretKind) =>
  z
    .object({
      consumers: z.object({
        alert_destination: consumerSchema,
        pipeline_destination: consumerSchema,
        synthetics_check: consumerSchema,
        ai_toolset: consumerSchema,
      }),
      pin_mode: z.enum(["hosts", "any"]),
      hosts: z.array(z.string()),
      pin_override_reason: z.string(),
      private_locations: z.boolean(),
      private_locations_reason: z.string(),
    })
    .superRefine((v, ctx) => {
      if (!CONSUMER_TYPES.some((type) => v.consumers[type].enabled)) {
        ctx.addIssue({
          code: "custom",
          path: ["consumers", "alert_destination", "enabled"],
          message: t("secrets.policy.pickOneType"),
        });
      }
      for (const type of CONSUMER_TYPES) {
        const c = v.consumers[type];
        if (c.enabled && c.mode === "selected" && c.ids.length === 0) {
          ctx.addIssue({
            code: "custom",
            path: ["consumers", type, "ids"],
            message: t("secrets.policy.pickOneConsumer"),
          });
        }
      }
      if (kind !== "secret") return;
      if (v.pin_mode === "hosts") {
        if (v.hosts.length === 0) {
          ctx.addIssue({
            code: "custom",
            path: ["hosts"],
            message: t("secrets.policy.hostsRequired"),
          });
        } else if (v.hosts.some((h) => h.trim() === "*" || /\s/.test(h.trim()))) {
          ctx.addIssue({
            code: "custom",
            path: ["hosts"],
            message: t("secrets.policy.hostInvalid"),
          });
        }
      }
      if (v.pin_mode === "any" && !v.pin_override_reason.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["pin_override_reason"],
          message: t("secrets.policy.reasonRequired"),
        });
      }
      if (v.private_locations && !v.private_locations_reason.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["private_locations_reason"],
          message: t("secrets.policy.reasonRequired"),
        });
      }
    });

export type SecretPolicyForm = z.infer<ReturnType<typeof makeSecretPolicySchema>>;

const consumerDefaults = (allowed: AllowedConsumer[], type: ConsumerType) => {
  const entry = allowed.find((c) => c.type === type);
  return {
    enabled: !!entry,
    mode: (entry?.ids?.length ? "selected" : "all") as "all" | "selected",
    ids: entry?.ids ?? [],
  };
};

export const secretPolicyDefaults = (detail: SecretDetail): SecretPolicyForm => ({
  consumers: {
    alert_destination: consumerDefaults(detail.allowed_consumers, "alert_destination"),
    pipeline_destination: consumerDefaults(detail.allowed_consumers, "pipeline_destination"),
    synthetics_check: consumerDefaults(detail.allowed_consumers, "synthetics_check"),
    ai_toolset: consumerDefaults(detail.allowed_consumers, "ai_toolset"),
  },
  pin_mode: detail.pin_mode === "any" ? "any" : "hosts",
  hosts: [...detail.allowed_hosts],
  pin_override_reason: detail.pin_override_reason ?? "",
  private_locations: detail.private_locations === "on",
  private_locations_reason: detail.private_locations_reason ?? "",
});

/** Builds the PUT body; a P2 `legacy` private-locations value is left untouched unless turned on. */
export const buildPolicyRequest = (v: SecretPolicyForm, detail: SecretDetail): PolicyRequest => {
  const allowed_consumers: AllowedConsumer[] = CONSUMER_TYPES.filter(
    (type) => v.consumers[type].enabled,
  ).map((type) =>
    v.consumers[type].mode === "selected" ? { type, ids: [...v.consumers[type].ids] } : { type },
  );
  const body: PolicyRequest = {
    allowed_consumers,
    allowed_hosts:
      detail.kind === "secret" && v.pin_mode === "hosts" ? v.hosts.map((h) => h.trim()) : [],
    expected_policy_rev: detail.policy_rev,
  };
  if (detail.kind !== "secret") return body;
  body.pin_mode = v.pin_mode;
  if (v.pin_mode === "any") body.pin_override_reason = v.pin_override_reason.trim();
  if (v.private_locations) {
    body.private_locations = "on";
    body.private_locations_reason = v.private_locations_reason.trim();
  } else if (detail.private_locations !== "legacy") {
    body.private_locations = "off";
  }
  return body;
};
