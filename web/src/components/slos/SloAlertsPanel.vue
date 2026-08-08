<!--
  Copyright 2026 OpenObserve Inc.

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
  An SLO's alerts, on the SLO page (Feature 5, Phase 1.2).

  A LIST, not a single slot: multi-window burn-rate alerting is the standard
  pattern, so one SLO commonly carries a fast-burn pager and a slow-burn
  ticket. Disabled alerts appear here too — this is the only place they can be
  re-enabled, and disabling is how a burn-window slot is freed.
-->
<template>
  <div class="flex flex-col gap-4" data-test="slo-alerts-panel">
    <div class="flex items-center justify-between">
      <span class="text-sm font-medium">{{ t("slos.alerts.title") }}</span>
      <OButton size="sm-action" @click="startCreate" data-test="slo-alerts-add">
        {{ t("slos.alerts.add") }}
      </OButton>
    </div>

    <OBanner v-if="loadError" variant="error" data-test="slo-alerts-error">
      {{ loadError }}
    </OBanner>

    <div v-if="editorOpen" class="border-border-default rounded-surface border p-4">
      <SloAlertForm
        :slo="slo"
        :alert-id="editingId"
        @saved="onSaved"
        @cancel="closeEditor"
        @load-error="onLoadError"
      />
    </div>

    <div
      v-else-if="!alerts.length"
      class="text-text-secondary flex flex-col gap-1 py-6 text-center"
      data-test="slo-alerts-empty"
    >
      <span class="text-sm font-medium">{{ t("slos.alerts.emptyTitle") }}</span>
      <span class="text-compact">{{ t("slos.alerts.emptyHint") }}</span>
    </div>

    <ul v-else class="flex flex-col gap-2" data-test="slo-alerts-list">
      <li
        v-for="a in alerts"
        :key="a.alert_id"
        class="border-border-default rounded-default flex items-center justify-between border px-3 py-2"
        :data-test="`slo-alerts-row-${a.alert_id}`"
      >
        <div class="flex min-w-0 flex-col">
          <span class="truncate text-sm font-medium">{{ a.name }}</span>
          <span class="text-compact text-text-secondary">{{ describe(a) }}</span>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <OTag v-if="!a.enabled" data-test="slo-alerts-disabled-tag">
            {{ t("slos.alerts.disabled") }}
          </OTag>
          <OButton
            variant="outline"
            size="sm-action"
            @click="startEdit(a.alert_id)"
            :data-test="`slo-alerts-edit-${a.alert_id}`"
          >
            {{ t("common.edit") }}
          </OButton>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import SloAlertForm from "@/components/slos/SloAlertForm.vue";
import alertsService from "@/services/alerts";
import type { Slo } from "@/ts/interfaces/slo";
import { burnWindowLabel } from "@/utils/alerts/sloAlertPayload";

const props = defineProps<{ slo: Slo; editAlertId?: string | null }>();

const emit = defineEmits<{
  /** The deep link named an alert that is not on this SLO. */
  (e: "edit-target-missing"): void;
  /** The editor closed; the page should drop `edit_alert` from the URL. */
  (e: "close-editor"): void;
}>();

const { t } = useI18n();
const store = useStore();

const org = computed(() => store.state.selectedOrganization?.identifier);
const alerts = ref<any[]>([]);
const loadError = ref("");
const editorOpen = ref(false);
const editingId = ref<string | null>(null);

const describe = (a: any) => {
  const c = a?.condition?.slo_condition ?? {};
  if (c.kind === "error_budget") {
    return t("slos.alerts.describeBudget", { critical: c.critical });
  }
  return t("slos.alerts.describeBurn", {
    critical: c.critical,
    long: c.long_window_secs ? burnWindowLabel(c.long_window_secs) : "—",
    short: c.short_window_secs ? burnWindowLabel(c.short_window_secs) : "—",
  });
};

const load = async () => {
  loadError.value = "";
  try {
    const res = await alertsService.list_by_slo(org.value, props.slo.id);
    alerts.value = res.data?.list ?? [];
  } catch (e: any) {
    alerts.value = [];
    loadError.value = e?.response?.data?.message || t("slos.alerts.loadFailed");
  }
};

const startCreate = () => {
  editingId.value = null;
  editorOpen.value = true;
};

const startEdit = (id: string) => {
  editingId.value = id;
  editorOpen.value = true;
};

const closeEditor = () => {
  editorOpen.value = false;
  editingId.value = null;
  emit("close-editor");
};

const onSaved = async () => {
  editorOpen.value = false;
  editingId.value = null;
  emit("close-editor");
  await load();
};

const onLoadError = (message: string) => {
  editorOpen.value = false;
  editingId.value = null;
  loadError.value = message;
};

/** Open the deep-linked alert, but only once its row is known to exist.
 *
 *  A stale id must NOT fall through to a create form — saving from one would
 *  add a second alert instead of editing the one the link named. */
const applyDeepLink = () => {
  if (!props.editAlertId) return;
  const found = alerts.value.some((a) => a.alert_id === props.editAlertId);
  if (!found) {
    loadError.value = t("slos.alerts.editTargetMissing");
    emit("edit-target-missing");
    return;
  }
  startEdit(props.editAlertId);
};

// `<script setup>` bindings are private by default: the SLO page's header
// "New alert" button drives this panel through a template ref, so the opener
// has to be exposed explicitly.
defineExpose({ startCreate });

onMounted(async () => {
  await load();
  applyDeepLink();
});

watch(
  () => props.editAlertId,
  async (next) => {
    if (!next) return;
    if (!alerts.value.length) await load();
    applyDeepLink();
  },
);
</script>
