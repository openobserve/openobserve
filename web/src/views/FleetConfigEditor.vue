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
  <OPageLayout
    :title="raw(name)"
    :subtitle="raw(subtitle)"
    :back="{ label: t('fleet.tabs.configurations'), to: backTo }"
    bleed
    overflow-first
    data-test="fleet-config-editor-page"
  >
    <template #title-trail>
      <OTag
        class="max-md:min-w-0 max-md:shrink-999"
        :variant="modeChip.variant"
        dot
        data-test="fleet-config-editor-mode-chip"
      >
        <span class="max-md:min-w-0 max-md:truncate">{{ modeChip.label }}</span>
      </OTag>
    </template>

    <template #actions-overflow>
      <OButton
        variant="outline"
        size="sm"
        :disabled="!loaded || saving"
        data-test="fleet-config-editor-save"
        @click="save"
      >
        {{ t("fleet.editor.saveDraft") }}
      </OButton>
      <OButton
        v-if="undeployed"
        variant="outline"
        size="sm"
        :disabled="!loaded"
        data-test="fleet-config-editor-publish"
        @click="onPublish"
      >
        {{ t("fleet.editor.publishVersion") }}
      </OButton>
    </template>

    <template #actions>
      <OButton
        v-if="!undeployed"
        variant="primary"
        size="sm"
        :disabled="!loaded"
        data-test="fleet-config-editor-publish"
        @click="onPublish"
      >
        {{ t("fleet.editor.publishVersion") }}
      </OButton>
      <template v-if="undeployed">
        <OButton
          variant="primary"
          size="sm"
          icon-left="rocket-launch"
          data-test="fleet-config-editor-start-rollout"
          @click="rolloutOpen = true"
        >
          <span class="max-md:sr-only">{{ t("fleet.fleets.changeVersion") }}</span>
        </OButton>
      </template>
    </template>

    <template #subnav>
      <div class="px-page-edge flex items-center gap-2 py-2 max-md:flex-wrap">
        <OToggleGroup
          :model-value="mode"
          data-test="fleet-config-editor-mode"
          @update:model-value="(v) => setMode(v as 'visual' | 'yaml')"
        >
          <!-- The disabled item ignores the pointer, so the tooltip hangs off this wrapper's hover target. -->
          <span class="inline-flex">
            <OToggleGroupItem
              value="visual"
              size="sm"
              icon-left="account-tree"
              :disabled="!graph"
              data-test="fleet-config-editor-mode-visual"
            >
              {{ t("fleet.editor.visual") }}
            </OToggleGroupItem>
            <OTooltip v-if="!graph" :content="t('fleet.editor.visualUnavailable')" />
          </span>
          <OToggleGroupItem value="yaml" size="sm" icon-left="code">
            {{ t("fleet.configs.yaml") }}
          </OToggleGroupItem>
        </OToggleGroup>
        <OButton
          variant="outline"
          size="sm"
          icon-left="fact-check"
          :disabled="!loaded"
          data-test="fleet-config-editor-validate"
          @click="validate"
        >
          {{ t("fleet.configs.validate") }}
        </OButton>
        <OTag
          v-if="issues"
          :variant="errorCount ? 'error-soft' : issueCount ? 'warning-soft' : 'success-soft'"
          dot
          :label="
            errorCount
              ? t('fleet.editor.publishBlockedChip', { count: errorCount })
              : issueCount
                ? t('fleet.editor.issues', { count: issueCount })
                : t('fleet.editor.valid')
          "
          data-test="fleet-config-editor-validation"
        />
        <div class="flex-1" />
        <div class="flex items-center gap-1">
          <template v-if="graph">
            <OButton
              v-for="action in iconActions"
              :key="action.id"
              variant="ghost"
              size="icon-sm"
              :icon-left="action.icon"
              :disabled="action.disabled"
              :data-test="`fleet-config-editor-${action.id}`"
              @click="action.run"
            >
              <OTooltip side="bottom" :content="action.label" />
            </OButton>
          </template>
          <OButton
            variant="ghost"
            size="sm"
            icon-left="history"
            data-test="fleet-config-editor-history"
            @click="openPanel('history')"
          >
            {{ t("fleet.collectors.history") }}
          </OButton>
          <OButton
            variant="ghost"
            size="sm"
            icon-left="key"
            data-test="fleet-config-editor-variables"
            @click="openPanel('variables')"
          >
            {{ t("fleet.editor.variablesShort") }}
          </OButton>
          <ODropdown align="end">
            <template #trigger>
              <OButton
                variant="ghost"
                size="sm"
                icon-right="expand-more"
                data-test="fleet-config-editor-more"
              >
                {{ t("fleet.editor.more") }}
              </OButton>
            </template>
            <ODropdownItem
              icon-left="content-copy"
              :disabled="isNew || !loaded"
              data-test="fleet-config-editor-duplicate"
              @select="duplicate"
            >
              {{ t("fleet.editor.duplicate") }}
            </ODropdownItem>
            <ODropdownItem
              variant="destructive"
              icon-left="delete"
              :disabled="isNew || !loaded"
              data-test="fleet-config-editor-delete"
              @select="deleteOpen = true"
            >
              {{ t("fleet.editor.deleteConfig") }}
            </ODropdownItem>
          </ODropdown>
        </div>
      </div>
    </template>

    <div class="relative flex min-h-0 flex-1">
      <FleetComponentPalette
        v-if="graph"
        v-model:collapsed="paletteCollapsed"
        @add="onPaletteAdd"
      />

      <div class="relative min-h-0 min-w-0 flex-1">
        <OEmptyState
          v-if="!loaded && loadForbidden"
          size="block"
          preset="no-access"
          data-test="fleet-config-editor-forbidden"
        />
        <OEmptyState
          v-else-if="!loaded && loadFailed"
          size="block"
          preset="load-error"
          data-test="fleet-config-editor-load-error"
          @action="retryLoad"
        />
        <div
          v-else-if="!loaded"
          class="flex h-full items-center justify-center"
          data-test="fleet-config-editor-loading"
        >
          <OSpinner />
        </div>
        <FleetEditorCanvas
          v-else-if="graph && mode === 'visual'"
          :key="loadedFor ?? ''"
          ref="canvasRef"
          :graph="graph"
          :selected-node="selection?.nodeId ?? null"
          :selected-pipeline="selectedPipeline"
          :issues="issues ?? {}"
          :dirty="dirty"
          @select-node="onSelectNode"
          @select-pipeline="onSelectPipeline"
          @drop="onDrop"
          @add-pipeline="addPipelineOpen = true"
          @clear="clearGraph"
        />
        <div v-else class="bg-surface-panel flex h-full flex-col p-4">
          <FleetCodeEditor
            class="flex-1"
            :code="yamlText"
            language="yaml"
            :filename="raw(`${name}.yaml`)"
            :editable="loaded"
            data-test="fleet-config-editor-yaml"
            @update:code="onYamlEdit"
          />
        </div>
      </div>

      <aside
        v-if="panelOpen"
        class="border-border-default bg-surface-base flex h-full w-96 shrink-0 flex-col border-s max-lg:w-80 max-md:absolute max-md:inset-0 max-md:z-20 max-md:w-full max-md:border-s-0"
        data-test="fleet-config-editor-panel"
      >
        <div class="border-border-default flex shrink-0 items-center border-b pe-2">
          <OTabs v-model="panelTab" dense class="min-w-0 flex-1">
            <OTab
              v-if="graph"
              name="properties"
              :label="t('fleet.editor.properties')"
              data-test="fleet-config-editor-tab-properties"
            />
            <OTab name="history" :label="t('fleet.collectors.history')" />
            <OTab name="variables" :label="t('fleet.editor.variablesShort')" />
          </OTabs>
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="close"
            data-test="fleet-config-editor-panel-close"
            @click="panelOpen = false"
          >
            <OTooltip :content="t('common.close')" />
          </OButton>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <template v-if="panelTab === 'properties'">
            <template v-if="graph">
              <FleetComponentProperties
                v-if="selectedComponent"
                :component="selectedComponent"
                :pipelines="selectedPipelines"
                :pipeline-id="selection?.pipelineId ?? null"
                @update="updateSetting"
                @remove-setting="removeSetting"
                @remove="removeSelected"
              />
              <OEmptyState
                v-else
                size="block"
                icon="account-tree"
                :title="t('fleet.editor.nothingSelected')"
                :description="t('fleet.editor.nothingSelectedHint')"
                hide-action
              />
            </template>
          </template>
          <FleetConfigHistory
            v-else-if="panelTab === 'history'"
            :config-id="isNew ? '' : id"
            :versions="detail?.versions ?? []"
          />
          <FleetConfigVariables v-else :names="variableNames" />
        </div>
      </aside>
    </div>

    <FleetAddPipelineDialog
      v-model:open="addPipelineOpen"
      :existing="graph?.pipelines.map((p) => p.id) ?? []"
      @create="addPipeline"
    />
    <FleetCreateConfigDialog
      v-model:open="createOpen"
      :title="createTitle"
      :yaml="createYaml"
      :initial-id="createId"
      :initial-description="createDescription"
      @created="onCreated"
    />
    <FleetNewRolloutDialog
      v-model:open="rolloutOpen"
      :config="id"
      :to-version="undeployed ?? undefined"
    />
    <ODialog
      v-model:open="publishOpen"
      size="sm"
      :title="t('fleet.editor.publishVersion')"
      :primary-button-label="t('fleet.editor.publish')"
      :primary-button-loading="publishing"
      :secondary-button-label="t('common.cancel')"
      data-test="fleet-config-editor-publish-dialog"
      @click:secondary="publishOpen = false"
      @click:primary="confirmPublish"
    >
      <OInput
        v-model="publishMessage"
        :label="t('fleet.editor.publishMessage')"
        data-test="fleet-config-editor-publish-message"
      />
    </ODialog>
    <ODialog
      v-model:open="deleteOpen"
      size="sm"
      :title="t('fleet.editor.deleteTitle', { name: raw(name) })"
      :primary-button-label="t('fleet.editor.delete')"
      primary-button-variant="destructive"
      :primary-button-loading="deleting"
      :secondary-button-label="t('common.cancel')"
      data-test="fleet-config-editor-delete-dialog"
      @click:secondary="deleteOpen = false"
      @click:primary="deleteConfig"
    >
      <div class="flex flex-col gap-3">
        <OText variant="body">{{ t("fleet.editor.deleteBody") }}</OText>
        <OBanner
          v-if="deleteRefs"
          variant="error"
          dense
          :content="
            t('fleet.editor.deleteInUse', {
              fleets: deleteRefs.fleets,
              collectors: deleteRefs.collectors,
              rollouts: deleteRefs.rollouts,
            })
          "
          data-test="fleet-config-editor-delete-in-use"
        />
      </div>
    </ODialog>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
  type RouteLocationNormalized,
} from "vue-router";
import { useMutation } from "@tanstack/vue-query";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import FleetComponentPalette from "@/components/fleet/editor/FleetComponentPalette.vue";
import FleetEditorCanvas from "@/components/fleet/editor/FleetEditorCanvas.vue";
import FleetComponentProperties from "@/components/fleet/editor/FleetComponentProperties.vue";
import FleetConfigHistory from "@/components/fleet/editor/FleetConfigHistory.vue";
import FleetConfigVariables from "@/components/fleet/editor/FleetConfigVariables.vue";
import FleetAddPipelineDialog from "@/components/fleet/editor/FleetAddPipelineDialog.vue";
import type { GroupIssue } from "@/components/fleet/editor/FleetEditorGroupNode.vue";
import FleetCodeEditor from "@/components/fleet/FleetCodeEditor.vue";
import FleetCreateConfigDialog from "@/components/fleet/FleetCreateConfigDialog.vue";
import FleetNewRolloutDialog from "@/components/fleet/FleetNewRolloutDialog.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import {
  addFromCatalog,
  CATALOG,
  compKey,
  graphToYaml,
  pipelinesUsing,
  seedGraph,
  yamlToGraph,
  type CatalogItem,
  type EditorGraph,
  type EditorKind,
} from "@/components/fleet/editor/editorGraph";
import { fleetLocation } from "@/components/fleet/fleetRoute";
import {
  envVariables,
  isForbidden,
  serverMessage,
  takePendingImport,
  useFleetConfig,
  useFleetConfigVersion,
} from "@/components/fleet/useFleetApi";
import { useOrgId } from "@/composables/query/useOrgId";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import useBreakpoint from "@/composables/useBreakpoint";
import {
  deleteFleetConfigMutation,
  publishFleetConfigVersionMutation,
  saveFleetConfigDraftMutation,
  validateFleetConfigMutation,
} from "@/services/fleet.queries";
import type { FleetConfigIssues, FleetConfigReferences } from "@/services/fleet";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const orgId = useOrgId();
const { confirm } = useConfirmDialog();

const backTo = fleetLocation("configurations", {}, route.query);

const id = computed(() => String(route.params.id ?? ""));
const isNew = computed(() => id.value === "new");

const config = useFleetConfig(
  () => id.value,
  () => !isNew.value,
);
const detail = config.detail;
// A draft wins over the latest version, so the version is only fetched when there is none.
const savedVersion = useFleetConfigVersion(
  () => id.value,
  () => (detail.value && !detail.value.draft ? detail.value.latest_version : null),
  () => !isNew.value,
);

const saveDraftMutation = useMutation(() => saveFleetConfigDraftMutation(orgId.value));
const publishMutation = useMutation(() => publishFleetConfigVersionMutation(orgId.value));
const validateMutation = useMutation(() => validateFleetConfigMutation(orgId.value));
const deleteMutation = useMutation(() => deleteFleetConfigMutation(orgId.value));
const publishing = publishMutation.isPending;
const saving = saveDraftMutation.isPending;
const deleting = deleteMutation.isPending;

const yamlText = ref("");
const loadedFor = ref<string | null>(null);
const graph = ref<EditorGraph | null>(null);
const past = ref<string[]>([]);
const future = ref<string[]>([]);
const dirty = ref(false);
const savedText = ref("");
const mode = ref<"visual" | "yaml">("visual");
const issues = ref<Record<string, GroupIssue[]> | null>(null);
const { isMobile } = useBreakpoint();
const paletteCollapsed = ref(isMobile.value);
const panelOpen = ref(false);
const panelTab = ref("properties");
const selectedPipeline = ref<string | null>(null);
const selection = ref<{ nodeId: string; pipelineId: string | null; key: string } | null>(null);
const addPipelineOpen = ref(false);
const publishOpen = ref(false);
const rolloutOpen = ref(false);
const publishMessage = ref("");
const deleteOpen = ref(false);
const deleteRefs = ref<FleetConfigReferences | null>(null);
watch(deleteOpen, (open) => open || (deleteRefs.value = null));
const createOpen = ref(false);
const createTitle = ref<I18nText>(raw(""));
const createYaml = ref("");
const createId = ref("");
const createDescription = ref("");
const createReplaces = ref(false);
const canvasRef = ref<{
  focusPipeline: (id: string) => void;
  reveal: (nodeId: string) => void;
} | null>(null);

// Until the saved text is in the editor, every action would act on an empty document.
const loaded = computed(() => isNew.value || loadedFor.value === id.value);
const loadForbidden = computed(
  () => isForbidden(config.error.value) || isForbidden(savedVersion.error.value),
);
// A failed background refetch keeps the config that already loaded.
const loadFailed = computed(
  () =>
    (!!config.error.value && !config.detail.value) ||
    (!!savedVersion.error.value && !savedVersion.version.value),
);
const retryLoad = () =>
  Promise.all([
    config.error.value ? config.refetch() : null,
    savedVersion.error.value ? savedVersion.refetch() : null,
  ]);
const name = computed(() => (isNew.value ? "untitled-config" : id.value));
// The code editor emits its text trimmed, so a trailing newline alone is not an edit.
const unsaved = computed(
  () => loaded.value && yamlText.value.trimEnd() !== savedText.value.trimEnd(),
);
let leaveAllowed = false;
const subtitle = computed(() =>
  isNew.value ? t("fleet.editor.newDescription") : (detail.value?.description ?? ""),
);
const savedYaml = computed(
  () => detail.value?.draft?.yaml ?? savedVersion.version.value?.yaml ?? "",
);
const latestVersion = computed(() => detail.value?.versions[0] ?? null);
const undeployed = computed(() =>
  latestVersion.value?.state === "published" ? latestVersion.value.version : null,
);
const variableNames = computed(() => envVariables(yamlText.value));

// The editor always says which of three things you are looking at.
const modeChip = computed<{ variant: BadgeVariant; label: I18nText }>(() => {
  if (isNew.value || dirty.value || detail.value?.draft)
    return { variant: "warning-soft", label: t("fleet.editor.modeDraft") };
  const latest = latestVersion.value;
  if (latest?.state === "rolling_out")
    return {
      variant: "primary-soft",
      label: t("fleet.editor.modeRollingOut", { version: latest.version }),
    };
  if (latest?.state === "published")
    return {
      variant: "default-soft",
      label: t("fleet.editor.modePublished", { version: latest.version }),
    };
  if (detail.value?.live_version)
    return {
      variant: "success-soft",
      label: t("fleet.editor.modeRunning", { version: detail.value.live_version }),
    };
  return { variant: "warning-soft", label: t("fleet.editor.modeDraft") };
});

const errorCount = computed(() =>
  Object.values(issues.value ?? {}).reduce(
    (n, list) => n + list.filter((i) => i.severity === "error").length,
    0,
  ),
);
const issueCount = computed(() =>
  Object.values(issues.value ?? {}).reduce((n, list) => n + list.length, 0),
);

const selectedComponent = computed(() =>
  selection.value && graph.value ? graph.value.components[selection.value.key] : undefined,
);
const selectedPipelines = computed(() =>
  selection.value && graph.value ? pipelinesUsing(graph.value, selection.value.key) : [],
);

const iconActions = computed<
  { id: string; icon: IconName; label: I18nText; disabled?: boolean; run: () => void }[]
>(() => [
  {
    id: "undo",
    icon: "undo",
    label: t("fleet.editor.undo"),
    disabled: !past.value.length,
    run: undo,
  },
  {
    id: "redo",
    icon: "redo",
    label: t("fleet.editor.redo"),
    disabled: !future.value.length,
    run: redo,
  },
]);

type ListField = "receivers" | "processors" | "exporters";
const fieldOf = (kind: EditorKind) => `${kind}s` as ListField;

function loadText(text: string) {
  yamlText.value = text;
  savedText.value = text;
  graph.value = yamlToGraph(text);
  mode.value = graph.value ? "visual" : "yaml";
  leavePropertiesWithoutGraph();
  past.value = [];
  future.value = [];
  dirty.value = false;
  issues.value = null;
  selection.value = null;
  selectedPipeline.value = null;
}

function leavePropertiesWithoutGraph() {
  if (!graph.value && panelTab.value === "properties") panelTab.value = "history";
}

function toGroupIssues(src: FleetConfigIssues): Record<string, GroupIssue[]> {
  return Object.fromEntries(
    Object.entries(src).map(([pipeline, list]) => [
      pipeline,
      list.map((i) => ({ severity: i.severity, text: raw(i.text) })),
    ]),
  );
}

function issueLines(src: Record<string, GroupIssue[]>, severity?: GroupIssue["severity"]) {
  return Object.entries(src).flatMap(([pipeline, list]) =>
    list
      .filter((i) => !severity || i.severity === severity)
      .map((i) =>
        pipeline
          ? t("fleet.editor.pipelineIssue", { pipeline: raw(pipeline), issue: i.text })
          : i.text,
      ),
  );
}

function toastFailure(err: unknown) {
  toast({ variant: "error", message: raw(serverMessage(err)) || t("fleet.common.requestFailed") });
}

function snapshot(): string {
  return JSON.stringify(graph.value);
}

function restore(json: string) {
  const next = JSON.parse(json) as EditorGraph;
  const g = graph.value;
  if (!g) return;
  g.components = next.components;
  g.pipelines = next.pipelines;
  g.extensions = next.extensions;
  yamlText.value = graphToYaml(g);
}

function commit(mutate: (g: EditorGraph) => void) {
  const g = graph.value;
  if (!g || !loaded.value) return;
  past.value.push(snapshot());
  future.value = [];
  mutate(g);
  yamlText.value = graphToYaml(g);
  dirty.value = true;
  issues.value = null;
}

function undo() {
  if (!graph.value || !loaded.value) return;
  const prev = past.value.pop();
  if (!prev) return;
  future.value.push(snapshot());
  restore(prev);
  dirty.value = true;
}

function redo() {
  if (!graph.value || !loaded.value) return;
  const next = future.value.pop();
  if (!next) return;
  past.value.push(snapshot());
  restore(next);
  dirty.value = true;
}

function setMode(next: "visual" | "yaml") {
  if (next === "visual" && !graph.value) return;
  mode.value = next;
}

// The YAML editor echoes its text trimmed, so only a real edit replaces what was loaded.
function onYamlEdit(text: string) {
  if (!loaded.value) return;
  if (text.trim() === yamlText.value.trim()) return;
  yamlText.value = text;
  graph.value = yamlToGraph(text);
  leavePropertiesWithoutGraph();
  past.value = [];
  future.value = [];
  dirty.value = true;
  issues.value = null;
  selection.value = null;
}

function openPanel(tab: string) {
  panelTab.value = tab;
  panelOpen.value = true;
  if (!window.matchMedia("(min-width: 96rem)").matches) paletteCollapsed.value = true;
}

function openCreate(title: I18nText, yaml: string, initialId: string, description: string) {
  createTitle.value = title;
  createYaml.value = yaml;
  createId.value = initialId;
  createDescription.value = description;
  createOpen.value = true;
}

function duplicate() {
  if (isNew.value || !loaded.value) return;
  createReplaces.value = false;
  openCreate(
    t("fleet.configs.duplicateTitle", { name: raw(name.value) }),
    savedYaml.value,
    `${id.value}-copy`,
    detail.value?.description ?? "",
  );
}

function onCreated(newId: string) {
  const target = { name: "fleetConfigEditor", params: { id: newId }, query: route.query };
  if (createReplaces.value) {
    // Saving a new config creates it from this text, so moving to its page loses nothing.
    savedText.value = yamlText.value;
    router.replace(target);
  } else router.push(target);
}

function addToPipeline(item: CatalogItem, pipelineId: string) {
  const pipeline = graph.value?.pipelines.find((p) => p.id === pipelineId);
  if (!pipeline) return;
  commit((g) => {
    const list = pipeline[fieldOf(item.kind)];
    const base = item.idHint ?? item.type;
    const existing = g.components[compKey(item.kind, base)];
    // A base config reference has no settings here, so a palette add needs its own definition.
    const reusable = existing && !existing.base && !list.includes(base);
    const key = reusable ? compKey(item.kind, base) : addFromCatalog(g, item);
    const compId = g.components[key].id;
    if (item.kind !== "processor") list.push(compId);
    else if (item.type === "memory_limiter") list.unshift(compId);
    else if (list[list.length - 1]?.startsWith("batch")) list.splice(list.length - 1, 0, compId);
    else list.push(compId);
  });
  toast({
    variant: "success",
    message: t("fleet.editor.added", { name: raw(item.name), pipeline: raw(pipelineId) }),
  });
}

function addExtension(item: CatalogItem) {
  commit((g) => {
    const existing = g.components[compKey("extension", item.type)];
    const key =
      existing && !existing.base ? compKey("extension", item.type) : addFromCatalog(g, item);
    const extId = g.components[key].id;
    if (!g.extensions.includes(extId)) g.extensions.push(extId);
  });
}

function onPaletteAdd(item: CatalogItem) {
  const g = graph.value;
  if (!g) return;
  if (item.kind === "extension") return addExtension(item);
  const target = selectedPipeline.value ?? (g.pipelines.length === 1 ? g.pipelines[0].id : null);
  if (!target) {
    toast({ variant: "warning", message: t("fleet.editor.selectPipelineFirst") });
    return;
  }
  addToPipeline(item, target);
}

function onDrop(paletteKey: string, pipelineId: string | null) {
  if (!graph.value) return;
  const [kind, key] = paletteKey.split("|");
  const item = CATALOG.find((i) => i.kind === kind && i.key === key);
  if (!item) return;
  if (item.kind === "extension") return addExtension(item);
  if (!pipelineId) {
    toast({ variant: "warning", message: t("fleet.editor.dropOnPipeline") });
    return;
  }
  selectedPipeline.value = pipelineId;
  addToPipeline(item, pipelineId);
}

function onSelectNode(nodeId: string, pipelineId: string | null, key: string) {
  selection.value = selection.value?.nodeId === nodeId ? null : { nodeId, pipelineId, key };
  if (pipelineId) selectedPipeline.value = pipelineId;
  if (!selection.value) return;
  openPanel("properties");
  canvasRef.value?.reveal(nodeId);
}

function onSelectPipeline(pipelineId: string | null) {
  selectedPipeline.value = pipelineId;
  if (!pipelineId) selection.value = null;
}

function updateSetting(key: string, value: string) {
  const comp = selectedComponent.value;
  if (!graph.value || !comp || comp.settings[key] === value) return;
  commit(() => (comp.settings[key] = value));
}

function removeSetting(key: string) {
  const comp = selectedComponent.value;
  if (!graph.value || !comp || !(key in comp.settings)) return;
  commit(() => delete comp.settings[key]);
}

function removeSelected() {
  const sel = selection.value;
  const comp = sel && graph.value?.components[sel.key];
  if (!sel || !comp) return;
  commit((g) => {
    if (comp.kind === "extension") {
      g.extensions = g.extensions.filter((e) => e !== comp.id);
      delete g.components[sel.key];
      return;
    }
    const pipeline = g.pipelines.find((p) => p.id === sel.pipelineId);
    if (pipeline) {
      const field = fieldOf(comp.kind);
      pipeline[field] = pipeline[field].filter((c) => c !== comp.id);
    }
    if (!pipelinesUsing(g, sel.key).length) delete g.components[sel.key];
  });
  selection.value = null;
}

function addPipeline(pipelineId: string) {
  if (!graph.value) return;
  commit((g) => g.pipelines.push({ id: pipelineId, receivers: [], processors: [], exporters: [] }));
  selectedPipeline.value = pipelineId;
}

function clearGraph() {
  if (!graph.value) return;
  commit((g) => {
    g.components = {};
    g.pipelines = g.pipelines.map((p) => ({ ...p, receivers: [], processors: [], exporters: [] }));
    g.extensions = [];
  });
  selection.value = null;
}

async function validate() {
  if (!loaded.value) return;
  const sent = yamlText.value;
  try {
    const res = await validateMutation.mutateAsync({ yaml: sent });
    // Issues for text that was edited since would point at the wrong document.
    if (yamlText.value !== sent) return;
    issues.value = toGroupIssues(res.issues ?? {});
    for (const issue of issues.value[""] ?? []) {
      toast({ variant: issue.severity === "error" ? "error" : "warning", message: issue.text });
    }
  } catch (err) {
    toastFailure(err);
  }
}

function onPublish() {
  if (!loaded.value) return;
  if (isNew.value) {
    toast({ variant: "warning", message: t("fleet.editor.saveNewFirst") });
    return;
  }
  publishMessage.value = "";
  publishOpen.value = true;
}

function showPublishErrors(found: Record<string, GroupIssue[]>) {
  issues.value = found;
  if (!graph.value) {
    // Focusing a pipeline would force Visual mode, which this YAML cannot show.
    for (const line of issueLines(found, "error")) toast({ variant: "error", message: line });
    return;
  }
  const pipeline = Object.entries(found).find(
    ([key, list]) => key && list.some((x) => x.severity === "error"),
  )?.[0];
  if (pipeline) {
    selectedPipeline.value = pipeline;
    mode.value = "visual";
    nextTick(() => canvasRef.value?.focusPipeline(pipeline));
  }
  toast({
    variant: "error",
    message: t("fleet.editor.publishBlocked", { count: errorCount.value }),
  });
}

async function confirmPublish() {
  if (!loaded.value || isNew.value) return;
  const sent = yamlText.value;
  const sentId = id.value;
  try {
    const res = await publishMutation.mutateAsync({
      id: id.value,
      yaml: sent,
      message: publishMessage.value.trim(),
    });
    if (id.value === sentId) savedText.value = sent;
    publishOpen.value = false;
    // The cached detail still carries the cleared draft until this refetch lands.
    const fresh = (await config.refetch()).isSuccess;
    const warnings = toGroupIssues(res.warnings ?? {});
    const count = Object.values(warnings).reduce((n, list) => n + list.length, 0);
    // An edit typed during the request was not published, so neither the clean state nor its warnings apply.
    if (yamlText.value === sent) {
      if (fresh) dirty.value = false;
      issues.value = warnings;
    }
    toast({
      variant: count ? "warning" : "success",
      message: count
        ? t("fleet.editor.publishedWithWarnings", { version: res.version, count }, count)
        : t("fleet.editor.publishedToast", { version: res.version }),
    });
  } catch (err) {
    const response = (err as { response?: { status?: number; data?: { issues?: unknown } } })
      ?.response;
    const found = response?.data?.issues;
    if (response?.status === 422 && found && typeof found === "object") {
      publishOpen.value = false;
      const blocking = toGroupIssues(found as FleetConfigIssues);
      // Issues for text edited since, or for another config, would point at the wrong document.
      if (yamlText.value === sent && id.value === sentId) showPublishErrors(blocking);
      else {
        const count = issueLines(blocking, "error").length;
        toast({ variant: "error", message: t("fleet.editor.publishBlocked", { count }) });
      }
      return;
    }
    toastFailure(err);
  }
}

async function save() {
  if (!loaded.value || saving.value) return;
  if (isNew.value) {
    createReplaces.value = true;
    openCreate(t("fleet.configs.newConfig"), yamlText.value, "", "");
    return;
  }
  try {
    const sent = yamlText.value;
    const sentId = id.value;
    await saveDraftMutation.mutateAsync({ id: sentId, yaml: sent });
    // A reply for a config the user has since left must not mark this one saved.
    if (id.value === sentId) savedText.value = sent;
    // Until the refetch lands, the cached detail may have no draft and the chip would read published.
    const fresh = (await config.refetch()).isSuccess;
    if (fresh && yamlText.value === sent) dirty.value = false;
    toast({ variant: "success", message: t("fleet.editor.draftSaved") });
  } catch (err) {
    toastFailure(err);
  }
}

async function deleteConfig() {
  if (isNew.value || !loaded.value) return;
  deleteRefs.value = null;
  try {
    await deleteMutation.mutateAsync(id.value);
    deleteOpen.value = false;
    toast({ variant: "success", message: t("fleet.editor.deleted", { name: raw(name.value) }) });
    leaveAllowed = true;
    router.push(backTo);
  } catch (err) {
    // A 409 names what still references the configuration, which the counts ignore permissions for.
    const refs = (
      err as { response?: { status?: number; data?: { references?: FleetConfigReferences } } }
    )?.response;
    if (refs?.status === 409 && refs.data?.references) deleteRefs.value = refs.data.references;
    else toastFailure(err);
  }
}

watch(
  id,
  () => {
    loadedFor.value = null;
    if (isNew.value) {
      const imported = takePendingImport();
      loadText(imported ?? graphToYaml(seedGraph()));
      // An imported file exists nowhere else yet, so leaving would lose it.
      if (imported !== null) savedText.value = "";
      loadedFor.value = "new";
    }
  },
  { immediate: true },
);

watch(
  [detail, () => savedVersion.version.value],
  () => {
    const d = detail.value;
    if (isNew.value || loadedFor.value === id.value || !d || d.id !== id.value) return;
    if (!d.draft && d.latest_version > 0 && !savedVersion.version.value) return;
    loadText(savedYaml.value);
    loadedFor.value = id.value;
  },
  { immediate: true },
);

watch(config.error, (err) => {
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  if (status === 404) {
    toast({ variant: "error", message: t("fleet.editor.notFound", { name: raw(id.value) }) });
    router.push(backTo);
  } else if (err && !isForbidden(err)) toastFailure(err);
});

// The http interceptor already reports a 403.
watch(savedVersion.error, (err) => {
  if (err && !isForbidden(err)) toastFailure(err);
});

watch([panelOpen, paletteCollapsed], ([open, collapsed], [wasOpen, wasCollapsed]) => {
  const narrowed = (open && !wasOpen) || (!collapsed && wasCollapsed);
  if (narrowed && selection.value) canvasRef.value?.reveal(selection.value.nodeId);
});

function guardLeave() {
  if (leaveAllowed || !unsaved.value) return true;
  return confirm({
    title: t("common.unsavedChanges"),
    message: t("common.unsavedMessage"),
    confirmLabel: t("common.discardChanges"),
    confirmVariant: "destructive",
    focusCancel: true,
  });
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (unsaved.value) e.preventDefault();
}

onBeforeRouteLeave(guardLeave);
// Another config's page reuses this view, so only an id change leaves the draft.
onBeforeRouteUpdate((to: RouteLocationNormalized, from: RouteLocationNormalized) =>
  to.params.id === from.params.id ? true : guardLeave(),
);
onMounted(() => window.addEventListener("beforeunload", onBeforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", onBeforeUnload));

useShortcuts([
  {
    id: "fleetEditorDeleteNode",
    handler: () => {
      if (!isInputFocused() && selection.value && graph.value) removeSelected();
    },
  },
]);
</script>
