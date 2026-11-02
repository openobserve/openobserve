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
  <ODialog
    data-test="settings-org-domain-details-dialog"
    v-model:open="dialogOpen"
    size="md"
    :title="title"
    :secondary-button-label="t('common.close')"
    :primary-button-label="canVerify ? t('settings.orgDomainMapping.verifyNow') : undefined"
    :primary-button-loading="verifying"
    @click:secondary="dialogOpen = false"
    @click:primary="emit('verify')"
  >
    <div class="flex flex-col gap-4">
      <template v-if="isDnsLink && link">
        <span
          v-if="failureReason"
          class="text-status-error-text text-sm"
          data-test="settings-org-domain-details-failure"
        >
          {{ t("settings.orgDomainMapping.lastCheckFailed", { reason: failureReason }) }}
        </span>
        <OrgDomainVerification :domain="link" />
      </template>

      <template v-else>
        <p class="text-text-body text-sm" data-test="settings-org-domain-details-summary">
          {{ summary }}
        </p>
        <dl
          v-if="request || verifiedAt"
          class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"
          data-test="settings-org-domain-details-facts"
        >
          <template v-if="request">
            <dt class="text-text-secondary">{{ t("settings.orgDomainMapping.requestedBy") }}</dt>
            <dd class="text-text-body min-w-0 break-all">{{ raw(request.requested_by) }}</dd>
            <dt class="text-text-secondary">{{ t("settings.orgDomainMapping.requestedAt") }}</dt>
            <dd class="text-text-body"><OTimeCell :value="request.created_at" unit="us" /></dd>
          </template>
          <template v-if="request && request.status !== 0">
            <dt class="text-text-secondary">{{ t("settings.orgDomainMapping.answeredBy") }}</dt>
            <dd class="text-text-body min-w-0 break-all">
              {{ raw(request.answered_by || "—") }}
            </dd>
            <dt class="text-text-secondary">{{ t("settings.orgDomainMapping.reason") }}</dt>
            <dd class="text-text-body min-w-0 break-words">{{ raw(request.reason || "—") }}</dd>
          </template>
          <template v-if="verifiedAt">
            <dt class="text-text-secondary">{{ t("settings.orgDomainMapping.verifiedAt") }}</dt>
            <dd class="text-text-body" data-test="settings-org-domain-details-verified-at">
              <OTimeCell :value="verifiedAt" unit="us" />
            </dd>
          </template>
        </dl>
      </template>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OrgDomainOwnership, OrgDomainRequest } from "@/services/organizations";
import OrgDomainVerification from "./OrgDomainVerification.vue";

const props = defineProps<{
  open: boolean;
  domain: string;
  /** The ownership row; null for a request that never became a link. */
  link: OrgDomainOwnership | null;
  /** The request behind an approved link, or the open or rejected request itself. */
  request: OrgDomainRequest | null;
  /** Why the last DNS check failed, already translated; null when it did not fail. */
  failureReason: I18nText | null;
  verifying: boolean;
}>();

const emit = defineEmits<{
  (_e: "update:open", _value: boolean): void;
  (_e: "verify"): void;
}>();

const { t } = useI18nTyped();

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

const isDnsLink = computed(() => !!props.link && !props.link.meta_mapped);
const canVerify = computed(() => isDnsLink.value && props.link?.verification_state !== 1);

const title = computed(() => {
  if (!isDnsLink.value) {
    return t("settings.orgDomainMapping.detailsDialogTitle", { domain: props.domain });
  }
  return canVerify.value
    ? t("settings.orgDomainMapping.verifyDialogTitle", { domain: props.domain })
    : t("settings.orgDomainMapping.recordDialogTitle", { domain: props.domain });
});

// Links approved from a request carry no `verified_at`, so the approval time stands in for it.
const verifiedAt = computed<number | null>(() => {
  const link = props.link;
  if (!link || link.verification_state !== 1) return null;
  if (link.verified_at) return link.verified_at;
  if (props.request?.status === 1) return props.request.updated_at;
  return link.last_checked_at ?? link.updated_at;
});

const summary = computed(() => {
  if (props.link) return t("settings.orgDomainMapping.approvedLinkInfo");
  return props.request?.status === 2
    ? t("settings.orgDomainMapping.rejectedRequestInfo")
    : t("settings.orgDomainMapping.pendingRequestInfo");
});
</script>
