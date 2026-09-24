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
        <OTab name="compare" :label="t('aiObservability.promptManagement.compare')" />
        <OTab name="traffic" :label="t('aiObservability.promptManagement.traffic')" />
      </OTabs>

      <div class="min-h-0 flex-1 overflow-auto p-5">
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
          <div class="flex flex-col gap-5">
            <section>
              <h4 class="text-text-heading mb-2 text-sm font-semibold">
                {{ t("aiObservability.promptManagement.prompt") }}
              </h4>
              <pre
                class="rounded-default border-border-default bg-surface-base max-h-96 overflow-auto border p-3 font-mono text-xs whitespace-pre-wrap"
                >{{ payloadText(activeVersion.payload) }}</pre>
            </section>
            <section>
              <h4 class="text-text-heading mb-2 text-sm font-semibold">
                {{ t("aiObservability.promptManagement.configuration") }}
              </h4>
              <dl class="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                <dt class="text-text-secondary">
                  {{ t("aiObservability.promptManagement.promptId") }}
                </dt>
                <dd class="font-mono break-all">{{ prompt.entityId }}</dd>
                <dt class="text-text-secondary">
                  {{ t("aiObservability.promptManagement.versionId") }}
                </dt>
                <dd class="font-mono break-all">{{ activeVersion.id }}</dd>
                <dt class="text-text-secondary">
                  {{ t("aiObservability.promptManagement.model") }}
                </dt>
                <dd>{{ activeVersion.config.model || raw("—") }}</dd>
                <dt class="text-text-secondary">
                  {{ t("aiObservability.promptManagement.parameters") }}
                </dt>
                <dd>
                  <OCode block>{{ jsonText(activeVersion.config.params) }}</OCode>
                </dd>
                <dt class="text-text-secondary">
                  {{ t("aiObservability.promptManagement.tools") }}
                </dt>
                <dd>
                  <OCode block>{{ jsonText(activeVersion.config.tools) }}</OCode>
                </dd>
                <dt class="text-text-secondary">
                  {{ t("aiObservability.promptManagement.responseFormat") }}
                </dt>
                <dd>
                  <OCode block>{{ jsonText(activeVersion.config.responseFormat) }}</OCode>
                </dd>
              </dl>
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
            @view-version="viewVersion"
          />
          <div class="mt-6">
            <section>
              <h4 class="text-text-heading mb-2 text-sm font-semibold">
                {{ t("aiObservability.promptManagement.activity") }}
              </h4>
              <div v-if="!activity.length" class="text-text-secondary text-xs">
                {{ t("aiObservability.promptManagement.noLabelActivity") }}
              </div>
              <div
                v-for="entry in activity"
                :key="entry.id"
                class="border-b-border-default flex gap-2 border-b py-2 text-xs"
              >
                <span class="font-medium">{{ entry.label }}</span>
                <span class="text-text-secondary">{{ activityTransition(entry) }}</span>
                <span class="text-text-secondary ms-auto truncate" :title="entry.actor">{{
                  entry.actor
                }}</span>
                <OTimeCell :value="entry.createdAt" unit="ms" mode="relative" />
              </div>
            </section>
          </div>
        </template>

        <template v-else-if="activeTab === 'versions'">
          <div class="mb-3 flex justify-end">
            <OSelect
              v-model="sourceFilter"
              :options="sourceOptions"
              label-key="label"
              value-key="value"
              width="sm"
              :label="t('aiObservability.promptManagement.source')"
              label-position="inside"
            />
          </div>
          <OEmptyState
            v-if="!filteredVersions.length"
            size="block"
            :title="t('aiObservability.promptManagement.noVersionsForSource')"
          />
          <div class="flex flex-col gap-2">
            <article
              v-for="version in filteredVersions"
              :key="version.id"
              class="rounded-default border-border-default bg-surface-base flex items-start gap-3 border p-3"
            >
              <OButton variant="ghost" size="sm" @click="viewVersion(version.version)">
                {{
                  t("aiObservability.promptManagement.versionNumber", { version: version.version })
                }}
              </OButton>
              <div class="min-w-0 flex-1">
                <OTimeCell :value="version.createdAt" unit="ms" mode="relative" />
                <div class="text-text-heading text-sm">{{ version.commitMessage }}</div>
                <div class="text-text-secondary mt-1 text-xs">
                  {{ version.source }}{{ raw(" · ") }}{{ version.createdBy
                  }}<template v-if="version.baseVersion">{{
                    t("aiObservability.promptManagement.fromVersion", {
                      version: version.baseVersion,
                    })
                  }}</template>
                </div>
              </div>
              <div class="flex flex-wrap justify-end gap-1">
                <OTag
                  v-for="label in labelsForVersion(version.version)"
                  :key="label"
                  variant="default-soft"
                  >{{ label }}</OTag
                >
                <OButton variant="ghost" size="xs" @click="emit('open-playground', version)">
                  {{ t("aiObservability.promptManagement.playground") }}
                </OButton>
              </div>
            </article>
          </div>
        </template>

        <template v-else-if="activeTab === 'compare'">
          <OEmptyState
            v-if="versions.length < 2"
            size="block"
            :title="t('aiObservability.promptManagement.compareNeedsVersions')"
          />
          <div v-else class="mb-4 grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <OSelect
              v-model="compareFrom"
              :label="t('aiObservability.promptManagement.compareFrom')"
              :options="versionOptions"
              data-test="prompt-compare-from"
            />
            <OSelect
              v-model="compareTo"
              :label="t('aiObservability.promptManagement.compareTo')"
              :options="versionOptions.filter((option) => option.value !== compareFrom)"
              data-test="prompt-compare-to"
            />
          </div>
          <PromptVersionDiff
            v-if="compared[0] && compared[1]"
            :left="compared[0]"
            :right="compared[1]"
          />
          <PromptVersionScoreComparison
            v-if="comparisonVersionNumbers"
            :org-id="orgId"
            :prompt-id="prompt.entityId"
            :versions="comparisonVersionNumbers"
          />
        </template>

        <template v-else-if="activeTab === 'traffic'">
          <slot name="traffic" :version="activeVersion" />
        </template>
      </div>
    </div>

    <template v-if="prompt" #footer>
      <div class="flex w-full items-center justify-between">
        <OTag variant="default-soft">{{
          prompt.status === "active"
            ? t("aiObservability.promptManagement.active")
            : t("aiObservability.promptManagement.archived")
        }}</OTag>
        <OButton
          v-if="prompt.status === 'active'"
          variant="outline"
          size="sm"
          @click="emit('archive')"
        >
          {{ t("aiObservability.promptManagement.archivePrompt") }}
        </OButton>
      </div>
    </template>
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
import OCode from "@/lib/core/Code/OCode.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import PromptLabelsPanel from "./PromptLabelsPanel.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import llmPromptsService, {
  type Prompt,
  type PromptActivity,
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
  archive: [];
  "open-playground": [version: PromptVersion];
}>();

const versions = ref<PromptVersion[]>([]);
const activity = ref<PromptActivity[]>([]);
const loading = ref(false);
const loadError = ref<I18nText>();
const activeTab = ref("configuration");
const selectedVersion = ref<number | null>(null);
const sourceFilter = ref<PromptSource | "all">("all");
const compareFrom = ref<number | null>(null);
const compareTo = ref<number | null>(null);
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
const filteredVersions = computed(() =>
  sourceFilter.value === "all"
    ? versions.value
    : versions.value.filter((version) => version.source === sourceFilter.value),
);
const compared = computed(() =>
  compareFrom.value !== compareTo.value
    ? [compareFrom.value, compareTo.value]
        .map((number) => versions.value.find((version) => version.version === number))
        .filter((version): version is PromptVersion => Boolean(version))
    : [],
);
const comparisonVersionNumbers = computed<[number, number] | null>(() =>
  compared.value.length === 2 ? [compared.value[0].version, compared.value[1].version] : null,
);
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

function activityTransition(entry: PromptActivity) {
  if (entry.toVersion === null)
    return t("aiObservability.promptManagement.labelRemovedFrom", {
      version: entry.fromVersion ?? raw("—"),
    });
  if (entry.fromVersion === null)
    return t("aiObservability.promptManagement.labelAssignedTo", { version: entry.toVersion });
  return t("aiObservability.promptManagement.versionTransition", {
    from: entry.fromVersion,
    to: entry.toVersion,
  });
}

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
  activity.value = [];
  try {
    const [loadedVersions, loadedActivity] = await Promise.all([
      llmPromptsService.listVersions(props.orgId, prompt.entityId),
      llmPromptsService.listActivity(props.orgId, prompt.entityId),
    ]);
    if (generation !== loadGeneration) return;
    versions.value = loadedVersions.sort((left, right) => right.version - left.version);
    activity.value = loadedActivity;
    const requested = props.initialVersion;
    selectedVersion.value = versions.value.some((version) => version.version === requested)
      ? requested
      : prompt.latestVersion;
    compareFrom.value = versions.value[1]?.version ?? null;
    compareTo.value = versions.value[0]?.version ?? null;
  } catch (error: unknown) {
    if (generation !== loadGeneration) return;
    loadError.value = promptErrorText(error, t("aiObservability.promptManagement.loadPromptError"));
  } finally {
    if (generation === loadGeneration) loading.value = false;
  }
}

async function refreshLabels(orgId: string, entityId: string) {
  const [prompt, entries] = await Promise.all([
    llmPromptsService.get(orgId, entityId),
    llmPromptsService.listActivity(orgId, entityId),
  ]);
  if (props.orgId !== orgId || props.prompt?.entityId !== entityId) return;
  emit("updated", prompt);
  activity.value = entries;
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
watch(compareFrom, (from) => {
  if (compareTo.value === from)
    compareTo.value = versions.value.find((version) => version.version !== from)?.version ?? null;
});
</script>
