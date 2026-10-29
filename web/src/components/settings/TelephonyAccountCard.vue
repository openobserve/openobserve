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

<template>
  <OCard variant="outlined" class="max-w-160 gap-4 p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex min-w-0 flex-col gap-0.5">
        <h2 class="text-text-heading m-0 text-lg font-semibold">{{ title }}</h2>
        <span class="text-text-secondary text-sm" data-test="telephony-card-meta">
          {{ meta }}
        </span>
      </div>
      <OTag
        :variant="TAG_VARIANT[health]"
        size="sm"
        :label="tagLabel"
        data-test="telephony-card-status"
      />
    </div>

    <OBanner
      v-if="problem"
      variant="error-soft"
      icon="error-outline"
      data-test="telephony-card-problem"
    >
      {{ problem }}
      <template v-if="updatable" #actions>
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="readOnly"
          data-test="telephony-card-problem-update"
          @click="emit('update')"
        >
          {{ t("telephony.update") }}
        </OButton>
      </template>
    </OBanner>

    <OBanner
      v-if="live?.state === 'unavailable'"
      variant="warning"
      dense
      data-test="telephony-card-unchecked"
    >
      {{ t("telephony.uncheckedNow", { provider: PROVIDER }) }}
    </OBanner>

    <OBanner v-if="ok?.trial" variant="info" icon="info" data-test="telephony-card-trial">
      {{ t("telephony.trial", { provider: PROVIDER }) }}
    </OBanner>

    <div class="border-border-default grid grid-cols-1 gap-2 border-t pt-4">
      <TelephonyPress4Row v-if="callsMayWork" :available="press4Available" />
      <span
        v-if="ok && !ok.can_text"
        class="text-status-warning-text flex items-center gap-2 text-sm"
        data-test="telephony-card-cant-text"
      >
        <OIcon name="warning-amber" size="sm" />
        {{ t("telephony.cantText") }}
      </span>
      <span
        v-if="ok && !ok.can_call"
        class="text-status-warning-text flex items-center gap-2 text-sm"
        data-test="telephony-card-cant-call"
      >
        <OIcon name="warning-amber" size="sm" />
        {{ t("telephony.cantCall") }}
      </span>
    </div>

    <slot />
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";

import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { telephonyStatusQuery } from "@/services/oncall.queries";
import type { I18nText } from "@/types/i18n";
import { useI18nTyped } from "@/types/i18n";
import TelephonyPress4Row from "./TelephonyPress4Row.vue";
import {
  PROVIDER,
  liveTelephonyStatus,
  telephonyHealth,
  telephonyRefusalText,
  type TelephonyHealth,
} from "./telephony";

const TAG_VARIANT: Record<TelephonyHealth, BadgeVariant> = {
  checking: "default-soft",
  ok: "success-soft",
  broken: "error-soft",
  unchecked: "warning-soft",
};

defineProps<{
  title: I18nText;
  meta: I18nText;
  press4Available: boolean;
  /** Whether a broken account can be fixed from here, which only the org's own account can. */
  updatable: boolean;
  readOnly: boolean;
}>();

const emit = defineEmits<{ (_e: "update"): void }>();

const { t } = useI18nTyped();
const store = useStore();
const orgId = computed<string>(() => store.state.selectedOrganization.identifier);

const status = useQuery(() => telephonyStatusQuery(orgId.value));
const health = computed(() => telephonyHealth(status.data.value, status.error.value));
const live = computed(() => liveTelephonyStatus(status.data.value, status.error.value));
const ok = computed(() => (live.value?.state === "ok" ? live.value : null));
const callsMayWork = computed(() => health.value !== "broken" && ok.value?.can_call !== false);

const tagLabel = computed<I18nText>(() => {
  const labels: Record<TelephonyHealth, I18nText> = {
    checking: t("telephony.statusChecking"),
    ok: t("telephony.connected"),
    broken: t("telephony.statusBroken"),
    unchecked: t("telephony.statusUnchecked"),
  };
  return labels[health.value];
});

const problem = computed<I18nText | null>(() => {
  const state = live.value?.state;
  if (state === "account_rejected" || state === "from_not_on_account" || state === "unreadable") {
    return telephonyRefusalText(t, state);
  }
  return null;
});
</script>
