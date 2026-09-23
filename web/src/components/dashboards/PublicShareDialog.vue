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
    v-model:open="open"
    data-test="dashboards-public-share-dialog"
    size="sm"
    :title="t('dashboard.publicDashboard.dialogTitle')"
    :secondary-button-label="published ? t('dashboard.publicDashboard.revoke') : t('dashboard.publicDashboard.cancel')"
    :secondary-button-variant="published ? 'destructive' : 'outline'"
    :primary-button-label="published ? t('dashboard.publicDashboard.done') : t('dashboard.publicDashboard.publish')"
    :primary-button-loading="submitting"
    :primary-button-disabled="!published && !form.presets.length"
    @click:secondary="published ? revoke() : (open = false)"
    @click:primary="published ? (open = false) : publish()"
    @show="onShow"
  >
    <div v-if="loading" class="flex justify-center py-8">
      <OSpinner variant="dots" size="lg" />
    </div>

    <div v-else-if="published" class="flex flex-col gap-3">
      <OInput
        :model-value="publicUrl"
        readonly
        :label="t('dashboard.publicDashboard.publicLink')"
        data-test="dashboards-public-share-dialog-link-input"
      />
      <div class="flex justify-end">
        <OButton
          variant="outline"
          size="sm"
          icon-left="content_copy"
          data-test="dashboards-public-share-dialog-copy-btn"
          @click="copyUrl"
        >
          {{ t("dashboard.publicDashboard.copyLink") }}
        </OButton>
      </div>
      <div class="text-xs text-text-secondary">
        {{ t("dashboard.publicDashboard.linkHint") }}
      </div>
    </div>

    <div v-else class="flex flex-col gap-4">
      <OSwitch
        v-model="form.timeEditable"
        :label="t('dashboard.publicDashboard.allowTimeRangeSwitch')"
        data-test="dashboards-public-share-dialog-time-editable-toggle"
      />
      <OSelect
        v-model="form.presets"
        :options="presetOptions"
        multiple
        :label="t('dashboard.publicDashboard.availableRanges')"
        data-test="dashboards-public-share-dialog-presets-select"
      />
      <OSelect
        v-model="form.defaultPreset"
        :options="selectedPresetOptions"
        :label="t('dashboard.publicDashboard.defaultRange')"
        data-test="dashboards-public-share-dialog-default-select"
      />
      <OInput
        v-model.number="form.rebuildSecs"
        type="number"
        :label="t('dashboard.publicDashboard.refreshEvery')"
        data-test="dashboards-public-share-dialog-rebuild-input"
      />
      <div
        v-if="variablesConfig?.list?.length"
        class="flex flex-col gap-1.5"
        data-test="dashboards-public-share-dialog-variables"
      >
        <div class="text-xs text-text-secondary">
          {{ t("dashboard.publicDashboard.defaultVariableValues") }}
        </div>
        <VariablesValueSelector
          :variablesConfig="variablesConfig"
          :selectedTimeDate="timeObj"
          :initialVariableValues="seedValues"
          :showDynamicFilters="false"
          @variablesData="onVariablesData"
        />
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, raw, type I18nText } from "@/types/i18n";
import useNotifications from "@/composables/useNotifications";
import { copyToClipboard } from "@/utils/clipboard";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import VariablesValueSelector from "@/components/dashboards/VariablesValueSelector.vue";
import adminService from "@/services/public_dashboards_admin";

interface PresetOption {
  label: I18nText;
  value: number;
}

const MIN_REBUILD_SECS = 30;
const PRESET_SECONDS = [900, 3600, 21600, 86400, 604800, 2592000];

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    dashboardId: string;
    // The dashboard's variable definitions ({ list: [...] }), the global time
    // range, and the LIVE current selection — seed the in-dialog selector so it
    // opens on the values the author is already viewing (WYSIWYG), editable
    // before publish.
    variablesConfig?: Record<string, any>;
    timeObj?: Record<string, any>;
    currentValues?: { values?: Array<{ name: string; value: unknown }> };
  }>(),
  { modelValue: false },
);
const emit = defineEmits<{ "update:modelValue": [boolean] }>();

const store = useStore();
const { t } = useI18nTyped();
const { showErrorNotification, showPositiveNotification } = useNotifications();

const loading = ref(false);
const submitting = ref(false);
const published = ref(false);
const slug = ref("");
const liveVariables = ref<{
  values?: Array<{ name: string; value: unknown }>;
} | null>(null);
const form = ref({
  timeEditable: true,
  presets: [3600, 86400] as number[],
  defaultPreset: 3600 as number,
  rebuildSecs: 60,
});

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit("update:modelValue", v),
});

const org = computed(() => store.state.selectedOrganization?.identifier ?? "");
// Reshape the live selection ([{name,value}]) into the selector's expected
// { value: { name: value } } seed, so it opens on the current values.
const seedValues = computed(() => ({
  value: (props.currentValues?.values ?? []).reduce<Record<string, unknown>>(
    (m, v) => {
      if (v?.name != null) m[v.name] = v.value;
      return m;
    },
    {},
  ),
}));
const presetOptions = computed<PresetOption[]>(() =>
  PRESET_SECONDS.map((value) => ({ value, label: presetLabel(value) })),
);
const selectedPresetOptions = computed<PresetOption[]>(() =>
  presetOptions.value.filter((o) => form.value.presets.includes(o.value)),
);
const publicUrl = computed(() =>
  slug.value
    ? `${window.location.origin}/web/public/dashboards/${slug.value}`
    : "",
);

function presetLabel(secs: number): I18nText {
  const range =
    secs % 86400 === 0
      ? `${secs / 86400}d`
      : secs % 3600 === 0
        ? `${secs / 3600}h`
        : `${secs / 60}m`;
  return t("dashboard.publicDashboard.past", { range: raw(range) });
}

const onVariablesData = (d: { values?: Array<{ name: string; value: unknown }> }) => {
  liveVariables.value = d;
};

// The selector emits a `.values` array of {name,value}; freeze those as the
// snapshot the public link renders.
function normalizeVars(v: unknown): Record<string, unknown> {
  const list = Array.isArray(v)
    ? v
    : (v as { values?: Array<{ name: string; value: unknown }> })?.values;
  if (Array.isArray(list)) {
    return list.reduce<Record<string, unknown>>((m, item) => {
      if (item?.name != null) m[item.name] = item.value;
      return m;
    }, {});
  }
  return v && typeof v === "object" ? { ...(v as Record<string, unknown>) } : {};
}

const onShow = async () => {
  loading.value = true;
  published.value = false;
  slug.value = "";
  liveVariables.value = null;
  try {
    const res = await adminService.get(org.value, props.dashboardId);
    if (res?.data?.slug) {
      slug.value = res.data.slug;
      published.value = true;
    }
  } catch {
    // 404 = not yet published; show the publish form.
  } finally {
    loading.value = false;
  }
};

const publish = async () => {
  submitting.value = true;
  try {
    const presets = form.value.presets.slice().sort((a, b) => a - b);
    const def = presets.includes(form.value.defaultPreset)
      ? form.value.defaultPreset
      : presets[0];
    const res = await adminService.publish(org.value, props.dashboardId, {
      visibility: "public",
      time_range: {
        editable: form.value.timeEditable,
        default_range_secs: def,
        allowed_presets_secs: presets,
      },
      // Fall back to the current selection if the selector hasn't emitted yet
      // (publish clicked while query-driven options were still loading).
      frozen_variables: normalizeVars(liveVariables.value ?? props.currentValues),
      rebuild_secs: Math.max(
        MIN_REBUILD_SECS,
        Number(form.value.rebuildSecs) || MIN_REBUILD_SECS,
      ),
    });
    slug.value = res?.data?.slug ?? "";
    published.value = true;
    showPositiveNotification(t("dashboard.publicDashboard.publishedToast"));
  } catch (e: unknown) {
    showErrorNotification(
      raw((e as { response?: { data?: { message?: string } } })?.response?.data?.message) ||
        t("dashboard.publicDashboard.publishFailed"),
    );
  } finally {
    submitting.value = false;
  }
};

const revoke = async () => {
  try {
    await adminService.revoke(org.value, props.dashboardId);
    published.value = false;
    slug.value = "";
    showPositiveNotification(t("dashboard.publicDashboard.revokedToast"));
  } catch {
    showErrorNotification(t("dashboard.publicDashboard.revokeFailed"));
  }
};

const copyUrl = () => {
  copyToClipboard(publicUrl.value);
  showPositiveNotification(t("dashboard.publicDashboard.linkCopied"));
};
</script>
