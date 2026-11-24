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

<!-- What the tenant must trust (X2): read-only; ids here are not secret. -->
<template>
  <div
    class="border-border-default rounded-default flex flex-col gap-2 border p-3"
    data-test="secret-backend-identity"
  >
    <span class="text-text-heading text-sm font-medium">{{
      t("secrets.backends.identity.title")
    }}</span>
    <span v-if="identity.isPending.value" class="text-text-secondary text-sm">{{
      t("common.loading")
    }}</span>
    <template v-else-if="data">
      <div class="flex flex-col gap-1">
        <span class="text-text-secondary text-xs">{{ t("secrets.backends.identity.roles") }}</span>
        <div
          v-for="row in principals"
          :key="row.arn"
          class="flex min-w-0 items-center gap-2"
          :data-test="`secret-backend-identity-${row.which}`"
        >
          <OTruncatedText class="text-text-body min-w-0 font-mono text-xs">{{
            row.arn
          }}</OTruncatedText>
          <OTag size="xs" :variant="row.variant" icon="" :label="row.label" />
        </div>
      </div>
      <div class="flex min-w-0 items-center gap-2">
        <span class="text-text-secondary text-xs">{{
          t("secrets.backends.identity.externalId")
        }}</span>
        <span class="text-text-body font-mono text-xs" data-test="secret-backend-external-id">{{
          data.external_id_or_subject
        }}</span>
        <OTag size="xs" variant="default-soft" icon="" :label="t('secrets.backends.notSecret')" />
      </div>
      <OBanner
        v-if="data.next_principal"
        variant="warning"
        icon="warning"
        dense
        :content="t('secrets.backends.identity.rotationPending')"
        data-test="secret-backend-rotation-pending"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import OTag from "@/lib/core/Badge/OTag.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { SecretBackend } from "@/services/secretBackends";
import { backendIdentityQuery } from "@/services/secretBackends.queries";

const props = defineProps<{ backend: SecretBackend }>();
const { t } = useI18nTyped();
const orgId = useOrgId();

const identity = useQuery(() =>
  Object.assign(backendIdentityQuery(orgId.value, props.backend.id), {
    enabled: !!orgId.value,
  }),
);
const data = computed(() => identity.data.value);

// While a rotation is pending the tenant must trust both roles; after the switch, one (R13-17).
const principals = computed(() => {
  const d = data.value;
  if (!d) return [];
  const rows: { which: string; arn: I18nText; label: I18nText; variant: BadgeVariant }[] = [
    {
      which: "current",
      arn: raw(d.principal),
      label: t("secrets.backends.identity.current"),
      variant: "default-soft",
    },
  ];
  if (d.next_principal) {
    rows.push({
      which: "next",
      arn: raw(d.next_principal),
      label: t("secrets.backends.identity.next"),
      variant: "primary-soft",
    });
  }
  return rows;
});
</script>
