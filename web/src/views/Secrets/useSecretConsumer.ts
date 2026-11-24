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

import { computed, ref, type Ref } from "vue";
import { queryClient } from "@/composables/query/queryClient";
import type { ConsumerType, SecretBind, SecretPickerItem, UsageEntry } from "@/services/secrets";
import {
  secretDetailQuery,
  secretPickerQuery,
  secretStoreStatusQuery,
} from "@/services/secrets.queries";
import { useQuery } from "@tanstack/vue-query";
import config from "@/aws-exports";
import { useOrgId } from "@/composables/query/useOrgId";
import { pinHostOf, refNames, refText } from "./secretRefs";
import { secretErrorUsage } from "./secretErrors";

export interface SecretRefusal {
  code: string;
  secret?: string;
  suggested_hosts?: string[];
  message?: string;
  /** Consumers the refusal names, for codes such as `variable_feeds_secret_consumer`. */
  usage?: UsageEntry[];
}

/** Codes a consumer save or test returns that name a secret and want the U4 card. */
const REFUSAL_CODES = new Set([
  "secret_private_location_refused",
  "slot_value_required",
  "slot_value_required_on_host_change",
  "duplicate_slot_identity",
  "secret_pin_required",
  "pin_mismatch",
  "secret_access_required",
  "consumer_not_allowed",
  "secret_use_denied",
  "secret_unset",
  "no_org_value",
  "policy_changed",
  "store_gate_closed",
  "store_disabled",
  "pin_hosts_empty",
  "pin_entry_invalid",
  "ref_not_allowed_in_field",
  "ref_typo",
  "insecure_transport",
  "save_before_test",
  "secret_kind_mismatch",
  "variable_feeds_secret_consumer",
]);

export const refusalFrom = (error: unknown): SecretRefusal | null => {
  const data = (error as { response?: { data?: Record<string, unknown> } })?.response?.data;
  const code = typeof data?.code === "string" ? data.code : undefined;
  if (!code || !REFUSAL_CODES.has(code)) return null;
  const usage = secretErrorUsage(error);
  return {
    code,
    secret: typeof data?.secret === "string" ? data.secret : undefined,
    suggested_hosts: Array.isArray(data?.suggested_hosts)
      ? (data.suggested_hosts as string[])
      : undefined,
    message: typeof data?.message === "string" ? data.message : undefined,
    usage: usage.length ? usage : undefined,
  };
};

/**
 * Store state a consumer form needs: what was picked, which first-use pins to send and
 * the last refusal. `texts` are every field value that may hold a ref.
 */
/** A picked secret this save must bind: it has no pin yet, or this consumer is not on its allowlist. */
export const needsBind = (item: SecretPickerItem): boolean =>
  item.kind === "secret" && (item.pin_mode === "none" || !item.allowed_here);

/**
 * `secret_binds` for one save (§3.6.1). Only manage-access holders send options; anyone else
 * saves without them and gets the server's refusal, which names whom to ask.
 */
export const buildSecretBinds = (
  items: SecretPickerItem[],
  pins: Record<string, string[]>,
  allow: Record<string, boolean>,
  policyRevs: Record<string, string>,
): SecretBind[] => {
  const out: SecretBind[] = [];
  for (const item of items) {
    if (!needsBind(item) || item.rights?.manage_access !== true || !policyRevs[item.id]) continue;
    const hosts = (pins[item.id] ?? []).map((h) => h.trim()).filter(Boolean);
    const allowThis = !item.allowed_here && allow[item.id] !== false;
    const pin: SecretBind["pin"] = item.pin_mode === "none" ? hosts : "keep";
    if (item.pin_mode === "none" && !hosts.length) continue;
    if (!allowThis && pin === "keep") continue;
    out.push({
      secret_id: item.id,
      allow_this_consumer: allowThis,
      pin,
      expected_policy_rev: policyRevs[item.id],
    });
  }
  return out;
};

/**
 * Store state a consumer form needs: what was picked, the binds to send and the last
 * refusal. `texts` are every field value that may hold a ref.
 */
export const useSecretConsumer = (
  org: Ref<string>,
  consumerType: Ref<ConsumerType>,
  texts: Ref<(string | undefined | null)[]>,
  url: Ref<string | undefined | null>,
) => {
  const pins = ref<Record<string, string[]>>({});
  const allow = ref<Record<string, boolean>>({});
  const refusal = ref<SecretRefusal | null>(null);
  const picked = ref<Record<string, SecretPickerItem>>({});

  const referenced = computed(() => refNames(texts.value));
  const hasRef = computed(() => referenced.value.secrets.size + referenced.value.vars.size > 0);

  /** Referenced secrets this save must pin or allow (V38, §3.6.1). */
  const toBind = computed(() =>
    Object.values(picked.value).filter(
      (item) => needsBind(item) && referenced.value.secrets.has(item.name),
    ),
  );

  const remember = (item: SecretPickerItem) => {
    picked.value = { ...picked.value, [item.name]: item };
    if (item.kind === "secret" && item.pin_mode === "none" && !pins.value[item.id]) {
      const host = pinHostOf(url.value);
      pins.value = { ...pins.value, [item.id]: host ? [host] : [] };
    }
  };

  /** Appends the picked ref to a field value. */
  const insert = (current: string | undefined | null, item: SecretPickerItem): string => {
    remember(item);
    const text = refText(item.kind, item.name);
    const base = String(current ?? "");
    return base && !/\s$/.test(base) && !base.endsWith("=") ? `${base} ${text}` : `${base}${text}`;
  };

  /** Reloads picker rows for refs already in a saved form, so the bind box knows them. */
  const loadPicked = async (consumerId = "") => {
    if (!hasRef.value) return;
    const items = await queryClient.fetchQuery(
      secretPickerQuery(org.value, consumerType.value, consumerId),
    );
    for (const item of items) if (referenced.value.secrets.has(item.name)) remember(item);
  };

  const binds = async (): Promise<SecretBind[]> => {
    const revs: Record<string, string> = {};
    for (const item of toBind.value) {
      if (item.rights?.manage_access !== true) continue;
      revs[item.id] = (
        await queryClient.fetchQuery(secretDetailQuery(org.value, item.id))
      ).policy_rev;
    }
    return buildSecretBinds(toBind.value, pins.value, allow.value, revs);
  };

  return { pins, allow, refusal, picked, referenced, hasRef, toBind, insert, loadPicked, binds };
};

/** The picker shows only in enterprise builds once every node can bind refs (`store_ready`). */
export const useSecretPickerShown = () => {
  if (config.isEnterprise != "true") return computed(() => false);
  const orgId = useOrgId();
  const status = useQuery(() =>
    Object.assign(secretStoreStatusQuery(orgId.value), { enabled: !!orgId.value }),
  );
  return computed(() => status.data.value?.store_ready === true);
};
