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
          class="w-36"
          size="sm"
          data-test="prompt-detail-version-select"
        />
        <div class="flex min-w-0 flex-1 flex-wrap gap-1">
          <OTag
            v-for="label in visibleLabels"
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
        <OButton
          variant="outline"
          size="sm"
          icon-left="play-arrow"
          data-test="prompt-detail-playground"
          @click="activeVersion && emit('open-playground', activeVersion)"
        >
          {{ t("aiObservability.promptManagement.openInPlayground") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm"
          data-test="prompt-detail-new-version"
          @click="emit('edit', activeVersion)"
        >
          {{ t("aiObservability.promptManagement.newVersion") }}
        </OButton>
      </header>

      <section
        class="border-b-dialog-header-border grid shrink-0 grid-cols-4 gap-2.5 border-b px-5 py-4 max-md:grid-cols-2"
      >
        <div
          v-for="stat in stats"
          :key="stat.label"
          class="rounded-default border-border-default bg-surface-base border px-3 py-2"
        >
          <div class="text-text-secondary text-2xs font-semibold">{{ stat.label }}</div>
          <div class="text-text-heading mt-1 text-lg font-bold tabular-nums">{{ stat.value }}</div>
        </div>
      </section>

      <OTabs v-model="activeTab" bordered class="shrink-0 px-5" data-test="prompt-detail-tabs">
        <OTab name="configuration" :label="t('aiObservability.promptManagement.configuration')" />
        <OTab name="versions" :label="t('aiObservability.promptManagement.versions')" />
        <OTab name="compare" :label="t('aiObservability.promptManagement.compare')" />
        <OTab name="traffic" :label="t('aiObservability.promptManagement.traffic')" />
      </OTabs>

      <div class="min-h-0 flex-1 overflow-auto p-5">
        <div v-if="loading" class="text-text-secondary py-10 text-center">
          {{ t("aiObservability.promptManagement.loadingPrompt") }}
        </div>

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
            <section>
              <div class="mb-2 flex items-center justify-between gap-2">
                <h4 class="text-text-heading m-0 text-sm font-semibold">
                  {{ t("aiObservability.promptManagement.labels") }}
                </h4>
                <OButton variant="outline" size="xs" @click="showLabelEditor = !showLabelEditor">
                  {{ t("aiObservability.promptManagement.manageLabels") }}
                </OButton>
              </div>
              <div
                v-if="showLabelEditor"
                class="rounded-default border-border-default flex flex-col gap-2 border p-3"
              >
                <div class="grid grid-cols-[minmax(0,1fr)_8rem_auto] gap-2">
                  <OInput
                    v-model="labelName"
                    :placeholder="t('aiObservability.promptManagement.labelName')"
                    data-test="prompt-label-name"
                  />
                  <OSelect
                    v-model="labelVersion"
                    :options="versionOptions"
                    label-key="label"
                    value-key="value"
                  />
                  <OButton
                    variant="primary"
                    size="sm"
                    :disabled="!labelName.trim()"
                    @click="moveLabel"
                  >
                    {{ t("aiObservability.promptManagement.assign") }}
                  </OButton>
                </div>
                <div
                  v-for="label in movableLabels"
                  :key="label.name"
                  class="flex items-center gap-2 text-xs"
                >
                  <span class="min-w-0 flex-1">{{
                    t("aiObservability.promptManagement.versionLabel", {
                      name: label.name,
                      version: label.version,
                    })
                  }}</span>
                  <OButton
                    variant="ghost-destructive"
                    size="xs"
                    :disabled="label.name === 'latest'"
                    @click="deleteLabel(label)"
                    >{{ t("aiObservability.promptManagement.delete") }}</OButton
                  >
                </div>
              </div>
            </section>
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
                <span class="text-text-secondary ms-auto">{{ entry.actor }}</span>
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
              class="w-48"
            />
          </div>
          <div class="flex flex-col gap-2">
            <article
              v-for="version in filteredVersions"
              :key="version.id"
              class="rounded-default border-border-default bg-surface-base flex items-start gap-3 border p-3"
            >
              <button
                type="button"
                class="text-accent font-semibold"
                @click="selectedVersion = version.version"
              >
                {{
                  t("aiObservability.promptManagement.versionNumber", { version: version.version })
                }}
              </button>
              <div class="min-w-0 flex-1">
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
          <div class="mb-4 flex items-end gap-2">
            <OSelect
              v-model="compareVersions"
              multiple
              :options="versionOptions"
              label-key="label"
              value-key="value"
              class="max-w-md flex-1"
            />
            <span class="text-text-secondary text-xs">
              {{ t("aiObservability.promptManagement.selectTwoVersions") }}
            </span>
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
        <span class="text-text-secondary text-xs">{{ prompt.status }}</span>
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
import { computed, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { raw, useI18nTyped } from "@/types/i18n";
import llmPromptsService, {
  type Prompt,
  type PromptActivity,
  type PromptLabel,
  type PromptSource,
  type PromptVersion,
} from "@/services/llm-prompts.service";
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
    protectedLabels?: string[];
  }>(),
  { initialVersion: null, protectedLabels: () => [] },
);

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
const activeTab = ref("configuration");
const selectedVersion = ref<number | null>(null);
const sourceFilter = ref<PromptSource | "all">("all");
const compareVersions = ref<number[]>([]);
const showLabelEditor = ref(false);
const labelName = ref("");
const labelVersion = ref<number | null>(null);

const visibleLabels = computed(
  () => props.prompt?.labels.filter((label) => label.version != null) ?? [],
);
const movableLabels = computed(() =>
  visibleLabels.value.filter((label) => label.name !== "latest"),
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
  compareVersions.value.length === 2
    ? compareVersions.value
        .map((number) => versions.value.find((version) => version.version === number))
        .filter((version): version is PromptVersion => Boolean(version))
    : [],
);
const comparisonVersionNumbers = computed<[number, number] | null>(() =>
  compared.value.length === 2 ? [compared.value[0].version, compared.value[1].version] : null,
);
const stats = computed(() => [
  { label: "Versions", value: versions.value.length },
  { label: "Labels", value: visibleLabels.value.length },
  { label: "Latest", value: `v${props.prompt?.latestVersion ?? 0}` },
  { label: "Status", value: props.prompt?.status ?? "—" },
]);
const sourceOptions = [
  { label: raw("All sources"), value: "all" },
  ...(["ui", "sdk", "playground", "ci", "agent"] as PromptSource[]).map((value) => ({
    label: raw(value),
    value,
  })),
];

const payloadText = (payload: unknown) =>
  typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
const jsonText = (value: unknown) => (value == null ? "—" : JSON.stringify(value, null, 2));

function activityTransition(entry: PromptActivity) {
  return t("aiObservability.promptManagement.versionTransition", {
    from: entry.fromVersion ?? raw("—"),
    to: entry.toVersion ?? t("aiObservability.promptManagement.deleted"),
  });
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
  if (!props.open || !props.prompt) return;
  loading.value = true;
  try {
    [versions.value, activity.value] = await Promise.all([
      llmPromptsService.listVersions(props.orgId, props.prompt.entityId),
      llmPromptsService.listActivity(props.orgId, props.prompt.entityId),
    ]);
    versions.value.sort((left, right) => right.version - left.version);
    const requested = props.initialVersion;
    selectedVersion.value = versions.value.some((version) => version.version === requested)
      ? requested
      : props.prompt.latestVersion;
    labelVersion.value = selectedVersion.value;
    compareVersions.value = versions.value.slice(0, 2).map((version) => version.version);
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: raw(error instanceof Error ? error.message : "Failed to load prompt."),
    });
  } finally {
    loading.value = false;
  }
}

async function moveLabel() {
  if (!props.prompt || !labelName.value.trim() || labelVersion.value == null) return;
  const name = labelName.value.trim();
  const version = labelVersion.value;
  const existing = props.prompt.labels.find((label) => label.name === name);
  if (!(await confirmProtectedLabel(name, "move", version))) return;
  if (!props.prompt) return;
  try {
    await llmPromptsService.moveLabel(
      props.orgId,
      props.prompt.entityId,
      name,
      version,
      existing?.version,
    );
    const prompt = await llmPromptsService.get(props.orgId, props.prompt.entityId);
    emit("updated", prompt);
    labelName.value = "";
    toast({ variant: "success", message: raw("Label moved. SDK picks this up within ~60s.") });
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: raw(error instanceof Error ? error.message : "Failed to move label."),
    });
  }
}

async function deleteLabel(label: PromptLabel) {
  if (!props.prompt || label.version == null || label.name === "latest") return;
  if (!(await confirmProtectedLabel(label.name, "delete", label.version))) return;
  if (!props.prompt) return;
  try {
    await llmPromptsService.deleteLabel(
      props.orgId,
      props.prompt.entityId,
      label.name,
      label.version,
    );
    emit("updated", await llmPromptsService.get(props.orgId, props.prompt.entityId));
    toast({ variant: "success", message: raw("Label deleted.") });
  } catch (error: unknown) {
    toast({
      variant: "error",
      message: raw(error instanceof Error ? error.message : "Failed to delete label."),
    });
  }
}

watch(() => [props.open, props.prompt?.entityId, props.initialVersion], load, { immediate: true });
</script>
