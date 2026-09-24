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
  <OForm :form="form" v-slot="{ isSubmitting }" class="h-full w-full" data-test="add-downtime">
    <OPageLayout bleed>
      <template #header>
        <OPageHeader
          class="border-border-default shrink-0 border-b"
          :back="{ label: folderLabel, onClick: goBack, dataTest: 'add-downtime-back' }"
          title-overflow="visible"
        >
          <template #title>
            <OFormInlineEdit
              name="name"
              :placeholder="t('alerts.downtimes.form.namePlaceholder')"
              :aria-label="t('alerts.downtimes.form.nameLabel')"
              :edit-hint="
                autoName.isAuto.value
                  ? t('common.inlineEdit.autoHint')
                  : t('alerts.downtimes.form.renameHint')
              "
              data-test="add-downtime-name"
              @update:model-value="autoName.markManual"
              @commit="autoName.onCommit"
              @cancel="autoName.onCommit"
            />
          </template>
          <template v-if="editStatus" #title-trail>
            <OTag type="downtimeStatus" :value="editStatus" data-test="add-downtime-status" />
          </template>
          <template #subtitle>
            <span class="flex min-w-0 items-center gap-1 leading-normal">
              <span class="whitespace-nowrap">
                {{
                  t("alerts.downtimes.form.modeInFolder", {
                    mode: isEdit
                      ? t("alerts.downtimes.form.editMode")
                      : t("alerts.downtimes.form.newMode"),
                  })
                }}
              </span>
              <InlineSelectFolderDropdown
                v-if="!isEdit"
                variant="inline"
                type="downtimes"
                :model-value="folderId"
                data-test="add-downtime-folder"
                @update:model-value="setFolder"
              />
              <span v-else class="text-text-body min-w-0 truncate font-medium">
                {{ folderLabel }}
              </span>
            </span>
          </template>
          <template #actions>
            <div class="flex gap-2">
              <OButton
                variant="outline"
                size="sm-action"
                :disabled="isSubmitting"
                data-test="add-downtime-cancel"
                @click="goBack"
              >
                {{ t("alerts.downtimes.form.cancel") }}
              </OButton>
              <OButton
                variant="primary"
                size="sm-action"
                type="submit"
                :loading="isSubmitting"
                data-test="add-downtime-save"
                @click="onSaveClick"
              >
                {{ t("alerts.downtimes.form.save") }}
              </OButton>
            </div>
          </template>
        </OPageHeader>
      </template>

      <div v-if="editStatus === 'active'" class="shrink-0 px-3 pt-2">
        <OBanner
          variant="info"
          dense
          :content="t('alerts.downtimes.form.activeBanner')"
          data-test="add-downtime-active-banner"
        />
      </div>

      <div class="flex min-h-0 flex-1 max-lg:flex-col max-lg:overflow-y-auto">
        <div class="flex min-h-0 min-w-0 flex-[6.5] flex-col gap-2 py-2 max-lg:flex-none">
          <div class="bg-card-glass-bg border-border-default shrink-0 border-b px-3 py-2.5">
            <div class="flex items-center gap-3 max-md:flex-col max-md:items-start">
              <div class="rounded-default bg-theme-accent h-4 w-0.75 shrink-0 max-md:hidden" />
              <span class="text-compact font-semibold">
                {{ t("alerts.downtimes.form.appliesTo") }}
              </span>
              <OFormToggleGroup name="modules" type="multiple" data-test="add-downtime-modules">
                <OToggleGroupItem
                  v-for="m in MODULE_ORDER"
                  :key="m"
                  :value="m"
                  size="sm"
                  :icon-left="MODULE_ICONS[m]"
                  :data-test="`add-downtime-module-${m}`"
                >
                  {{ t(MODULE_LABEL_KEYS[m]) }}
                </OToggleGroupItem>
              </OFormToggleGroup>
            </div>
          </div>

          <div class="bg-card-glass-bg mx-2 flex min-h-0 flex-1 flex-col max-lg:flex-none">
            <OToggleGroup
              :model-value="activeTab"
              class="shrink-0"
              data-test="add-downtime-tabs"
              @update:model-value="(v) => (activeTab = v as DowntimeTab)"
            >
              <OToggleGroupItem
                v-for="tab in tabs"
                :key="tab.key"
                :value="tab.key"
                size="sm"
                :icon-left="tab.icon"
                :data-test="`add-downtime-tab-${tab.key}`"
              >
                {{ tab.label }}{{ tab.required ? " *" : "" }}
              </OToggleGroupItem>
            </OToggleGroup>

            <div class="flex-1 overflow-auto p-3 max-lg:flex-none max-lg:overflow-visible">
              <div
                v-show="activeTab === 'targets'"
                data-tab-pane="targets"
                class="flex flex-col gap-3"
              >
                <DowntimeConditionSection v-if="hasIdentityModule" :reset-token="resetToken" />
                <p
                  v-if="values.modules.length === 0"
                  class="text-text-secondary text-sm"
                  data-test="add-downtime-no-module"
                >
                  {{ t("alerts.downtimes.form.noModule") }}
                </p>
                <DowntimeTargetCard
                  v-for="m in chosenModules"
                  :key="m"
                  :module="m"
                  :match-count="matchCounts[m]"
                />
              </div>

              <div v-show="activeTab === 'schedule'" data-tab-pane="schedule">
                <DowntimeScheduleFields />
              </div>

              <div
                v-show="activeTab === 'advanced'"
                data-tab-pane="advanced"
                class="flex flex-col gap-5"
              >
                <OFormTextarea
                  name="reason"
                  :label="t('alerts.downtimes.form.reason')"
                  :help-text="t('alerts.downtimes.form.reasonHelp')"
                  :rows="3"
                  autogrow
                  data-test="add-downtime-reason"
                />
                <div class="flex flex-col gap-1">
                  <OFormCheckbox
                    name="show_banner"
                    :label="t('alerts.downtimes.banner.showBanner')"
                    data-test="add-downtime-show-banner"
                  />
                  <span class="text-text-secondary text-xs">
                    {{ t("alerts.downtimes.banner.showBannerCaption") }}
                  </span>
                </div>
                <div v-if="values.show_banner" class="flex flex-col gap-1">
                  <span class="text-text-label text-xs font-medium">
                    {{ t("alerts.downtimes.banner.preview") }}
                  </span>
                  <OBanner
                    variant="warning"
                    icon="warning"
                    dense
                    data-test="add-downtime-banner-preview"
                  >
                    {{
                      t("alerts.downtimes.banner.previewMessage", {
                        name: values.name || t("alerts.downtimes.form.namePlaceholder"),
                      })
                    }}
                    <template #meta>
                      <span class="text-xs font-medium whitespace-nowrap">
                        {{ countdownText(request.schedule.duration_secs, t) }}
                      </span>
                    </template>
                    <template v-if="bannerCounts.length" #footer>
                      <div class="flex flex-wrap gap-1">
                        <OTag
                          v-for="c in bannerCounts"
                          :key="c.module"
                          type="downtimeTarget"
                          :value="c.module"
                          :label="countChipLabel(c, t)"
                        />
                      </div>
                    </template>
                  </OBanner>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          class="border-border-default flex min-h-0 min-w-0 flex-[3.5] flex-col gap-2 overflow-hidden border-s py-2 max-lg:h-auto max-lg:flex-none max-lg:border-s-0 max-lg:border-t"
        >
          <div class="bg-card-glass-bg flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              class="border-border-default flex shrink-0 items-center border-b px-3 py-2.5 select-none"
            >
              <span class="text-sm font-medium">{{ t("alerts.downtimes.preview.title") }}</span>
            </div>
            <div class="min-h-0 flex-1 overflow-auto">
              <DowntimePreviewPane
                :modules="values.modules"
                :preview="previewQuery.data.value ?? null"
                :loading="previewQuery.isFetching.value"
                :error="previewQuery.isError.value"
              />
            </div>
          </div>
          <div class="bg-card-glass-bg flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              class="border-border-default flex shrink-0 items-center border-b px-3 py-2.5 select-none"
            >
              <span class="text-sm font-medium">
                {{ t("alerts.downtimes.summaryPane.title") }}
              </span>
            </div>
            <div class="min-h-0 flex-1 overflow-auto">
              <DowntimeSummary
                :request="request"
                :folder-label="folderLabel"
                :folder-name="targetFolderName"
                :large-modules="largeModules"
                :needs-confirm="needsConfirm"
              />
            </div>
          </div>
        </div>
      </div>
    </OPageLayout>
  </OForm>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { useAutoName } from "@/composables/useAutoName";
import { useDowntimeItems } from "@/composables/downtimes/useDowntimeItems";
import { foldersQuery } from "@/services/common.queries";
import {
  downtimeDetailQuery,
  downtimePreviewQuery,
  saveDowntimeMutation,
} from "@/services/downtimes.queries";
import type { DowntimeStatus, PreviewRequest, TargetModule } from "@/services/downtimes";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { scrollToFirstError } from "@/lib/forms/Form/scrollToFirstError";
import { useToast } from "@/lib/feedback/Toast/useToast";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { conditionError } from "@/utils/downtimes/conditionRules";
import {
  applyPrefill,
  buildCondition,
  buildDowntimeAutoName,
  buildDowntimeRequest,
  buildTargets,
  defaultDowntimeValues,
  downtimeToFormValues,
  hasIdentity,
  unnarrowedModules,
  type DowntimeFormValues,
} from "@/utils/downtimes/downtimeForm";
import {
  MODULE_ICONS,
  MODULE_LABEL_KEYS,
  MODULE_ORDER,
  type FolderNameFn,
} from "@/utils/downtimes/targetSummary";
import { makeAddDowntimeSchema, tabForPath } from "./AddDowntime.schema";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInlineEdit from "@/lib/forms/InlineEdit/OFormInlineEdit.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import { countChipLabel, countdownText } from "@/utils/downtimes/banner";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import InlineSelectFolderDropdown from "@/components/common/sidebar/InlineSelectFolderDropdown.vue";
import DowntimeConditionSection from "./DowntimeConditionSection.vue";
import DowntimeTargetCard from "./DowntimeTargetCard.vue";
import DowntimeScheduleFields from "./DowntimeScheduleFields.vue";
import DowntimePreviewPane from "./DowntimePreviewPane.vue";
import DowntimeSummary from "./DowntimeSummary.vue";

type DowntimeTab = "targets" | "schedule" | "advanced";

const PREVIEW_DEBOUNCE_MS = 300;

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const orgId = useOrgId();
const { toast } = useToast();

const editId = computed(() =>
  route.name === "editDowntime" ? String(route.params.id ?? "") : "",
);
const duplicateId = computed(() => String(route.query.duplicate ?? ""));
const isEdit = computed(() => !!editId.value);
const sourceId = computed(() => editId.value || duplicateId.value);
const sourceFolder = String(route.query.folder ?? "") || undefined;

const queryList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : String(value ?? "").split(","))
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const prefillModule = MODULE_ORDER.find((m) => m === route.query.module);

const initialValues = (): DowntimeFormValues => {
  const base = defaultDowntimeValues(Date.now(), browserZone);
  const folderId = String(route.query.folder_id ?? "") || base.folder_id;
  return applyPrefill(
    { ...base, folder_id: folderId },
    {
      module: prefillModule,
      ids: queryList(route.query.ids),
      folderIds: queryList(route.query.folder_ids),
      folderId,
    },
  );
};

// ── Lists the page reads ────────────────────────────────────────────────────
const downtimeFolders = useQuery(() =>
  Object.assign(foldersQuery(orgId.value, "downtimes"), { enabled: !!orgId.value }),
);
const alertFolders = useQuery(() =>
  Object.assign(foldersQuery(orgId.value, "alerts"), { enabled: !!orgId.value }),
);
const syntheticFolders = useQuery(() =>
  Object.assign(foldersQuery(orgId.value, "synthetics"), { enabled: !!orgId.value }),
);
const detailQuery = useQuery(() =>
  Object.assign(downtimeDetailQuery(orgId.value, sourceId.value, sourceFolder), {
    enabled: !!orgId.value && !!sourceId.value,
  }),
);

// ── The form ────────────────────────────────────────────────────────────────
const saveMutation = useMutation(() => saveDowntimeMutation(orgId.value));

const initial = initialValues();
// The item lists feed the schema, which the form needs, so they follow the modules through a ref.
const listedModules = ref<TargetModule[]>([...initial.modules]);
const listed = (m: TargetModule) => () => listedModules.value.includes(m);

const itemsByModule = {
  alerts: useDowntimeItems("alerts", listed("alerts")),
  anomaly_detections: useDowntimeItems("anomaly_detections", listed("anomaly_detections")),
  synthetics: useDowntimeItems("synthetics", listed("synthetics")),
  slos: useDowntimeItems("slos", listed("slos")),
} as const;

const itemFolder = (module: TargetModule, id: string) =>
  itemsByModule[module].items.value.find((item) => item.id === id)?.folderId;
const itemName = (module: TargetModule, id: string) =>
  itemsByModule[module].items.value.find((item) => item.id === id)?.name;

const schema = makeAddDowntimeSchema(t, { itemFolder });

const onSubmit = async (submitted: DowntimeFormValues) => {
  const body = buildDowntimeRequest(submitted);
  try {
    await saveMutation.mutateAsync({ id: editId.value || undefined, body });
    toast({
      variant: "success",
      message: isEdit.value
        ? t("toastMessages.downtimes.updated")
        : t("toastMessages.downtimes.created"),
    });
    await router.push({
      name: "downtimes",
      query: { org_identifier: orgId.value, folder: body.folder_id },
    });
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("toastMessages.downtimes.saveFailed"),
    });
  }
};

const form = useOForm<DowntimeFormValues>({
  defaultValues: initial,
  schema,
  onSubmit,
});

const values = form.useStore((s) => s.values);
watch(
  () => values.value.modules,
  (modules) => (listedModules.value = [...modules]),
);
const folderId = computed(() => values.value.folder_id);
const setFolder = (value: string) => form.setFieldValue("folder_id", value || "default");

// Edit and Duplicate load the saved row once; the condition builder remounts on it.
const resetToken = ref(0);
const loadedFrom = ref("");
watch(
  () => detailQuery.data.value,
  (row) => {
    if (!row || loadedFrom.value === sourceId.value) return;
    loadedFrom.value = sourceId.value;
    const loaded = downtimeToFormValues(row);
    if (!isEdit.value) loaded.name = t("alerts.downtimes.copyOf", { name: row.name });
    form.reset(loaded);
    resetToken.value += 1;
  },
  { immediate: true },
);

const editStatus = computed<DowntimeStatus | null>(() =>
  isEdit.value ? (detailQuery.data.value?.status ?? null) : null,
);

// ── Names ───────────────────────────────────────────────────────────────────
const folderNameIn = (list: { folderId: string; name: string }[] | undefined, id: string) =>
  list?.find((f) => f.folderId === id)?.name;

const folderLabel = computed<I18nText>(() =>
  raw(folderNameIn(downtimeFolders.data.value, folderId.value) ?? folderId.value),
);

const targetFolderName: FolderNameFn = (module, id) =>
  folderNameIn(
    module === "synthetics" ? syntheticFolders.data.value : alertFolders.data.value,
    id,
  );

const autoName = useAutoName({
  suggestion: computed(() => buildDowntimeAutoName(values.value, t, itemName, targetFolderName)),
  currentValue: () => String(values.value.name ?? ""),
  apply: (name: string) => form.setFieldValue("name", name),
  enabled: () => !isEdit.value && !duplicateId.value,
});

// ── Modules and tabs ────────────────────────────────────────────────────────
const chosenModules = computed(() =>
  MODULE_ORDER.filter((m) => values.value.modules.includes(m)),
);
const hasIdentityModule = computed(() => chosenModules.value.some(hasIdentity));

const activeTab = ref<DowntimeTab>("targets");
const tabs = computed<{ key: DowntimeTab; label: I18nText; icon: IconName; required: boolean }[]>(
  () => [
    { key: "targets", label: t("alerts.downtimes.form.tabTargets"), icon: "tune", required: true },
    {
      key: "schedule",
      label: t("alerts.downtimes.form.tabSchedule"),
      icon: "schedule",
      required: true,
    },
    {
      key: "advanced",
      label: t("alerts.downtimes.form.tabAdvanced"),
      icon: "settings",
      required: false,
    },
  ],
);

// A failed submit opens the tab that owns the first error, then brings it into view.
const onSaveClick = () => {
  const result = schema.safeParse(form.state.values);
  if (result.success) return;
  activeTab.value = tabForPath((result.error.issues[0]?.path ?? []) as (string | number)[]);
  void nextTick(() => scrollToFirstError());
};

// ── Preview ─────────────────────────────────────────────────────────────────
const previewBody = ref<PreviewRequest | null>(null);
let previewTimer: ReturnType<typeof setTimeout> | undefined;

const previewInput = computed((): PreviewRequest | null => {
  const targets = buildTargets(values.value);
  if (targets.length === 0) return null;
  const condition = buildCondition(values.value);
  if (condition && conditionError(condition)) return null;
  return condition ? { condition, targets } : { targets };
});

watch(
  () => JSON.stringify(previewInput.value),
  () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      previewBody.value = previewInput.value;
    }, PREVIEW_DEBOUNCE_MS);
  },
  { immediate: true },
);

const previewQuery = useQuery(() =>
  Object.assign(
    downtimePreviewQuery(orgId.value, previewBody.value ?? { targets: [] }, folderId.value),
    { enabled: !!orgId.value && !!previewBody.value },
  ),
);

const matchCounts = computed<Record<TargetModule, number | null>>(() => {
  const p = previewQuery.data.value;
  return {
    alerts: p ? p.alerts_total : null,
    anomaly_detections: p ? p.anomalies_total : null,
    synthetics: p ? p.synthetics_total : null,
    slos: p ? p.slos_total : null,
  };
});

const largeModules = computed(() =>
  chosenModules.value.filter((m) => {
    const matched = matchCounts.value[m];
    const all = itemsByModule[m].items.value.length;
    return matched !== null && all > 0 && matched * 2 > all;
  }),
);

const needsConfirm = computed(() => unnarrowedModules(values.value).length > 0);

const bannerCounts = computed(() =>
  chosenModules.value
    .map((module) => ({ module, count: matchCounts.value[module] ?? 0 }))
    .filter((c) => c.count > 0),
);

const request = computed(() => buildDowntimeRequest(values.value));

// ── Navigation ──────────────────────────────────────────────────────────────
const goBack = () =>
  router.push({
    name: "downtimes",
    query: { org_identifier: orgId.value, folder: folderId.value },
  });
</script>
