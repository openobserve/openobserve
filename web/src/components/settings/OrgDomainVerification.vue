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
  <div class="flex flex-col gap-2" :data-test="`settings-org-domain-verification-${domain.domain}`">
    <OBanner
      v-if="domain.verification_state === 2 && domain.verification_failure_reason !== null"
      variant="error"
      icon="warning"
      dense
      :data-test="`settings-org-domain-failure-${domain.domain}`"
    >
      {{ t(FAILURE_REASON_KEYS[domain.verification_failure_reason]) }}
    </OBanner>

    <span class="text-text-heading text-sm font-medium">
      {{ t("settings.orgDomainMapping.recordInstructions") }}
    </span>
    <div class="flex flex-col gap-1">
      <span class="text-text-label text-2xs font-medium">
        {{ t("settings.orgDomainMapping.txtNameLabel") }}
      </span>
      <div class="flex min-w-0 items-center gap-1">
        <OCode truncate class="min-w-0">{{ raw(txtName) }}</OCode>
        <OButton
          variant="ghost"
          size="icon-xs"
          icon-left="content-copy"
          :data-test="`settings-org-domain-copy-txt-name-${domain.domain}`"
          @click="copy(txtName, t('settings.orgDomainMapping.txtNameCopied'))"
        >
          <OTooltip side="bottom" :content="t('settings.orgDomainMapping.copyTxtName')" />
        </OButton>
      </div>
    </div>
    <div class="flex flex-col gap-1">
      <span class="text-text-label text-2xs font-medium">
        {{ t("settings.orgDomainMapping.txtValueLabel") }}
      </span>
      <div class="flex min-w-0 items-center gap-1">
        <OCode truncate class="min-w-0">{{ raw(domain.verification_token) }}</OCode>
        <OButton
          variant="ghost"
          size="icon-xs"
          icon-left="content-copy"
          :data-test="`settings-org-domain-copy-txt-value-${domain.domain}`"
          @click="copy(domain.verification_token, t('settings.orgDomainMapping.txtValueCopied'))"
        >
          <OTooltip side="bottom" :content="t('settings.orgDomainMapping.copyTxtValue')" />
        </OButton>
      </div>
    </div>
    <span class="text-text-secondary text-xs">
      {{ t("settings.orgDomainMapping.verifyHint", { minutes: VERIFY_INTERVAL_MINUTES }) }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { copyToClipboard } from "@/utils/clipboard";
import type { OrgDomainOwnership } from "@/services/organizations";

const props = defineProps<{ domain: OrgDomainOwnership }>();

const { t } = useI18nTyped();

// Mirrors ORG_DOMAIN_OWNERSHIP_CHECK_INTERVAL in the cloud jobs; no endpoint exposes it.
const VERIFY_INTERVAL_MINUTES = 5;

const FAILURE_REASON_KEYS = {
  0: "settings.orgDomainMapping.failureReason.recordMissing",
  1: "settings.orgDomainMapping.failureReason.valueMismatch",
  2: "settings.orgDomainMapping.failureReason.dnsFailed",
} as const;

const txtName = computed(() => `_o2-verify.${props.domain.domain}`);

function copy(value: string, successMessage: I18nText) {
  copyToClipboard(value, t, { successMessage });
}
</script>
