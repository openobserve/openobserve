<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import { securityTime } from "@/utils/security/time";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { isForbiddenError } from "@/composables/security/useSecurityAccess";
import type { Suppression } from "@/services/securityCases";
import { endSuppressionMutation, suppressionsQuery } from "@/services/securityCases.queries";
import { detectionSaveFailure } from "@/utils/security/detectionFolder";

const props = defineProps<{
  orgId: string;
  canAdmin: boolean;
  /** Detection names by alert id, so a scoped suppression reads by name. */
  detectionNames: Readonly<Record<string, string>>;
}>();

const { t } = useI18nTyped();
const { confirm } = useConfirmDialog();

const query = useQuery(() => ({ ...suppressionsQuery(props.orgId), enabled: !!props.orgId }));
const suppressions = computed<Suppression[]>(() =>
  [...(query.data.value ?? [])].sort((a, b) => a.until - b.until),
);
const end = useMutation(computed(() => endSuppressionMutation(props.orgId)));

const scopeOf = (s: Suppression): I18nText =>
  s.alert_id
    ? raw(props.detectionNames[s.alert_id] ?? s.alert_id)
    : t("siem.tuning.suppressions.allDetections");

async function onEnd(s: Suppression) {
  const ok = await confirm({
    title: t("siem.tuning.suppressions.endTitle"),
    message: t("siem.tuning.suppressions.endMessage", { entity: s.entity_value }),
    confirmLabel: t("siem.tuning.suppressions.end"),
  });
  if (!ok) return;
  try {
    await end.mutateAsync(s.id);
    toast({ variant: "success", message: t("siem.tuning.suppressions.ended") });
  } catch (e) {
    const { reason, forbidden } = detectionSaveFailure(e);
    toast({
      variant: "error",
      message: reason
        ? raw(reason)
        : forbidden
          ? t("siem.tuning.suppressions.endForbidden")
          : t("siem.tuning.suppressions.endFailed"),
    });
  }
}
</script>

<template>
  <div class="flex flex-col gap-3" data-test="security-suppressions">
    <span class="text-text-secondary text-xs">{{ t("siem.tuning.suppressions.about") }}</span>

    <div v-if="query.isLoading.value" class="flex items-center justify-center py-6">
      <OSpinner size="sm" />
    </div>
    <OBanner
      v-else-if="query.isError.value && isForbiddenError(query.error.value)"
      variant="warning"
      icon="lock"
      dense
      data-test="security-suppressions-forbidden"
      >{{ t("siem.tuning.suppressions.forbidden") }}</OBanner
    >
    <OBanner
      v-else-if="query.isError.value"
      variant="error-soft"
      icon="error-outline"
      dense
      data-test="security-suppressions-error"
      >{{ t("siem.tuning.suppressions.loadError") }}</OBanner
    >
    <OEmptyState
      v-else-if="!suppressions.length"
      size="inline"
      icon="notifications-paused"
      :title="t('siem.tuning.suppressions.empty')"
      :description="t('siem.tuning.suppressions.emptyHint')"
      data-test="security-suppressions-empty"
    />
    <ul
      v-else
      class="border-border-default rounded-surface overflow-hidden border"
      data-test="security-suppressions-list"
    >
      <li
        v-for="s in suppressions"
        :key="s.id"
        class="border-border-subtle flex items-start gap-3 border-b px-3 py-2 last:border-b-0"
        :data-test="`security-suppression-${s.id}`"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <OTag variant="default-soft" size="xs">{{
              t(`siem.tuning.suppressions.kind.${s.entity_kind}`)
            }}</OTag>
            <span class="text-text-heading font-mono">{{ s.entity_value }}</span>
            <span class="text-text-secondary">·</span>
            <span
              :class="s.alert_id ? 'text-text-body' : 'text-text-secondary'"
              :data-test="`security-suppression-scope-${s.id}`"
              >{{ scopeOf(s) }}</span
            >
          </div>
          <span class="text-text-body text-xs">{{ s.reason }}</span>
          <span
            class="text-text-secondary text-2xs flex flex-wrap items-center gap-1"
            :data-test="`security-suppression-expiry-${s.id}`"
          >
            {{ t("siem.tuning.suppressions.ends") }}
            <OTimeCell :value="s.until" unit="us" class="text-2xs" />
            ·
            <span>{{ securityTime(s.until / 1000) }}</span> · {{ s.created_by }} ·
            <OTimeCell :value="s.created_at" unit="us" class="text-2xs" />
          </span>
        </div>
        <OButton
          v-if="canAdmin"
          variant="outline"
          size="sm"
          :data-test="`security-suppression-end-${s.id}`"
          @click="onEnd(s)"
          >{{ t("siem.tuning.suppressions.end") }}</OButton
        >
      </li>
    </ul>
  </div>
</template>
