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
  Compact dependency-chain panel, rendered INLINE inside a list row's expansion
  (OTable #expansion) — the subtle, in-context alternative to a canvas/drawer.
  Given one focused entity (template / destination / alert), it lists that
  entity's chain grouped by kind: Templates · Destinations (with alert counts) ·
  Alerts (paged 10 at a time, so a destination feeding thousands stays usable).
  Each row has Open (go to its page) + Delete (real API, 409 "used by" guard).
  Data is fetched via useDependencyGraph and reduced with buildFocusChain.
-->
<template>
  <div class="px-page-edge py-3 text-left" data-test="dependency-chain-panel">
    <div
      v-if="loading"
      class="text-text-secondary flex items-center gap-2 py-2 text-sm"
      data-test="dependency-chain-loading"
    >
      <OSpinner size="sm" />
      {{ t("alert_dependencies.loading") }}
    </div>

    <OBanner
      v-else-if="error"
      variant="error"
      icon="error"
      :content="t('alert_dependencies.failedToLoad', { error })"
      data-test="dependency-chain-error"
    />

    <div
      v-else-if="isEmpty"
      class="text-text-muted py-2 text-sm"
      data-test="dependency-chain-empty"
    >
      {{ t("alert_dependencies.noDependencies") }}
    </div>

    <div v-else class="flex flex-col gap-3">
      <!-- Templates -->
      <section v-if="chain.templates.length" data-test="dependency-chain-templates">
        <div class="text-text-muted text-2xs mb-1 uppercase">
          {{ t("alert_dependencies.kind.template") }}
        </div>
        <div class="flex flex-col gap-1">
          <DependencyRow
            v-for="n in chain.templates"
            :key="n.id"
            :node="n"
            @open="openEntity"
            @delete="requestDelete"
          />
        </div>
      </section>

      <!-- Destinations (with alert counts) -->
      <section v-if="chain.destinations.length" data-test="dependency-chain-destinations">
        <div class="text-text-muted text-2xs mb-1 uppercase">
          {{ t("alert_dependencies.kind.destination") }}
        </div>
        <div class="flex flex-col gap-1">
          <DependencyRow
            v-for="n in chain.destinations"
            :key="n.id"
            :node="n"
            :count="n.alerts.length"
            @open="openEntity"
            @delete="requestDelete"
          />
        </div>
      </section>

      <!-- Alerts (paged) -->
      <section v-if="chain.alerts.length" data-test="dependency-chain-alerts">
        <div class="text-text-muted text-2xs mb-1 flex items-center justify-between uppercase">
          <span>{{ t("alert_dependencies.alertsCount", { total: chain.alerts.length }) }}</span>
          <div v-if="chain.alerts.length > pageSize" class="flex items-center gap-1">
            <OButton
              variant="ghost"
              size="icon-xs"
              :disabled="alertPage === 0"
              data-test="dependency-chain-prev"
              @click="alertPage = Math.max(0, alertPage - 1)"
            >
              <OIcon name="chevron-left" size="sm" />
            </OButton>
            <span class="text-text-secondary text-2xs normal-case tabular-nums">
              {{
                t("alert_dependencies.pageRange", {
                  from: pageStart + 1,
                  to: pageEnd,
                  total: chain.alerts.length.toLocaleString(),
                })
              }}
            </span>
            <OButton
              variant="ghost"
              size="icon-xs"
              :disabled="pageEnd >= chain.alerts.length"
              data-test="dependency-chain-next"
              @click="alertPage = alertPage + 1"
            >
              <OIcon name="chevron-right" size="sm" />
            </OButton>
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <DependencyRow
            v-for="n in pagedAlerts"
            :key="n.id"
            :node="n"
            @open="openEntity"
            @delete="requestDelete"
          />
        </div>
      </section>
    </div>

    <ConfirmDialog
      v-model="confirmDelete.visible"
      :title="t('alert_dependencies.deleteTitle', { name: confirmDelete.node?.name || '' })"
      :message="t('alert_dependencies.deleteMessage')"
      @update:ok="performDelete"
      @update:cancel="cancelDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18nTyped, raw } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import ConfirmDialog from "../ConfirmDialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import alertsService from "@/services/alerts";
import useDependencyGraph, { buildFocusChain } from "@/composables/alerts/useDependencyGraph";
import type { DepNode, DepFocus } from "@/composables/alerts/useDependencyGraph";
import DependencyRow from "./DependencyRow.vue";

const props = defineProps<{ focus: DepFocus }>();
const emit = defineEmits<{
  // A node was deleted — the parent list should refresh its own table.
  (e: "deleted"): void;
  // The focused entity is gone — the parent should collapse this row.
  (e: "close"): void;
}>();

const pageSize = 10;

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { graph, loading, error, loadGraph } = useDependencyGraph();

const alertPage = ref(0);
const confirmDelete = ref<{ visible: boolean; node: DepNode | null }>({
  visible: false,
  node: null,
});

const org = () => store.state.selectedOrganization.identifier;

const refresh = async () => {
  await loadGraph(org());
};

onMounted(refresh);
// Re-target when the row (focus) changes without a remount.
watch(
  () => props.focus,
  () => {
    alertPage.value = 0;
    refresh();
  },
);

const chain = computed(() => buildFocusChain(graph.value, props.focus));
const isEmpty = computed(
  () =>
    !chain.value.templates.length && !chain.value.destinations.length && !chain.value.alerts.length,
);

const pageStart = computed(() => alertPage.value * pageSize);
const pageEnd = computed(() => Math.min(pageStart.value + pageSize, chain.value.alerts.length));
const pagedAlerts = computed(() => chain.value.alerts.slice(pageStart.value, pageEnd.value));

const openEntity = (n: DepNode) => {
  if (n.missing) return;
  const org_identifier = org();
  if (n.kind === "destination") {
    router.push({
      name: "alertDestinations",
      query: { action: "update", name: n.name, org_identifier },
    });
  } else if (n.kind === "template") {
    router.push({
      name: "alertTemplates",
      query: { action: "update", name: n.name, org_identifier },
    });
  } else if (n.kind === "alert" && n.alertId) {
    router.push({
      name: "alertDetail",
      params: { alert_id: n.alertId },
      query: { org_identifier, ...(n.folderId ? { folder: n.folderId } : {}) },
    });
  }
};

const requestDelete = (n: DepNode) => {
  confirmDelete.value = { visible: true, node: n };
};
const cancelDelete = () => {
  confirmDelete.value = { visible: false, node: null };
};
const performDelete = async () => {
  const n = confirmDelete.value.node;
  confirmDelete.value = { visible: false, node: null };
  if (!n) return;
  const org_identifier = org();
  try {
    if (n.kind === "destination") {
      await destinationService.delete({ org_identifier, destination_name: n.name });
    } else if (n.kind === "template") {
      await templateService.delete({ org_identifier, template_name: n.name });
    } else if (n.kind === "alert" && n.alertId) {
      await alertsService.delete_by_alert_id(org_identifier, n.alertId, n.folderId);
    } else {
      return;
    }
    toast({ variant: "success", message: t("alert_dependencies.deletedToast", { name: n.name }) });
    await refresh();
    emit("deleted");
    // If the row's own entity is gone, collapse it.
    if (!chain.value.focusNode) emit("close");
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        raw(err?.response?.data?.message) ||
        t("alert_dependencies.deleteFailedToast", { name: n.name }),
    });
  }
};
</script>
