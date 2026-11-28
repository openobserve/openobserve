<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!-- A refused consumer save or test: names the secret, says why in one line, code on the right for support. -->
<template>
  <div
    class="border-border-default rounded-surface flex flex-col gap-1 border p-4"
    data-test="secret-save-refusal"
  >
    <div class="flex items-start gap-2">
      <OIcon name="error" size="sm" class="text-status-error-text mt-0.5 shrink-0" />
      <span class="text-text-body min-w-0 flex-1 text-sm">{{ line }}</span>
      <code class="text-text-secondary font-mono text-xs" data-test="secret-save-refusal-code">{{
        refusal.code
      }}</code>
    </div>
    <ul
      v-if="refusal.usage?.length"
      class="border-border-default divide-border-default rounded-surface ms-6 flex flex-col divide-y border"
      data-test="secret-save-refusal-usage"
    >
      <li v-for="(entry, i) in refusal.usage" :key="i" class="text-compact px-3 py-2">
        {{ usageLine(entry) }}
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { secretCodeText } from "./secretErrors";
import type { SecretRefusal } from "./useSecretConsumer";
import type { UsageEntry } from "@/services/secrets";

const props = defineProps<{ refusal: SecretRefusal }>();
const { t } = useI18nTyped();

const line = computed((): I18nText => {
  const r = props.refusal;
  const name = r.secret ?? t("secrets.consumer.thisSecret");
  if (r.code === "secret_pin_required") {
    return t("secrets.consumer.pinRequired", {
      name,
      hosts: (r.suggested_hosts ?? []).join(", ") || t("secrets.none"),
    });
  }
  if (r.code === "secret_access_required") return t("secrets.consumer.accessRequired", { name });
  if (r.code === "pin_mismatch") return t("secrets.consumer.pinMismatch", { name });
  if (r.code === "save_before_test") return t("secrets.consumer.saveThenTest");
  // Slot codes are about the check's own typed values, not a named store secret.
  if (
    r.code.startsWith("slot_value_required") ||
    r.code === "duplicate_slot_identity" ||
    r.code === "variable_feeds_secret_consumer"
  ) {
    return secretCodeText(t, r.code) ?? raw(r.message ?? r.code);
  }
  const known = secretCodeText(t, r.code);
  return known
    ? t("secrets.consumer.refusedWith", { name, reason: known })
    : raw(r.message ?? r.code);
});

const usageLine = (entry: UsageEntry) => {
  const path = entry.path.map((hop) => hop.consumer_name).join(" › ");
  return entry.field ? `${path} · ${entry.field}` : path;
};
</script>
