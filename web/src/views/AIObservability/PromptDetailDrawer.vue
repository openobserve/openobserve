<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <ODrawer
    bleed
    :open="open"
    side="right"
    :width="72"
    :title="raw(prompt?.name ?? '')"
    :sub-title="
      prompt ? t('aiObservability.promptManagement.promptSubtitle', { type: prompt.type }) : raw('')
    "
    data-test="prompt-detail-drawer"
    @update:open="emit('update:open', $event)"
  >
    <div v-if="prompt" class="flex h-full min-h-0 flex-col">
      <header
        class="border-b-dialog-header-border flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-3"
      >
        <OSelect
          v-model="selectedVersion"
          :options="versionOptions"
          label-key="label"
          value-key="value"
          width="sm"
          :label="t('aiObservability.promptManagement.viewingVersion')"
          label-position="inside"
          :disabled="loading"
          size="sm"
          data-test="prompt-detail-version-select"
        />
        <div class="flex min-w-0 flex-1 flex-wrap gap-1">
          <OTag
            v-for="label in selectedLabels"
            :key="label.name"
            :variant="protectedLabels.includes(label.name) ? 'amber-soft' : 'default-soft'"
            shape="rounded"
          >
            {{
              t("aiObservability.promptManagement.versionLabel", {
                name: label.name,
                version: label.version,
              })
            }}
          </OTag>
        </div>
        <div class="flex items-center gap-2 max-lg:w-full">
          <OButton
            variant="outline"
            size="sm"
            icon-left="play-arrow"
            :title="t('aiObservability.promptManagement.openInPlayground')"
            data-test="prompt-detail-playground"
            :disabled="loading || !activeVersion"
            @click="activeVersion && emit('open-playground', activeVersion)"
          >
            <span class="max-md:hidden">{{
              t("aiObservability.promptManagement.openInPlayground")
            }}</span>
          </OButton>
          <OButton
            variant="primary"
            size="sm"
            data-test="prompt-detail-new-version"
            :disabled="loading || !activeVersion || prompt.status !== 'active'"
            @click="emit('edit', activeVersion)"
          >
            {{ t("aiObservability.promptManagement.newVersion") }}
          </OButton>
        </div>
      </header>

      <OTabs v-model="activeTab" bordered class="shrink-0" data-test="prompt-detail-tabs">
        <OTab name="configuration" :label="t('aiObservability.promptManagement.configuration')" />
        <OTab name="labels" :label="t('aiObservability.promptManagement.labels')" />
        <OTab name="versions" :label="t('aiObservability.promptManagement.versions')" />
        <OTab name="traffic" :label="t('aiObservability.promptManagement.traffic')" />
      </OTabs>

      <div
        class="min-h-0 flex-1 overflow-auto"
        :class="activeTab === 'versions' || activeTab === 'labels' ? '' : 'px-5 py-3'"
      >
        <div v-if="loading" class="text-text-secondary py-10 text-center">
          {{ t("aiObservability.promptManagement.loadingPrompt") }}
        </div>

        <OEmptyState
          v-else-if="loadError"
          preset="load-error"
          :description="loadError"
          @action="load"
        />
        <template v-else-if="activeVersion && activeTab === 'configuration'">
          <!-- No "Configuration" heading: the tab label already names this block. -->
          <div class="flex flex-col gap-4.5">
            <dl
              class="[&_dd]:text-text-heading [&_dt]:text-text-secondary [&_dd]:text-compact m-0 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 [&_dd]:m-0 [&_dt]:text-xs [&_dt]:font-semibold"
            >
              <dt>{{ t("aiObservability.promptManagement.status") }}</dt>
              <dd>
                <OTag :variant="prompt.status === 'active' ? 'success-soft' : 'default-soft'">{{
                  prompt.status === "active"
                    ? t("aiObservability.promptManagement.active")
                    : t("aiObservability.promptManagement.archived")
                }}</OTag>
              </dd>
              <dt>{{ t("aiObservability.promptManagement.model") }}</dt>
              <dd>{{ activeVersion.config.model || raw("—") }}</dd>
              <dt>{{ t("aiObservability.promptManagement.promptId") }}</dt>
              <dd class="font-mono break-all">{{ prompt.entityId }}</dd>
              <dt>{{ t("aiObservability.promptManagement.versionId") }}</dt>
              <dd class="font-mono break-all">{{ activeVersion.id }}</dd>
            </dl>
            <section class="flex flex-col gap-2">
              <h4
                class="text-compact text-text-heading border-b-text-secondary/12 m-0 inline-flex items-center gap-1.5 border-b pb-1.5 leading-normal font-semibold"
              >
                {{ t("aiObservability.promptManagement.form.promptText") }}
              </h4>
              <pre
                class="rounded-default border-code-border bg-code-block-bg text-code-block-text m-0 max-h-96 overflow-auto border px-3 py-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
                data-test="prompt-detail-payload"
                >{{ payloadText(activeVersion.payload) }}</pre>
            </section>
            <section v-if="activeVersion.config.params != null" class="flex flex-col gap-2">
              <h4
                class="text-compact text-text-heading border-b-text-secondary/12 m-0 inline-flex items-center gap-1.5 border-b pb-1.5 leading-normal font-semibold"
              >
                {{ t("aiObservability.promptManagement.parameters") }}
              </h4>
              <OCode block>{{ jsonText(activeVersion.config.params) }}</OCode>
            </section>
            <section v-if="activeVersion.config.tools != null" class="flex flex-col gap-2">
              <h4
                class="text-compact text-text-heading border-b-text-secondary/12 m-0 inline-flex items-center gap-1.5 border-b pb-1.5 leading-normal font-semibold"
              >
                {{ t("aiObservability.promptManagement.tools") }}
              </h4>
              <OCode block>{{ jsonText(activeVersion.config.tools) }}</OCode>
            </section>
            <section v-if="activeVersion.config.responseFormat != null" class="flex flex-col gap-2">
              <h4
                class="text-compact text-text-heading border-b-text-secondary/12 m-0 inline-flex items-center gap-1.5 border-b pb-1.5 leading-normal font-semibold"
              >
                {{ t("aiObservability.promptManagement.responseFormat") }}
              </h4>
              <OCode block>{{ jsonText(activeVersion.config.responseFormat) }}</OCode>
            </section>
          </div>
        </template>

        <template v-else-if="activeTab === 'labels' && activeVersion">
          <PromptLabelsPanel
            :key="prompt.entityId"
            :labels="visibleLabels"
            :versions="versions"
            :selected-version="activeVersion.version"
            :protected-labels="protectedLabels"
            :busy="labelBusy"
            :read-only="prompt.status !== 'active'"
            :save-label="moveLabel"
            @remove="deleteLabel"
          />
        </template>

        <template v-else-if="activeTab === 'versions'">
          <div v-if="comparing && compared.length === 2" data-test="prompt-version-compare">
            <OPageHeader
              :title="t('aiObservability.promptManagement.form.compareVersions')"
              :back="{
                label: t('aiObservability.promptManagement.versions'),
                onClick: () => (comparing = false),
                dataTest: 'prompt-version-compare-back',
              }"
            >
              <template #actions>
                <OSelect
                  :model-value="compared[0].version"
                  :options="versionOptions.filter((option) => option.value !== compared[1].version)"
                  size="sm"
                  width="xs"
                  :aria-label="t('aiObservability.promptManagement.form.baseVersion')"
                  data-test="prompt-version-compare-base"
                  @update:model-value="(value) => setCompared(0, Number(value))"
                />
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  icon-left="swap-horiz"
                  data-test="prompt-version-compare-swap"
                  @click="swapCompared"
                >
                  <OTooltip :content="t('aiObservability.promptManagement.form.swapVersions')" />
                </OButton>
                <OSelect
                  :model-value="compared[1].version"
                  :options="versionOptions.filter((option) => option.value !== compared[0].version)"
                  size="sm"
                  width="xs"
                  :aria-label="t('aiObservability.promptManagement.form.targetVersion')"
                  data-test="prompt-version-compare-target"
                  @update:model-value="(value) => setCompared(1, Number(value))"
                />
                <OToggleGroup
                  :model-value="diffMode"
                  type="single"
                  data-test="prompt-version-compare-mode"
                  @update:model-value="(value) => value && (diffMode = value as typeof diffMode)"
                >
                  <OToggleGroupItem value="split" size="sm">{{
                    t("aiObservability.promptManagement.form.split")
                  }}</OToggleGroupItem>
                  <OToggleGroupItem value="unified" size="sm">{{
                    t("aiObservability.promptManagement.form.unified")
                  }}</OToggleGroupItem>
                </OToggleGroup>
              </template>
            </OPageHeader>
            <OContent y class="flex flex-col gap-4">
              <PromptVersionDiff :left="compared[0]" :right="compared[1]" :mode="diffMode" />
              <PromptVersionScoreComparison
                :org-id="orgId"
                :prompt-id="prompt.entityId"
                :versions="[compared[0].version, compared[1].version]"
              />
            </OContent>
          </div>
          <OTable
            :data="filteredVersions"
            :columns="versionColumns"
            row-key="id"
            pagination="none"
            :fill-height="false"
            :default-columns="false"
            :show-global-filter="false"
            :show-footer="false"
            :empty-message="t('aiObservability.promptManagement.form.noMatchingVersions')"
            v-else
            :frame="false"
            selection="multiple"
            :show-select-all="false"
            :selected-ids="compareIds"
            :is-row-selectable="canCompare"
            data-test="prompt-version-table"
            @update:selected-ids="(ids: string[]) => (compareIds = ids)"
            @row-click="(row) => viewVersion(row.version)"
          >
            <template #toolbar>
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <OSearchInput
                  v-model="versionSearch"
                  class="min-w-0 flex-1"
                  :placeholder="t('aiObservability.promptManagement.form.searchCommitMessage')"
                  clearable
                  data-test="prompt-version-search"
                />
                <OSelect
                  v-model="sourceFilter"
                  :options="sourceOptions"
                  label-key="label"
                  value-key="value"
                  width="sm"
                  size="sm"
                  :aria-label="t('aiObservability.promptManagement.source')"
                  data-test="prompt-version-source-filter"
                />
                <span
                  class="text-text-secondary text-xs whitespace-nowrap max-md:hidden"
                  data-test="prompt-version-selection-count"
                  >{{
                    t("aiObservability.promptManagement.form.selectionCount", {
                      count: compareIds.length,
                    })
                  }}</span
                >
                <OTooltip :content="compareReason" :disabled="compareIds.length === 2">
                  <OButton
                    variant="outline"
                    size="sm"
                    :disabled="compareIds.length !== 2"
                    data-test="prompt-version-compare-btn"
                    @click="openCompare"
                  >
                    {{ t("aiObservability.promptManagement.compare") }}
                  </OButton>
                </OTooltip>
              </div>
            </template>
            <template #cell-version="{ row }">
              <span class="tabular-nums">{{
                t("aiObservability.promptManagement.versionNumber", { version: row.version })
              }}</span>
            </template>
            <template #cell-commitMessage="{ row }">
              <span class="truncate">{{ row.commitMessage || raw("—") }}</span>
            </template>
            <template #cell-labels="{ row }">
              <div v-if="labelsForVersion(row.version).length" class="flex flex-wrap gap-1">
                <OTag
                  v-for="label in labelsForVersion(row.version)"
                  :key="label"
                  variant="default-soft"
                  shape="rounded"
                  >{{ label }}</OTag
                >
              </div>
              <span v-else class="text-text-secondary">{{ raw("—") }}</span>
            </template>
            <template #cell-createdBy="{ row }">
              <span class="text-text-secondary truncate">{{ row.createdBy || raw("—") }}</span>
            </template>
            <template #cell-createdAt="{ row }">
              <OTimeCell :value="row.createdAt" unit="ms" mode="relative" />
            </template>
            <template #cell-actions="{ row }">
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="play-arrow"
                :data-test="`prompt-version-playground-${row.version}`"
                @click.stop="emit('open-playground', row)"
              >
                <OTooltip :content="t('aiObservability.promptManagement.openInPlayground')" />
              </OButton>
            </template>
          </OTable>
        </template>

        <template v-else-if="activeTab === 'traffic'">
          <slot name="traffic" :version="activeVersion" />
        </template>
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { useMutation } from "@tanstack/vue-query";
import {
  movePromptLabelMutation,
  deletePromptLabelMutation,
} from "@/services/llm-prompts.service.queries";
import { computed, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import PromptLabelsPanel from "./PromptLabelsPanel.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import llmPromptsService, {
  type Prompt,
  type PromptLabel,
  type PromptSource,
  type PromptVersion,
} from "@/services/llm-prompts.service";
import { promptErrorText } from "./promptUx";
import PromptVersionDiff from "./PromptVersionDiff.vue";
import PromptVersionScoreComparison from "./PromptVersionScoreComparison.vue";

const { t } = useI18nTyped();
const { confirm } = useConfirmDialog();
const props = withDefaults(
  defineProps<{
    open: boolean;
    orgId: string;
    prompt: Prompt | null;
    initialVersion?: number | null;
    initialTab?: string;
    protectedLabels?: string[];
  }>(),
  { initialVersion: null, initialTab: "configuration", protectedLabels: () => [] },
);

const moveLabelMutation = useMutation(() => movePromptLabelMutation(props.orgId));
const deleteLabelMutation = useMutation(() => deletePromptLabelMutation(props.orgId));

const emit = defineEmits<{
  "update:open": [open: boolean];
  updated: [prompt: Prompt];
  edit: [version: PromptVersion | null];
  "open-playground": [version: PromptVersion];
}>();

const versions = ref<PromptVersion[]>([]);
const loading = ref(false);
const loadError = ref<I18nText>();
const activeTab = ref("configuration");
const selectedVersion = ref<number | null>(null);
const sourceFilter = ref<PromptSource | "all">("all");
const versionSearch = ref("");
const compareIds = ref<string[]>([]);
const comparing = ref(false);
const compareBaseId = ref("");
const compareHeadId = ref("");
const diffMode = ref<"split" | "unified">("split");
const labelBusy = ref(false);
let loadGeneration = 0;

const visibleLabels = computed(
  () => props.prompt?.labels.filter((label) => label.version != null) ?? [],
);
const selectedLabels = computed(() =>
  visibleLabels.value.filter((label) => label.version === selectedVersion.value),
);
const versionOptions = computed(() =>
  versions.value.map((version) => ({ label: raw(`v${version.version}`), value: version.version })),
);
const activeVersion = computed(
  () => versions.value.find((version) => version.version === selectedVersion.value) ?? null,
);
const filteredVersions = computed(() => {
  const needle = versionSearch.value.trim().toLowerCase();
  return versions.value.filter(
    (version) =>
      (sourceFilter.value === "all" || version.source === sourceFilter.value) &&
      (!needle || version.commitMessage.toLowerCase().includes(needle)),
  );
});
const compared = computed(() =>
  [compareBaseId.value, compareHeadId.value]
    .map((id) => versions.value.find((version) => version.id === id))
    .filter((version): version is PromptVersion => Boolean(version)),
);
const compareReason = computed(() =>
  versions.value.length < 2
    ? t("aiObservability.promptManagement.compareNeedsVersions")
    : t("aiObservability.promptManagement.selectTwoVersions"),
);
// Older version starts as the base so the diff reads as a change forward in time.
function openCompare() {
  const [base, head] = versions.value
    .filter((version) => compareIds.value.includes(version.id))
    .sort((left, right) => left.version - right.version);
  if (!base || !head) return;
  compareBaseId.value = base.id;
  compareHeadId.value = head.id;
  comparing.value = true;
}
function setCompared(side: 0 | 1, versionNumber: number) {
  const picked = versions.value.find((version) => version.version === versionNumber);
  const other = side === 0 ? compareHeadId.value : compareBaseId.value;
  if (!picked || picked.id === other) return;
  if (side === 0) compareBaseId.value = picked.id;
  else compareHeadId.value = picked.id;
  compareIds.value = [compareBaseId.value, compareHeadId.value];
}
function swapCompared() {
  [compareBaseId.value, compareHeadId.value] = [compareHeadId.value, compareBaseId.value];
}
function canCompare(row: PromptVersion) {
  return compareIds.value.includes(row.id) || compareIds.value.length < 2;
}
const sourceOptions = [
  { label: t("aiObservability.promptManagement.allSources"), value: "all" },
  ...(["ui", "sdk", "playground", "ci", "agent"] as PromptSource[]).map((value) => ({
    label: raw(value),
    value,
  })),
];

const payloadText = (payload: unknown) =>
  typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
const jsonText = (value: unknown) => (value == null ? "—" : JSON.stringify(value, null, 2));

const versionColumns: OTableColumnDef<PromptVersion>[] = [
  {
    id: "version",
    accessorKey: "version",
    header: t("aiObservability.promptManagement.version"),
    size: 90,
  },
  {
    id: "commitMessage",
    accessorKey: "commitMessage",
    header: t("aiObservability.promptManagement.commitMessage"),
    size: 220,
    meta: { flex: true },
  },
  { id: "labels", header: t("aiObservability.promptManagement.labels"), size: 150 },
  {
    id: "source",
    accessorKey: "source",
    header: t("aiObservability.promptManagement.source"),
    size: 100,
  },
  {
    id: "createdBy",
    accessorKey: "createdBy",
    header: t("aiObservability.promptManagement.form.createdBy"),
    size: 180,
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: t("aiObservability.promptManagement.form.created"),
    size: 120,
  },
  { id: "actions", isAction: true, header: raw(""), accessorKey: "id", size: 56 },
];

function viewVersion(version: number) {
  selectedVersion.value = version;
  activeTab.value = "configuration";
}

function labelsForVersion(version: number): string[] {
  return visibleLabels.value
    .filter((label) => label.version === version)
    .map((label) => label.name);
}

async function confirmProtectedLabel(
  label: string,
  action: "move" | "delete",
  version: number,
): Promise<boolean> {
  if (!props.protectedLabels.includes(label)) return true;
  return confirm({
    title: t("aiObservability.promptManagement.protectedLabelConfirmTitle"),
    message:
      action === "move"
        ? t("aiObservability.promptManagement.protectedLabelMoveMessage", {
            label: raw(label),
            version,
          })
        : t("aiObservability.promptManagement.protectedLabelDeleteMessage", {
            label: raw(label),
            version,
          }),
    confirmLabel:
      action === "move"
        ? t("aiObservability.promptManagement.assign")
        : t("aiObservability.promptManagement.delete"),
  });
}

async function load() {
  const generation = ++loadGeneration;
  if (!props.open || !props.prompt) return;
  const prompt = props.prompt;
  loading.value = true;
  loadError.value = undefined;
  versions.value = [];
  try {
    const loadedVersions = await llmPromptsService.listVersions(props.orgId, prompt.entityId);
    if (generation !== loadGeneration) return;
    versions.value = loadedVersions.sort((left, right) => right.version - left.version);
    const requested = props.initialVersion;
    selectedVersion.value = versions.value.some((version) => version.version === requested)
      ? requested
      : prompt.latestVersion;
  } catch (error: unknown) {
    if (generation !== loadGeneration) return;
    loadError.value = promptErrorText(error, t("aiObservability.promptManagement.loadPromptError"));
  } finally {
    if (generation === loadGeneration) loading.value = false;
  }
}

async function refreshLabels(orgId: string, entityId: string) {
  const prompt = await llmPromptsService.get(orgId, entityId);
  if (props.orgId !== orgId || props.prompt?.entityId !== entityId) return;
  emit("updated", prompt);
}

async function moveLabel(name: string, version: number): Promise<boolean> {
  if (!props.prompt || props.prompt.status !== "active" || labelBusy.value || name === "latest")
    return false;
  const entityId = props.prompt.entityId;
  const orgId = props.orgId;
  const existing = props.prompt.labels.find((label) => label.name === name);
  if (existing?.version === version) return false;
  labelBusy.value = true;
  try {
    if (!(await confirmProtectedLabel(name, "move", version))) return false;
    if (props.orgId !== orgId || props.prompt?.entityId !== entityId) return false;
    await moveLabelMutation.mutateAsync({
      entityId,
      name,
      version,
      ifVersion: existing?.version ?? null,
    });
    await refreshLabels(orgId, entityId);
    toast({
      variant: "success",
      message: t("aiObservability.promptManagement.labelAssigned", { name, version }),
    });
    return true;
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: promptErrorText(error, t("aiObservability.promptManagement.labelMoveError")),
    });
    return false;
  } finally {
    labelBusy.value = false;
  }
}

async function deleteLabel(label: PromptLabel) {
  if (
    !props.prompt ||
    props.prompt.status !== "active" ||
    label.version === null ||
    label.name === "latest" ||
    labelBusy.value
  )
    return;
  const entityId = props.prompt.entityId;
  const orgId = props.orgId;
  labelBusy.value = true;
  try {
    if (
      !(await confirm({
        title: t("aiObservability.promptManagement.removeLabelNamed", { name: label.name }),
        message: props.protectedLabels.includes(label.name)
          ? t("aiObservability.promptManagement.protectedLabelDeleteMessage", {
              label: label.name,
              version: label.version,
            })
          : t("aiObservability.promptManagement.removeLabelHelp", {
              name: label.name,
              version: label.version,
            }),
        confirmLabel: t("aiObservability.promptManagement.delete"),
      }))
    )
      return;
    if (props.orgId !== orgId || props.prompt?.entityId !== entityId) return;
    await deleteLabelMutation.mutateAsync({ entityId, name: label.name, ifVersion: label.version });
    await refreshLabels(orgId, entityId);
    toast({
      variant: "success",
      message: t("aiObservability.promptManagement.labelDeleteSuccess"),
    });
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: promptErrorText(error, t("aiObservability.promptManagement.labelDeleteError")),
    });
  } finally {
    labelBusy.value = false;
  }
}

watch(
  () => [props.open, props.prompt?.entityId, props.initialTab],
  () => {
    activeTab.value = props.initialTab;
    sourceFilter.value = "all";
    versionSearch.value = "";
    compareIds.value = [];
    comparing.value = false;
  },
  { immediate: true },
);
watch(
  () => [
    props.open,
    props.orgId,
    props.prompt?.entityId,
    props.prompt?.latestVersion,
    props.initialVersion,
  ],
  load,
  { immediate: true },
);
</script>
