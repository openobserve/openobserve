<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { isForbiddenError } from "@/composables/security/useSecurityAccess";
import type { AllowList } from "@/services/securitySigma";
import { allowlistsQuery, deleteAllowlistMutation } from "@/services/securitySigma.queries";
import { detectionSaveFailure } from "@/utils/security/detectionFolder";
import SecurityAllowlistForm from "./SecurityAllowlistForm.vue";

const props = defineProps<{ orgId: string; canAuthor: boolean; canAdmin: boolean }>();

const { t } = useI18nTyped();
const { confirm } = useConfirmDialog();
const VISIBLE_VALUES = 5;

const query = useQuery(() => ({ ...allowlistsQuery(props.orgId), enabled: !!props.orgId }));
const lists = computed<AllowList[]>(() =>
  [...(query.data.value ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
);
const ids = computed(() => lists.value.map((l) => l.id));
const remove = useMutation(computed(() => deleteAllowlistMutation(props.orgId)));

/** `"new"` opens an empty form; a list opens it filled with that list. */
const editing = ref<AllowList | "new" | null>(null);
const editingList = computed(() => (editing.value === "new" ? null : editing.value));
const formKey = computed(() => (editing.value === "new" ? "new" : (editing.value?.id ?? "")));

async function onDelete(list: AllowList) {
  const ok = await confirm({
    title: t("siem.tuning.allowlists.deleteTitle"),
    message: t("siem.tuning.allowlists.deleteMessage", { name: list.name }),
    confirmLabel: t("siem.tuning.allowlists.delete"),
  });
  if (!ok) return;
  try {
    await remove.mutateAsync(list.id);
    toast({ variant: "success", message: t("siem.tuning.allowlists.deleted") });
  } catch (e) {
    // A 409 says an exception still reads the list, which the user must remove first.
    const { reason, forbidden } = detectionSaveFailure(e);
    toast({
      variant: "error",
      message: reason
        ? raw(reason)
        : forbidden
          ? t("siem.tuning.allowlists.deleteForbidden")
          : t("siem.tuning.allowlists.deleteFailed"),
    });
  }
}
</script>

<template>
  <div class="flex flex-col gap-3" data-test="security-allowlists">
    <div class="flex items-center gap-2">
      <span class="text-text-secondary min-w-0 flex-1 text-xs">{{
        t("siem.tuning.allowlists.about")
      }}</span>
      <OButton
        v-if="!editing"
        variant="outline"
        size="sm"
        icon-left="add"
        :disabled="!canAuthor"
        data-test="security-allowlists-add"
        @click="editing = 'new'"
      >
        {{ t("siem.tuning.allowlists.add") }}
        <OTooltip v-if="!canAuthor" :content="t('siem.access.needsAuthor')" />
      </OButton>
    </div>

    <SecurityAllowlistForm
      v-if="editing"
      :key="formKey"
      :org-id="orgId"
      :list="editingList"
      :existing-ids="ids"
      @saved="editing = null"
      @cancel="editing = null"
    />

    <div v-if="query.isLoading.value" class="flex items-center justify-center py-6">
      <OSpinner size="sm" />
    </div>
    <OBanner
      v-else-if="query.isError.value && !isForbiddenError(query.error.value)"
      variant="error-soft"
      icon="error-outline"
      dense
      data-test="security-allowlists-error"
      >{{ t("siem.tuning.allowlists.loadError") }}</OBanner
    >
    <OEmptyState
      v-else-if="!lists.length && !editing"
      size="inline"
      icon="checklist"
      :title="t('siem.tuning.allowlists.empty')"
      :description="t('siem.tuning.allowlists.emptyHint')"
      data-test="security-allowlists-empty"
    />
    <ul
      v-else-if="lists.length"
      class="border-border-default rounded-surface overflow-hidden border"
      data-test="security-allowlists-list"
    >
      <li
        v-for="list in lists"
        :key="list.id"
        class="border-border-subtle flex items-start gap-3 border-b px-3 py-2 last:border-b-0"
        :data-test="`security-allowlist-${list.id}`"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-text-heading text-sm font-semibold">{{ list.name }}</span>
            <span class="text-text-secondary font-mono text-xs">{{ list.id }}</span>
            <OTag variant="primary-soft" size="xs">{{
              t(`siem.tuning.allowlists.purpose.${list.purpose}`)
            }}</OTag>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <span class="text-text-secondary">{{
              t("siem.tuning.allowlists.valueCount", { n: list.values.length }, list.values.length)
            }}</span>
            <OTag
              v-for="v in list.values.slice(0, VISIBLE_VALUES)"
              :key="v"
              variant="default-soft"
              size="xs"
              class="font-mono"
              >{{ v }}</OTag
            >
            <span v-if="list.values.length > VISIBLE_VALUES" class="text-text-secondary">{{
              t("siem.detections.exceptions.moreValues", {
                n: list.values.length - VISIBLE_VALUES,
              })
            }}</span>
          </div>
          <span v-if="list.description" class="text-text-body text-xs">{{ list.description }}</span>
          <span class="text-text-secondary text-2xs flex items-center gap-1">
            {{ list.updated_by }} ·
            <OTimeCell :value="list.updated_at" unit="us" class="text-2xs" />
          </span>
        </div>
        <OButton
          v-if="canAuthor"
          variant="ghost"
          size="icon-sm"
          icon-left="edit"
          :aria-label="t('siem.tuning.allowlists.edit')"
          :data-test="`security-allowlist-edit-${list.id}`"
          @click="editing = list"
        >
          <OTooltip :content="t('siem.tuning.allowlists.edit')" />
        </OButton>
        <OButton
          v-if="canAdmin"
          variant="ghost-destructive"
          size="icon-sm"
          icon-left="delete"
          :aria-label="t('siem.tuning.allowlists.delete')"
          :data-test="`security-allowlist-delete-${list.id}`"
          @click="onDelete(list)"
        >
          <OTooltip :content="t('siem.tuning.allowlists.delete')" />
        </OButton>
      </li>
    </ul>
  </div>
</template>
