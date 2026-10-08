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
  <div class="flex min-h-0 flex-1 flex-col" data-test="autoobserve-activity">
    <div
      class="border-border-default px-page-edge flex shrink-0 items-center gap-2 border-b py-2"
      data-test="autoobserve-activity-toolbar"
    >
      <OToggleGroup
        mobile-dropdown
        :model-value="loop"
        data-test="autoobserve-activity-loop"
        @update:model-value="(v) => (loop = v as Loop | 'all')"
      >
        <OToggleGroupItem value="all" size="sm">{{
          t("autoobserve.activity.allLoops")
        }}</OToggleGroupItem>
        <OToggleGroupItem v-for="l in LOOPS" :key="l" :value="l" size="sm">
          {{ t(LOOP_LABEL[l]) }}
        </OToggleGroupItem>
      </OToggleGroup>
      <OSelect
        v-model="status"
        :options="statusOptions"
        size="sm"
        width="sm"
        data-test="autoobserve-activity-status"
      />
      <span class="text-text-secondary ms-auto text-xs max-md:hidden">{{
        t("autoobserve.activity.ledgerHint")
      }}</span>
    </div>

    <OContent y class="min-h-0 flex-1 overflow-auto">
      <div class="flex flex-col gap-3">
        <OCard
          v-for="entry in rows"
          :key="entry.id"
          variant="outlined"
          class="transition-shadow duration-500"
          :class="flashId === entry.id ? 'ring-accent ring-2' : ''"
          :data-test="`autoobserve-ledger-${entry.id}`"
        >
          <OCardSection role="header" class="flex-wrap">
            <OTag
              :variant="LOOP_VARIANT[entry.loop]"
              size="xs"
              :label="t(LOOP_LABEL[entry.loop])"
            />
            <OText variant="mono" class="text-text-heading">{{ entry.actionClass }}</OText>
            <span class="text-text-body min-w-0 truncate text-sm">{{ entry.target }}</span>
            <OTag
              v-if="entry.userBuilt"
              variant="default-outline"
              size="xs"
              :label="t('autoobserve.activity.userBuilt')"
            />
            <div class="ms-auto flex items-center gap-3">
              <span class="text-text-secondary text-xs">{{
                t("autoobserve.activity.confidence", { value: entry.confidence })
              }}</span>
              <span class="text-text-secondary text-xs">{{ entry.when }}</span>
              <OTag
                :variant="LEDGER_STATUS[entry.status].variant"
                size="sm"
                :label="t(LEDGER_STATUS[entry.status].key)"
              />
            </div>
          </OCardSection>
          <OCardSection role="body" class="flex flex-col gap-3 pt-0">
            <p class="text-text-body text-sm">
              <span class="text-text-label text-xs font-medium">{{
                t("autoobserve.activity.evidence")
              }}</span>
              {{ entry.evidence }}
            </p>
            <div class="grid grid-cols-2 gap-2 max-md:grid-cols-1">
              <div class="flex min-w-0 flex-col gap-1">
                <OCodeBlock
                  :code="entry.before"
                  :lang="codeLang(entry.before)"
                  chrome="editor"
                  :filename="t('autoobserve.activity.before')"
                  wrap
                  :copyable="false"
                  :data-test="`autoobserve-ledger-${entry.id}-before`"
                />
              </div>
              <div class="flex min-w-0 flex-col gap-1">
                <span v-if="editing === entry.id" class="text-text-label text-xs font-medium">{{
                  t("autoobserve.activity.after")
                }}</span>
                <OTextarea
                  v-if="editing === entry.id"
                  v-model="draft"
                  :rows="4"
                  :data-test="`autoobserve-ledger-${entry.id}-draft`"
                />
                <OCodeBlock
                  v-else
                  :code="entry.after"
                  :lang="codeLang(entry.after)"
                  chrome="editor"
                  :filename="t('autoobserve.activity.after')"
                  wrap
                  :copyable="false"
                  :data-test="`autoobserve-ledger-${entry.id}-after`"
                />
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span
                v-if="entry.status === 'auto_applied' && entry.reviewWindow"
                class="text-text-secondary text-xs"
              >
                <OIcon name="timer" size="xs" class="me-1 align-middle" />{{
                  t("autoobserve.activity.reviewWindow", { window: raw(entry.reviewWindow) })
                }}
              </span>
              <span v-if="entry.note" class="text-text-secondary text-xs">{{ entry.note }}</span>
              <span
                v-if="entry.actionClass === 'ReviewForDeletion'"
                class="text-text-secondary text-xs"
                >{{ t("autoobserve.activity.neverAutoRetire") }}</span
              >
              <span v-if="entry.userBuilt" class="text-text-secondary text-xs">{{
                t("autoobserve.activity.neverSilent")
              }}</span>
              <div class="ms-auto flex items-center gap-2">
                <OButton
                  v-if="entry.status === 'auto_applied'"
                  variant="outline"
                  size="sm"
                  icon-left="undo"
                  :data-test="`autoobserve-ledger-${entry.id}-undo`"
                  @click="undo(entry)"
                >
                  {{ t("autoobserve.activity.undo") }}
                </OButton>
                <template v-if="entry.status === 'awaiting'">
                  <template v-if="editing === entry.id">
                    <OButton variant="outline" size="sm-action" @click="editing = null">
                      {{ t("common.cancel") }}
                    </OButton>
                    <OButton
                      variant="primary"
                      size="sm-action"
                      :data-test="`autoobserve-ledger-${entry.id}-save`"
                      @click="saveAndApprove(entry)"
                    >
                      {{ t("autoobserve.activity.saveApprove") }}
                    </OButton>
                  </template>
                  <template v-else>
                    <OButton
                      variant="ghost-destructive"
                      size="sm"
                      :data-test="`autoobserve-ledger-${entry.id}-reject`"
                      @click="reject(entry)"
                    >
                      {{ t("autoobserve.activity.reject") }}
                    </OButton>
                    <OButton
                      variant="outline"
                      size="sm"
                      icon-left="edit"
                      :data-test="`autoobserve-ledger-${entry.id}-edit`"
                      @click="startEdit(entry)"
                    >
                      {{ t("autoobserve.activity.edit") }}
                    </OButton>
                    <OButton
                      variant="primary"
                      size="sm"
                      :data-test="`autoobserve-ledger-${entry.id}-approve`"
                      @click="approve(entry)"
                    >
                      {{ t("autoobserve.activity.approve") }}
                    </OButton>
                  </template>
                </template>
              </div>
            </div>
          </OCardSection>
        </OCard>
        <OEmptyState
          v-if="!rows.length"
          size="block"
          illustration="history"
          :title="t('autoobserve.activity.emptyTitle')"
          :description="t('autoobserve.activity.emptyDescription')"
        />
      </div>
    </OContent>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OContent from "@/lib/core/Content/OContent.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import {
  LEDGER_STATUS,
  LOOP_LABEL,
  type LedgerEntry,
  type LedgerStatus,
  type Loop,
} from "./fixtures";

const props = defineProps<{ ledger: LedgerEntry[]; highlightId?: string }>();

const flashId = ref<string | null>(null);
onMounted(async () => {
  if (!props.highlightId) return;
  await nextTick();
  document
    .querySelector(`[data-test="autoobserve-ledger-${props.highlightId}"]`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
  flashId.value = props.highlightId;
  setTimeout(() => (flashId.value = null), 2500);
});
const emit = defineEmits<{ "update-entry": [id: string, patch: Partial<LedgerEntry>] }>();

const { t } = useI18nTyped();

const LOOPS: Loop[] = ["coverage", "calibration", "investigation"];
const LOOP_VARIANT: Record<Loop, BadgeVariant> = {
  coverage: "teal-soft",
  calibration: "indigo-soft",
  investigation: "orange-soft",
};

const loop = ref<Loop | "all">("all");
const status = ref<LedgerStatus | "all">("all");
const editing = ref<string | null>(null);
const draft = ref("");

const statusOptions = computed(() => [
  { label: t("autoobserve.activity.allStatuses"), value: "all" },
  ...(Object.keys(LEDGER_STATUS) as LedgerStatus[]).map((s) => ({
    label: t(LEDGER_STATUS[s].key),
    value: s,
  })),
]);

const rows = computed(() =>
  props.ledger.filter(
    (e) =>
      (loop.value === "all" || e.loop === loop.value) &&
      (status.value === "all" || e.status === status.value),
  ),
);

const codeLang = (code: string) => (code.startsWith("WHERE") ? "sql" : "yaml");

const undo = (entry: LedgerEntry) => {
  emit("update-entry", entry.id, {
    status: "rolled_back",
    note: t("autoobserve.activity.undoneNote"),
  });
  toast({ variant: "success", message: t("autoobserve.activity.undoneToast") });
};

const approve = (entry: LedgerEntry) => {
  emit("update-entry", entry.id, { status: "approved" });
  toast({ variant: "success", message: t("autoobserve.activity.approvedToast") });
};

const reject = (entry: LedgerEntry) => {
  emit("update-entry", entry.id, {
    status: "rejected",
    note: t("autoobserve.activity.rejectedNote"),
  });
  toast({ variant: "default", message: t("autoobserve.activity.rejectedToast") });
};

const startEdit = (entry: LedgerEntry) => {
  editing.value = entry.id;
  draft.value = entry.after;
};

const saveAndApprove = (entry: LedgerEntry) => {
  emit("update-entry", entry.id, { status: "approved", after: draft.value });
  editing.value = null;
  toast({ variant: "success", message: t("autoobserve.activity.approvedToast") });
};
</script>
