// Copyright 2026 OpenObserve Inc.
//
// Validation for SecurityAllowlistForm.vue, with the server's limits.

import { z } from "zod";

import {
  ALLOWLIST_PURPOSES,
  type AllowList,
  type AllowListInput,
  type AllowListPurpose,
} from "@/services/securitySigma";

type Translate = (key: string, named?: Record<string, unknown>) => string;

export const ALLOWLIST_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;
export const MAX_ALLOWLIST_NAME = 128;
export const MAX_ALLOWLIST_VALUES = 1000;
export const MAX_ALLOWLIST_VALUE_CHARS = 512;
export const MAX_ALLOWLIST_DESCRIPTION = 1000;

/** Purposes whose values the server checks as an IP address or CIDR. */
export const NETWORK_PURPOSES: readonly AllowListPurpose[] = ["known_egress", "scanner"];

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isIpv6(value: string): boolean {
  if (!value.includes(":") || !/^[0-9a-f:.]+$/i.test(value)) return false;
  // The URL parser is the browser's own IPv6 grammar.
  try {
    new URL(`http://[${value}]/`);
    return true;
  } catch {
    return false;
  }
}

/** Whether `value` is an IPv4/IPv6 address, optionally with a prefix length. */
export function isIpOrCidr(value: string): boolean {
  const [address, prefix, extra] = value.trim().split("/");
  if (extra !== undefined || !address) return false;
  const v4 = IPV4.test(address);
  if (!v4 && !isIpv6(address)) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (v4 ? 32 : 128);
}

/** One value per line, trimmed, blanks and repeats dropped. */
export function splitLines(text: string): string[] {
  return [
    ...new Set(
      text
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

export type AllowlistFormValues = {
  id: string;
  name: string;
  purpose: AllowListPurpose;
  values: string;
  description: string;
};

/** `takenIds` are other lists' ids; a PUT on one would replace it, so a new list may not reuse it. */
export const makeAllowlistSchema = (t: Translate, takenIds: () => readonly string[] = () => []) =>
  z
    .object({
      id: z.string().trim().regex(ALLOWLIST_ID_PATTERN, t("siem.tuning.allowlists.idInvalid")),
      name: z
        .string()
        .trim()
        .min(1, t("siem.tuning.allowlists.nameRequired"))
        .max(
          MAX_ALLOWLIST_NAME,
          t("siem.tuning.allowlists.nameTooLong", { max: MAX_ALLOWLIST_NAME }),
        ),
      purpose: z.enum(ALLOWLIST_PURPOSES),
      values: z.string(),
      description: z
        .string()
        .max(
          MAX_ALLOWLIST_DESCRIPTION,
          t("siem.tuning.allowlists.descriptionTooLong", { max: MAX_ALLOWLIST_DESCRIPTION }),
        ),
    })
    .superRefine((val, ctx) => {
      if (takenIds().includes(val.id.trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["id"],
          message: t("siem.tuning.allowlists.idTaken"),
        });
      }
      const values = splitLines(val.values);
      const issue = (message: string) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["values"], message });
      if (values.length > MAX_ALLOWLIST_VALUES) {
        issue(t("siem.tuning.allowlists.valuesTooMany", { max: MAX_ALLOWLIST_VALUES }));
        return;
      }
      if (values.some((v) => v.length > MAX_ALLOWLIST_VALUE_CHARS)) {
        issue(t("siem.tuning.allowlists.valueTooLong", { max: MAX_ALLOWLIST_VALUE_CHARS }));
        return;
      }
      if (NETWORK_PURPOSES.includes(val.purpose)) {
        const bad = values.find((v) => !isIpOrCidr(v));
        if (bad) issue(t("siem.tuning.allowlists.notNetwork", { value: bad }));
      }
    });

export const allowlistDefaults = (list?: AllowList): AllowlistFormValues => ({
  id: list?.id ?? "",
  name: list?.name ?? "",
  purpose: list?.purpose ?? "known_egress",
  values: (list?.values ?? []).join("\n"),
  description: list?.description ?? "",
});

/** The request body, with explicit keys. */
export function allowlistPayload(value: AllowlistFormValues): AllowListInput {
  return {
    name: value.name.trim(),
    purpose: value.purpose,
    values: splitLines(value.values),
    description: value.description.trim(),
  };
}
