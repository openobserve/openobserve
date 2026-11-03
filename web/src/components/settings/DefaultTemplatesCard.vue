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

<!-- The org's default template per notification kind (`default_templates`), one picker per shipped kind. -->
<template>
  <div v-if="state !== 'forbidden'" class="mt-6" data-test="settings-default-templates">
    <OSeparator class="mb-4" />
    <div class="text-base font-bold">{{ t("settings.defaultTemplates.title") }}</div>
    <div class="text-text-secondary pb-3 text-sm">
      {{ t("settings.defaultTemplates.description") }}
    </div>

    <div
      v-if="state === 'loading'"
      class="flex flex-col gap-2"
      data-test="settings-default-templates-loading"
    >
      <div
        v-for="n in 3"
        :key="n"
        class="bg-surface-panel rounded-default h-9 w-100 max-w-full animate-pulse"
      />
    </div>

    <div
      v-else-if="state === 'error'"
      class="flex items-center gap-2 text-sm"
      role="alert"
      data-test="settings-default-templates-error"
    >
      <span class="text-input-error-text">{{ t("settings.defaultTemplates.loadFailed") }}</span>
      <OButton
        variant="outline"
        size="sm-action"
        data-test="settings-default-templates-retry"
        @click="load"
        >{{ t("common.retry") }}</OButton
      >
    </div>

    <template v-else>
      <div
        v-for="kind in shownKinds"
        :key="kind"
        class="mb-4 flex flex-wrap items-start gap-x-2"
        :data-test="`settings-default-templates-row-${kind}`"
      >
        <div class="flex h-9 w-40 shrink-0 items-center font-semibold">
          {{ t(kindLabelKey(kind)) }}
        </div>
        <div class="min-w-0 flex-1 basis-60">
          <TemplateOverridePicker
            :kind="kind"
            :model-value="values[kind] ?? null"
            :server-error="rowErrors[kind] ?? null"
            @update:model-value="(v) => setRow(kind, v)"
          />
          <div
            v-if="kind === 'incident'"
            class="text-text-secondary pt-1 text-xs"
            data-test="settings-default-templates-incident-help"
          >
            {{ t("settings.defaultTemplates.incidentHelp") }}
          </div>
        </div>
      </div>
      <OButton
        variant="primary"
        size="sm-action"
        :disabled="!dirty"
        :loading="saving"
        data-test="settings-default-templates-save"
        @click="save"
        >{{ t("settings.defaultTemplates.save") }}</OButton
      >
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped } from "@/types/i18n";
import settingsService from "@/services/settings";
import templateService from "@/services/alert_templates";
import TemplateOverridePicker from "@/components/alerts/TemplateOverridePicker.vue";
import { kindLabelKey, type NotificationKind } from "@/utils/alerts/notificationKinds";
import { starterContentSpec } from "@/components/alerts/template-content/contentSpec";

const SETTING_KEY = "default_templates";
// Row order of the card; a kind shows only once its producer renders templates.
const ROW_ORDER: NotificationKind[] = [
  "incident",
  "anomaly",
  "synthetics",
  "downtime",
  "on_call",
  "alert",
];

const { t } = useI18nTyped();
const store = useStore();
const orgId = () => store.state.selectedOrganization.identifier;

const state = ref<"loading" | "ready" | "error" | "forbidden">("loading");
const stored = ref<Record<string, string>>({});
const values = ref<Record<string, string | null>>({});
const rowErrors = ref<Record<string, string>>({});
const shippedKinds = ref<string[]>([]);
const saving = ref(false);

const shownKinds = computed(() => ROW_ORDER.filter((k) => shippedKinds.value.includes(k)));

// The map without cleared rows; a cleared row is omitted, never sent as null.
const nextMap = computed(() => {
  const map: Record<string, string> = {};
  for (const [kind, name] of Object.entries(values.value)) {
    if (name) map[kind] = name;
  }
  return map;
});

const sameMap = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([k, v]) => b[k] === v);

const dirty = computed(() => !sameMap(nextMap.value, stored.value));

const setRow = (kind: NotificationKind, name: string | null) => {
  values.value = { ...values.value, [kind]: name };
  const { [kind]: _, ...rest } = rowErrors.value;
  rowErrors.value = rest;
};

// The preview response's variable groups name the kinds whose stage shipped.
const loadShippedKinds = async () => {
  const res = await templateService.preview({
    org_identifier: orgId(),
    data: { definition: starterContentSpec(), channel: "slack" },
  });
  shippedKinds.value = (res.data?.variable_groups ?? []).map((g: { name: string }) => g.name);
};

const load = async () => {
  state.value = "loading";
  try {
    const [setting] = await Promise.all([
      settingsService.getSetting(orgId(), SETTING_KEY).catch((e: any) => {
        if (e?.response?.status === 404) return { data: null };
        throw e;
      }),
      loadShippedKinds(),
    ]);
    const value = setting?.data?.setting_value;
    const map: Record<string, string> = {};
    if (value && typeof value === "object") {
      for (const [kind, name] of Object.entries(value)) {
        if (typeof name === "string" && name) map[kind] = name;
      }
    }
    stored.value = map;
    values.value = { ...map };
    state.value = "ready";
  } catch (e: any) {
    state.value = e?.response?.status === 403 ? "forbidden" : "error";
  }
};

const save = async () => {
  saving.value = true;
  rowErrors.value = {};
  try {
    await settingsService.setOrgSetting(orgId(), SETTING_KEY, nextMap.value, "alerts");
    stored.value = { ...nextMap.value };
    toast({ variant: "success", message: t("settings.defaultTemplates.saved") });
  } catch (e: any) {
    const message: string = e?.response?.data?.message ?? String(e?.message ?? e);
    // "default_templates.anomaly: ..." names the row the error belongs to.
    const kind = /^default_templates\.(\w+):/.exec(message)?.[1];
    if (kind) {
      rowErrors.value = { [kind]: message };
    } else {
      toast({ variant: "error", message: raw(message) });
    }
  } finally {
    saving.value = false;
  }
};

onMounted(load);

defineExpose({ load, save, values, nextMap, dirty, state });
</script>
