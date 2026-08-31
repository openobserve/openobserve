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
  "Impact" dialog — everything downstream of one entity as a left→right flow of
  card lanes (delivery direction Template → Destination → Alert):
    • a destination shows: this destination → the alerts that use it;
    • a template shows: this template → its destinations → their alerts, with the
      alerts grouped into a box per destination. Clicking or hovering a destination
      highlights its alert box (and vice-versa), so the destination↔alert link is
      visible even though both sides can be many.
  Open jumps to the entity's editor in a NEW TAB; delete is confirmed here.
-->
<template>
  <ODialog
    :open="open"
    :size="isTemplateFocus ? 'lg' : 'sm'"
    :max-height="86"
    @update:open="(v) => emit('update:open', v)"
  >
    <template #header>
      <div class="flex min-w-0 items-center gap-2.5">
        <OIcon
          :name="depKindIcon(focus.kind)"
          size="md"
          :class="depKindColor(focusNode ?? { kind: focus.kind, orphan: false, missing: false })"
        />
        <div class="min-w-0">
          <div class="text-text-heading truncate text-base font-semibold" :title="entityName">
            {{ entityName }}
          </div>
          <div class="text-text-secondary truncate text-xs" :title="impactLabel">
            {{ impactLabel }}
          </div>
        </div>
      </div>
    </template>

    <div class="flex flex-col" data-test="dependency-impact-body">
      <div
        v-if="loading"
        class="text-text-secondary flex h-72 items-center justify-center gap-2 text-sm"
        data-test="dependency-impact-loading"
      >
        <OSpinner size="sm" />
        {{ t("alert_dependencies.loading") }}
      </div>

      <OBanner
        v-else-if="error"
        variant="error"
        icon="error"
        :content="t('alert_dependencies.failedToLoad', { error })"
        data-test="dependency-impact-error"
      />

      <template v-else>
        <OSearchInput
          v-model="search"
          class="mb-3 shrink-0"
          data-test="dependency-impact-search"
          :placeholder="t('alert_dependencies.searchPlaceholder')"
        />

        <div class="flex items-stretch justify-center gap-1" data-test="dependency-impact-flow">
          <!-- Destinations lane (template focus only). -->
          <template v-if="isTemplateFocus">
            <section
              class="flex max-w-96 min-w-0 flex-1 flex-col"
              data-test="dependency-impact-lane-destination"
            >
              <div class="mb-1.5 flex items-center gap-1.5 px-1">
                <OIcon name="location-on" size="sm" class="text-info" />
                <span class="text-text-secondary text-2xs font-semibold tracking-wide uppercase">
                  {{ t("alert_dependencies.sectionDestinations") }}
                </span>
                <OTag type="countChip" value="neutral">{{ chain.destinations.length }}</OTag>
              </div>
              <div
                class="border-border-default bg-surface-panel rounded-surface h-72 space-y-1 overflow-y-auto border p-1.5"
              >
                <div
                  v-if="!filteredDestinations.length"
                  class="text-text-muted flex h-full items-center justify-center px-2 text-center text-xs"
                >
                  {{
                    search ? t("alert_dependencies.noMatches") : t("alert_dependencies.laneEmpty")
                  }}
                </div>
                <div
                  v-for="d in filteredDestinations"
                  :key="d.id"
                  class="rounded-default cursor-pointer transition-colors"
                  :class="isDestHighlighted(d.id) ? 'bg-surface-accent' : ''"
                  :data-test="`dependency-impact-card-${d.name}`"
                  @mouseenter="hoveredDest = d.id"
                  @mouseleave="hoveredDest = null"
                  @click="scrollToGroup(d)"
                >
                  <DependencyEntityRow
                    :node="d"
                    :count="d.usageCount || undefined"
                    :deleting="deletingIds.has(d.id)"
                    no-hover
                    @open="openInNewTab"
                    @delete="requestDelete"
                  />
                </div>
              </div>
            </section>
            <OIcon
              name="chevron-right"
              size="md"
              class="text-text-muted mt-8 shrink-0"
              aria-hidden="true"
            />
          </template>

          <!-- Alerts lane: a box per destination (the group). Capped only in the
               template (multi-lane) layout; on a destination it fills the width so
               it lines up with the full-width search bar above. -->
          <section
            class="flex min-w-0 flex-1 flex-col"
            :class="isTemplateFocus ? 'max-w-96' : ''"
            data-test="dependency-impact-lane-alert"
          >
            <div class="mb-1.5 flex items-center gap-1.5 px-1">
              <OIcon name="shield-alert-outline" size="sm" class="text-status-positive" />
              <span class="text-text-secondary text-2xs font-semibold tracking-wide uppercase">
                {{ t("alert_dependencies.sectionAlerts") }}
              </span>
              <OTag type="countChip" value="neutral">{{ chain.alerts.length }}</OTag>
            </div>
            <div
              class="border-border-default bg-surface-panel rounded-surface h-72 overflow-y-auto border p-1.5"
            >
              <div
                v-if="alertsEmpty"
                class="text-text-muted flex h-full items-center justify-center px-2 text-center text-xs"
              >
                {{ search ? t("alert_dependencies.noMatches") : t("alert_dependencies.laneEmpty") }}
              </div>

              <!-- Destination focus: one destination, so a flat list — no boxes,
                   no highlighting (every alert obviously belongs to it). -->
              <template v-if="!isTemplateFocus">
                <DependencyEntityRow
                  v-for="a in flatAlerts"
                  :key="a.id"
                  :node="a"
                  :deleting="deletingIds.has(a.id)"
                  @open="openInNewTab"
                  @delete="requestDelete"
                />
              </template>

              <!-- Template focus: one box per destination, click/hover to link.
                   The gap lives here (between boxes) so the destination-focus flat
                   list above stays as tight as the rows inside a box. -->
              <div v-else class="space-y-2">
                <div
                  v-for="g in alertGroups"
                  :key="g.dest.id"
                  :ref="(el) => setGroupEl(g.dest.id, el)"
                  class="rounded-default p-1 transition-colors"
                  :class="isBoxFilled(g.dest.id) ? 'bg-surface-accent' : ''"
                  :data-test="`dependency-impact-group-${g.dest.name}`"
                >
                  <!-- Only the destination header drives the box highlight, so
                       hovering a single alert never lights up the whole box. -->
                  <div
                    class="text-text-secondary text-2xs mb-0.5 flex cursor-pointer items-center gap-1 px-1 font-medium"
                    @mouseenter="hoveredDest = g.dest.id"
                    @mouseleave="hoveredDest = null"
                    @click="scrollToGroup(g.dest)"
                  >
                    <OIcon name="location-on" size="xs" class="text-info shrink-0" />
                    <span class="truncate" :title="g.dest.name">{{ g.dest.name }}</span>
                  </div>
                  <!-- Hovering an alert highlights its destination card(s). -->
                  <DependencyEntityRow
                    v-for="a in g.alerts"
                    :key="a.id"
                    :node="a"
                    :deleting="deletingIds.has(a.id)"
                    @mouseenter="hoveredAlert = a.id"
                    @mouseleave="hoveredAlert = null"
                    @open="openInNewTab"
                    @delete="requestDelete"
                  />
                  <div v-if="!g.alerts.length" class="text-text-muted px-2 py-1 text-xs">
                    {{ t("alert_dependencies.laneEmpty") }}
                  </div>
                </div>

                <!-- Alerts that reference the template directly (overrides). -->
                <div v-if="directAlerts.length" data-test="dependency-impact-direct">
                  <div
                    class="text-text-secondary text-2xs flex items-center gap-1 px-1.5 pt-1 font-medium"
                  >
                    <OIcon name="bolt" size="xs" class="text-text-muted shrink-0" />
                    {{ t("alert_dependencies.directOverrides") }}
                  </div>
                  <DependencyEntityRow
                    v-for="a in directAlerts"
                    :key="a.id"
                    :node="a"
                    :deleting="deletingIds.has(a.id)"
                    @open="openInNewTab"
                    @delete="requestDelete"
                  />
                </div>
              </div>
            </div>
          </section>
        </div>
      </template>
    </div>

    <template #footer>
      <div class="flex w-full items-center">
        <OButton
          variant="outline"
          size="sm"
          class="ms-auto"
          data-test="dependency-impact-close"
          @click="emit('update:open', false)"
        >
          {{ t("common.close") }}
        </OButton>
      </div>
    </template>
  </ODialog>

  <ConfirmDialog
    v-model="confirm.visible"
    :title="t('alert_dependencies.deleteTitle', { name: confirm.node?.name || '' })"
    :message="t('alert_dependencies.deleteMessage')"
    @update:ok="performDelete"
    @update:cancel="cancelDelete"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18nTyped, raw } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ConfirmDialog from "../ConfirmDialog.vue";
import DependencyEntityRow from "./DependencyEntityRow.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import alertsService from "@/services/alerts";
import useDependencyGraph, {
  buildFocusChain,
  applyDependencyDeletion,
  depKindIcon,
  depKindColor,
} from "@/composables/alerts/useDependencyGraph";
import type { DepFocus, DepNode, DepNodeKind } from "@/composables/alerts/useDependencyGraph";

const props = defineProps<{ open: boolean; focus: DepFocus }>();
const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "deleted", kind: DepNodeKind): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { graph, loading, error, loadGraph } = useDependencyGraph();

const search = ref("");
const hoveredDest = ref<string | null>(null);
const hoveredAlert = ref<string | null>(null);
const confirm = ref<{ visible: boolean; node: DepNode | null }>({ visible: false, node: null });
const deletingIds = ref(new Set<string>());

const org = () => store.state.selectedOrganization.identifier;

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    search.value = "";
    hoveredDest.value = null;
    hoveredAlert.value = null;
    deletingIds.value.clear();
    loadGraph(org());
  },
  { immediate: true },
);

const isTemplateFocus = computed(() => props.focus.kind === "template");
const chain = computed(() => buildFocusChain(graph.value, props.focus));
const focusNode = computed(() => chain.value.focusNode);
const entityName = computed(() => focusNode.value?.name ?? props.focus.name ?? "");

// Header subtitle: what this entity is used by, downstream. A template names its
// destinations + alerts; a destination names its alerts.
const impactLabel = computed(() => {
  const alerts = t(
    "alert_dependencies.usedBy",
    { count: chain.value.alerts.length },
    chain.value.alerts.length,
  );
  if (!isTemplateFocus.value) return t("alert_dependencies.impactDestination", { alerts });
  const destinations = t(
    "alert_dependencies.countDestinations",
    { count: chain.value.destinations.length },
    chain.value.destinations.length,
  );
  return t("alert_dependencies.impactTemplate", { destinations, alerts });
});

const nameMatches = (name: string) => {
  const term = search.value.trim().toLowerCase();
  return !term || name.toLowerCase().includes(term);
};

// Destination focus: the alerts using it, as a flat list.
const flatAlerts = computed(() => chain.value.alerts.filter((a) => nameMatches(a.name)));

// The ONE filtered set both the Destinations lane and the Alerts lane render, so
// they never disagree: a destination is visible when its own name matches (then
// all its alerts show) OR when any of its alerts match (then only those show).
const alertGroups = computed(() => {
  const hasTerm = !!search.value.trim();
  return chain.value.destinations
    .map((d) => {
      const destHit = nameMatches(d.name);
      const alerts = destHit ? d.alerts : d.alerts.filter((a) => nameMatches(a.name));
      return { dest: d, alerts, show: !hasTerm || destHit || alerts.length > 0 };
    })
    .filter((g) => g.show);
});
const filteredDestinations = computed(() => alertGroups.value.map((g) => g.dest));

// Alerts referencing the template directly (an override), not via any destination.
const directAlerts = computed(() => {
  const viaDest = new Set(chain.value.destinations.flatMap((d) => d.alerts.map((a) => a.id)));
  return chain.value.alerts.filter((a) => !viaDest.has(a.id) && nameMatches(a.name));
});

const alertsEmpty = computed(() =>
  isTemplateFocus.value
    ? alertGroups.value.length === 0 && directAlerts.value.length === 0
    : flatAlerts.value.length === 0,
);

// alert id → the destinations that deliver it (an alert can use several), for the
// reverse highlight: hovering an alert lights up its destination card(s).
const destsOfAlert = computed(() => {
  const m = new Map<string, Set<string>>();
  for (const d of chain.value.destinations)
    for (const a of d.alerts) (m.get(a.id) ?? m.set(a.id, new Set()).get(a.id)!).add(d.id);
  return m;
});
const hoveredAlertDests = computed(() =>
  hoveredAlert.value
    ? (destsOfAlert.value.get(hoveredAlert.value) ?? new Set<string>())
    : new Set<string>(),
);

// Highlight is hover-driven, nothing sticks. A destination CARD lights up when
// hovered directly or when one of its alerts is hovered; the alert BOX fills only
// when the destination itself is hovered (so hovering a single alert never fills
// the whole box).
const isDestHighlighted = (id: string) =>
  hoveredDest.value === id || hoveredAlertDests.value.has(id);
const isBoxFilled = (id: string) => hoveredDest.value === id;

// Group-box elements, keyed by destination id, so a click can scroll the alerts
// lane to the matching box (the highlight is useless if it's below the fold).
const groupEls = new Map<string, HTMLElement>();
const setGroupEl = (id: string, el: unknown) => {
  if (el instanceof HTMLElement) groupEls.set(id, el);
  else groupEls.delete(id);
};
const scrollToGroup = async (dest: DepNode) => {
  await nextTick();
  groupEls.get(dest.id)?.scrollIntoView({ block: "start", behavior: "smooth" });
};

// Every redirection opens the target's editor in a NEW browser tab, so the user
// keeps the impact view (and it sidesteps same-route remount issues entirely).
const openInNewTab = (n: DepNode) => {
  if (n.missing) return;
  const org_identifier = org();
  let route;
  if (n.kind === "destination") {
    route = {
      name: "alertDestinations",
      query: { action: "update", name: n.name, org_identifier },
    };
  } else if (n.kind === "template") {
    route = { name: "alertTemplates", query: { action: "update", name: n.name, org_identifier } };
  } else if (n.kind === "alert" && n.alertId) {
    route = {
      name: "alertDetail",
      params: { alert_id: n.alertId },
      query: { org_identifier, ...(n.folderId ? { folder: n.folderId } : {}) },
    };
  } else {
    return;
  }
  const href = router.resolve(route).href;
  window.open(href, "_blank", "noopener,noreferrer");
};

const requestDelete = (node: DepNode) => {
  confirm.value = { visible: true, node };
};
const cancelDelete = () => {
  confirm.value = { visible: false, node: null };
};
const performDelete = async () => {
  const n = confirm.value.node;
  confirm.value = { visible: false, node: null };
  if (!n) return;
  const org_identifier = org();
  // Read before the prune below: focusNode re-derives from the graph, so once the
  // focused entity is out of it there is nothing left to compare against.
  const deletingFocus = n.id === focusNode.value?.id;
  deletingIds.value.add(n.id);
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
    // Fold the delete into the graph in place. Refetching instead would blank the
    // whole dialog behind its loading spinner and re-run three list calls, which
    // reads as a page reload for what is one row leaving a lane.
    graph.value = applyDependencyDeletion(org_identifier, n.id, graph.value);
    toast({ variant: "success", message: t("alert_dependencies.deletedToast", { name: n.name }) });
    emit("deleted", n.kind);
    // Deleting the focused entity leaves nothing to show; close.
    if (deletingFocus) emit("update:open", false);
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        raw(err?.response?.data?.message) ||
        t("alert_dependencies.deleteFailedToast", { name: n.name }),
    });
  } finally {
    deletingIds.value.delete(n.id);
  }
};
</script>
