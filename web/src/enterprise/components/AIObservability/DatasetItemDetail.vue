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

<!--
  Dataset item detail — one golden, opened from a row on the Dataset Detail page.
  A drawer, not a page: the app's entity detail views are drawers (ScorerDetail,
  ScoreConfigDetail), and the item only makes sense next to the list it came
  from. Items are MVCC, so the Versions tab is the point of the view: every edit
  appended an immutable row and they are all still readable.
-->
<template>
  <ODrawer
    bleed
    :open="open"
    side="right"
    size="lg"
    :title="raw(item.id)"
    title-data-test="ai-dataset-item-detail-id"
    :sub-title="t('aiObservability.datasets.detail.itemDetail.eyebrow')"
    data-test="ai-dataset-item-detail"
    @update:open="handleOpenChange"
  >
    <div class="flex h-full min-h-0 flex-col">
      <OTabs
        :model-value="activeTab"
        bordered
        class="shrink-0 px-5"
        data-test="ai-dataset-item-detail-tabs"
        @update:model-value="activeTab = $event as TabId"
      >
        <OTab
          v-for="tab in tabs"
          :key="tab.id"
          :name="tab.id"
          :data-test="`ai-dataset-item-detail-tab-${tab.id}`"
        >
          <span>{{ tab.label }}</span>
          <OTag
            v-if="tab.count != null"
            type="countChip"
            :value="activeTab === tab.id ? 'primary' : 'neutral'"
          >
            {{ tab.count }}
          </OTag>
        </OTab>
      </OTabs>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-5 py-4">
        <!-- ── Item ── -->
        <template v-if="activeTab === 'item'">
          <div class="flex items-center justify-between gap-2">
            <OTag
              :variant="sourceVariant"
              shape="rounded"
              data-test="ai-dataset-item-detail-source"
            >
              {{ t(`aiObservability.datasets.source.${item.source}`) }}
            </OTag>
            <!-- The version count is the whole reason this view exists, so it
                 doubles as the way into the Versions tab. -->
            <OButton
              variant="outline"
              size="sm"
              icon-left="history"
              data-test="ai-dataset-item-detail-version-pill"
              @click="activeTab = 'versions'"
            >
              {{ versionPillLabel }}
            </OButton>
          </div>

          <section
            v-if="lineage.length"
            class="flex flex-col gap-1.5"
            data-test="ai-dataset-item-detail-source-section"
          >
            <h4 class="text-compact text-text-heading m-0 font-semibold">
              {{ t("aiObservability.datasets.detail.itemDetail.sourceSection") }}
            </h4>
            <!-- One card, not a label column: the trace id is what a reader
                 came for, and the span/review/import pointers only qualify it. -->
            <div
              class="border-border-default bg-code-bg rounded-default flex items-center gap-3 border px-3 py-2.5"
            >
              <!-- The icon reads as a source marker, not decoration, so it sits
                     on its own tile against the card fill. -->
              <span
                class="border-border-default bg-surface-base rounded-default flex size-8 shrink-0 items-center justify-center border"
              >
                <OIcon
                  name="account-tree"
                  size="sm"
                  class="text-text-secondary"
                  aria-hidden="true"
                />
              </span>
              <div class="flex min-w-0 flex-col gap-1">
                <OCode
                  v-if="primaryRef"
                  copyable
                  truncate
                  :data-test="`ai-dataset-item-detail-ref-${primaryRef.key}`"
                >
                  {{ primaryRef.value }}
                </OCode>
                <!-- The remaining pointers qualify the trace, so they read as
                       one muted subtitle line rather than a stack of chips. -->
                <div
                  v-if="secondaryRefs.length"
                  class="text-text-secondary text-2xs flex min-w-0 flex-wrap items-baseline gap-x-1.5"
                >
                  <template v-for="(ref, index) in secondaryRefs" :key="ref.key">
                    <span v-if="index" aria-hidden="true">{{ REF_SEPARATOR }}</span>
                    <span
                      class="min-w-0 truncate"
                      :data-test="`ai-dataset-item-detail-ref-${ref.key}`"
                    >
                      {{ ref.label }}
                      <span class="font-mono">{{ ref.value }}</span>
                    </span>
                  </template>
                </div>
              </div>
            </div>
          </section>

          <section class="flex flex-col gap-1.5">
            <!-- Same min height as the Expected header, which carries a button —
                 so the two section labels sit on one rhythm. -->
            <div class="flex min-h-8 items-center">
              <h4 class="text-compact text-text-heading m-0 font-semibold">
                {{ t("aiObservability.datasets.detail.itemDetail.inputSection") }}
              </h4>
            </div>
            <div
              class="border-border-default bg-code-bg rounded-default text-text-body h-40 overflow-auto border px-3 py-2 font-mono text-xs wrap-break-word whitespace-pre-wrap"
              data-test="ai-dataset-item-detail-input"
            >
              {{ item.inputPreview }}
            </div>
          </section>

          <section class="flex flex-col gap-1.5">
            <div class="flex min-h-8 items-center justify-between gap-2">
              <h4 class="text-compact text-text-heading m-0 font-semibold">
                {{ t("aiObservability.datasets.detail.itemDetail.expectedSection") }}
              </h4>
              <OButton
                variant="outline"
                size="sm"
                data-test="ai-dataset-item-detail-edit"
                @click="emit('edit', item)"
              >
                {{ t("aiObservability.datasets.detail.itemDetail.editNewVersion") }}
              </OButton>
            </div>
            <div
              class="border-border-default bg-code-bg rounded-default text-text-body h-40 overflow-auto border px-3 py-2 font-mono text-xs wrap-break-word whitespace-pre-wrap"
              data-test="ai-dataset-item-detail-expected"
            >
              {{ item.expectedOutput }}
            </div>
          </section>

          <section class="flex flex-col gap-1.5">
            <h4 class="text-compact text-text-heading m-0 font-semibold">
              {{ t("aiObservability.datasets.detail.itemDetail.tagsSection") }}
            </h4>
            <div v-if="item.tags.length" class="flex flex-wrap items-center gap-1">
              <OTag
                v-for="tag in item.tags"
                :key="tag"
                variant="default-soft"
                shape="rounded"
                class="shrink-0"
              >
                {{ raw(tag) }}
              </OTag>
            </div>
            <span v-else class="text-text-secondary text-xs">
              {{ t("aiObservability.datasets.detail.itemDetail.noTags") }}
            </span>
          </section>

          <section v-if="metadataJson" class="flex flex-col gap-1.5">
            <div class="flex items-baseline gap-1.5">
              <h4 class="text-compact text-text-heading m-0 font-semibold">
                {{ t("aiObservability.datasets.detail.itemDetail.metadataSection") }}
              </h4>
              <span class="text-text-secondary text-2xs italic">
                {{ t("aiObservability.datasets.detail.itemDetail.metadataNote") }}
              </span>
            </div>
            <OCode block copyable data-test="ai-dataset-item-detail-metadata">
              {{ metadataJson }}
            </OCode>
          </section>
        </template>

        <!-- ── Versions ── -->
        <template v-else>
          <span class="text-text-secondary text-xs">
            {{ t("aiObservability.datasets.detail.itemDetail.versionsIntro") }}
          </span>

          <OEmptyState
            v-if="!versionsLoading && !versions.length"
            size="inline"
            :title="t('aiObservability.datasets.detail.itemDetail.versionsEmpty')"
            data-test="ai-dataset-item-detail-versions-empty"
          />

          <ul v-else class="m-0 flex list-none flex-col gap-2 p-0">
            <li
              v-for="(version, index) in versions"
              :key="version.rowId"
              class="border-border-default bg-card-bg rounded-default flex flex-col gap-2 border px-3.5 py-3"
              :data-test="`ai-dataset-item-detail-version-${version.version}`"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-text-heading text-compact font-bold">
                  {{
                    t("aiObservability.datasets.detail.itemDetail.versionLabel", {
                      version: version.version,
                    })
                  }}
                </span>
                <OTag v-if="index === 0" variant="primary-soft" shape="rounded">
                  {{ t("aiObservability.datasets.detail.itemDetail.versionCurrent") }}
                </OTag>
                <span class="text-text-secondary text-2xs">{{ versionMeta(version) }}</span>
              </div>
              <!-- The raw stored payload, not the reading preview: a version is
                   only meaningful next to what actually changed. -->
              <OCode block>{{ version.expectedOutput }}</OCode>
            </li>
          </ul>
        </template>
      </div>
    </div>

    <template #footer>
      <OButton
        variant="outline-destructive"
        size="sm-action"
        icon-left="delete"
        data-test="ai-dataset-item-detail-delete"
        @click="emit('delete', item)"
      >
        {{ t("aiObservability.datasets.detail.itemDetail.deleteButton") }}
      </OButton>
    </template>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useStore } from "vuex";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmDatasetsService, { type LlmDatasetItem } from "@/services/llm-datasets.service";

defineOptions({ name: "DatasetItemDetail" });

const props = defineProps<{
  item: LlmDatasetItem;
  datasetId: string;
}>();

const emit = defineEmits<{
  (_e: "close"): void;
  (_e: "edit", _item: LlmDatasetItem): void;
  (_e: "delete", _item: LlmDatasetItem): void;
}>();

const { t } = useI18nTyped();
const store = useStore();

/** Separates the qualifying source pointers on the subtitle line. */
const REF_SEPARATOR = raw("·");

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

type TabId = "item" | "versions";
const activeTab = ref<TabId>("item");

// Mounted only while an item is selected; every dismiss path flows through
// ODrawer's update:open(false) → `close` → the parent unmounts us.
const open = ref(true);
function handleOpenChange(value: boolean) {
  open.value = value;
  if (!value) emit("close");
}

const versions = ref<LlmDatasetItem[]>([]);
const versionsLoading = ref(false);

const versionCount = computed(() => versions.value.length || 1);

const tabs = computed<{ id: TabId; label: I18nText; count: number | null }[]>(() => [
  { id: "item", label: t("aiObservability.datasets.detail.itemDetail.tabs.item"), count: null },
  {
    id: "versions",
    label: t("aiObservability.datasets.detail.itemDetail.tabs.versions"),
    count: versionCount.value,
  },
]);

const versionPillLabel = computed(() =>
  t(
    "aiObservability.datasets.detail.itemDetail.versionPill",
    { version: props.item.version, count: versionCount.value },
    versionCount.value,
  ),
);

const sourceVariant = computed<BadgeVariant>(() =>
  props.item.source === "trace"
    ? "blue-soft"
    : props.item.source === "annotation"
      ? "purple-soft"
      : "orange-soft",
);

/** Lineage is four independent pointers, and an annotation push sets two of
 *  them — so they are listed, not collapsed into one "distilled from" line. */
const lineage = computed(() => {
  const refs: { key: string; label: I18nText; value: string }[] = [];
  const add = (key: string, label: I18nText, value: string | null) => {
    if (value) refs.push({ key, label, value: raw(value) });
  };
  add("trace", t("aiObservability.datasets.detail.itemDetail.sourceTrace"), props.item.sourceRef);
  add("span", t("aiObservability.datasets.detail.itemDetail.sourceSpan"), props.item.sourceSpanId);
  add(
    "review",
    t("aiObservability.datasets.detail.itemDetail.sourceReview"),
    props.item.reviewSubmissionId,
  );
  add(
    "import",
    t("aiObservability.datasets.detail.itemDetail.sourceImport"),
    props.item.importFilename,
  );
  return refs;
});

/** The trace id when there is one (lineage is ordered trace → span → review →
 *  import), otherwise whatever pointer the item does carry. */
const primaryRef = computed(() => lineage.value[0] ?? null);
const secondaryRefs = computed(() => lineage.value.slice(1));

const metadataJson = computed(() => {
  const value = props.item.metadata;
  if (!value || !Object.keys(value).length) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
});

/** Item rows are immutable, so `updatedAt` is when this version was written. */
function versionMeta(version: LlmDatasetItem): I18nText {
  return t("aiObservability.datasets.detail.itemDetail.versionMeta", {
    user: version.updatedBy ?? "—",
    time: version.updatedAt ? new Date(version.updatedAt).toLocaleString() : "—",
  });
}

async function loadVersions() {
  if (!orgId.value || !props.datasetId) return;
  versionsLoading.value = true;
  try {
    const rows = await llmDatasetsService.getItemVersions(
      orgId.value,
      props.datasetId,
      props.item.id,
    );
    // Newest first — the live item is what a reader is looking for.
    versions.value = [...rows].sort((a, b) => b.version - a.version);
  } catch {
    toast({
      variant: "error",
      message: t("aiObservability.datasets.detail.itemDetail.versionsError"),
    });
  } finally {
    versionsLoading.value = false;
  }
}

onMounted(loadVersions);
</script>
