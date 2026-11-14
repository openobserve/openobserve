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
  <section
    v-if="hasItems"
    ref="root"
    :aria-label="t('assistant.threadsBar.label')"
    data-test="threads-bar"
    class="fixed end-[calc((var(--o-tray-end,0)+1.5)*1rem)] bottom-6 z-5000 flex flex-col items-end gap-2 max-md:end-4 max-md:bottom-4"
  >
    <div
      v-if="expanded"
      ref="panel"
      role="dialog"
      :aria-label="t('assistant.threadsBar.label')"
      data-test="threads-bar-panel"
      :class="[
        'bg-surface-base border-border-default rounded-surface grid max-w-[min(100%,calc(100vw-2rem))] gap-4 border p-3 shadow-lg',
        liveIncidents ? 'w-[44rem] grid-cols-2' : 'w-[28rem] grid-cols-1',
      ]"
    >
      <div
        v-if="liveIncidents"
        class="flex min-w-0 flex-col gap-1"
        data-test="threads-bar-incidents"
      >
        <h3 class="text-text-secondary ps-1.5 text-xs font-medium">
          {{
            t("assistant.threadsBar.incidents", { count: incidents.shown.length + incidents.more })
          }}
        </h3>
        <ul class="flex flex-col">
          <li v-for="incident in incidents.shown" :key="incident.id" class="min-w-0">
            <OButton
              variant="ghost"
              size="sm"
              block
              data-threads-item
              class="justify-start! gap-2 px-1.5! font-normal"
              :data-test="`threads-bar-incident-${incident.id}`"
              @click="openIncident(incident.id)"
            >
              <AssistantStatusDot state="working" placement="inline" />
              <OTruncatedText class="text-text-heading min-w-0 flex-1 text-start">{{
                incident.title || incident.id
              }}</OTruncatedText>
              <OTag type="severity" :value="incident.severity.toLowerCase()" />
            </OButton>
          </li>
        </ul>
        <div class="flex items-center justify-between gap-2 ps-1.5">
          <OText v-if="incidents.more > 0" variant="meta" data-test="threads-bar-incidents-more">{{
            t("assistant.threadsBar.moreIncidents", { count: incidents.more })
          }}</OText>
          <OText v-if="incidents.pageFull" variant="meta" data-test="threads-bar-incidents-full">{{
            t("assistant.threadsBar.pageFull", { count: INCIDENT_PAGE })
          }}</OText>
          <OButton
            variant="ghost-primary"
            size="chip"
            data-threads-item
            class="ms-auto"
            data-test="threads-bar-incidents-all"
            @click="openIncidentList"
          >
            {{ t("assistant.threadsBar.openIncidents") }}
          </OButton>
        </div>
      </div>
      <div class="flex min-w-0 flex-col gap-1" data-test="threads-bar-threads">
        <h3 class="text-text-secondary ps-1.5 text-xs font-medium">
          {{ t("assistant.threadsBar.yourThreads", { count: threads.length + order.length }) }}
        </h3>
        <ul class="flex flex-col">
          <li v-for="pill in [...threads, ...minimisedPills]" :key="pill.sid" class="min-w-0">
            <OButton
              variant="ghost"
              size="sm"
              block
              data-threads-item="thread"
              class="justify-start! gap-2 px-1.5! font-normal"
              :data-test="`threads-bar-thread-${pill.sid}`"
              @click="openThread(pill.sid)"
            >
              <AssistantStatusDot
                v-if="SIGNAL[pill.signal]"
                :state="SIGNAL[pill.signal]!"
                placement="inline"
              />
              <OTruncatedText class="text-text-heading min-w-0 flex-1 text-start">{{
                pill.title
              }}</OTruncatedText>
            </OButton>
          </li>
          <li
            v-if="threads.length + order.length === 0"
            class="text-text-secondary px-1.5 py-1 text-sm"
          >
            {{ t("assistant.threadsBar.noThreads") }}
          </li>
        </ul>
      </div>
    </div>
    <AssistantFloatingLauncher
      ref="launcher"
      :items="launcherItems"
      :expanded="expanded"
      @toggle="toggle"
      @restore="openThread"
    />
  </section>
</template>

<script lang="ts">
import type { Sid } from "@/composables/assistant";

export interface ThreadsBarProps {
  /** Minimised windows, oldest first. */
  order: Sid[];
}
</script>

<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import config from "@/aws-exports";
import AssistantStatusDot from "@/components/ai-assistant/common/AssistantStatusDot.vue";
import { useAssistantRuns, useAssistantStore } from "@/composables/assistant";
import { fullThreadLocation, isHomeAskShown } from "@/composables/assistant/pure";
import { useLicenseLock } from "@/composables/useFeatureLock";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { incidentsQuery } from "@/services/incidents.queries";
import { useI18nTyped } from "@/types/i18n";

import AssistantFloatingLauncher from "./AssistantFloatingLauncher.vue";
import {
  INCIDENT_PAGE,
  liveIncidentPills,
  threadPills,
  trayState,
  type ThreadPill,
} from "./threadsBar";

const SIGNAL = {
  running: "working",
  approval: "attention",
  unread: "unread",
  idle: null,
} as const;

// Open, the bar re-reads the open incidents every minute; collapsed, its pills refresh every five.
const INCIDENT_REFRESH_OPEN_MS = 60_000;

const INCIDENT_REFRESH_COLLAPSED_MS = 300_000;

const props = defineProps<ThreadsBarProps>();

const emit = defineEmits<{ restore: [sid: Sid]; close: [sid: Sid] }>();

const { t } = useI18nTyped();
const router = useRouter();
const route = useRoute();
const vuex = useStore();
const store = useAssistantStore();
const runs = useAssistantRuns();
const incidentsLock = useLicenseLock("incidents");
const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const launcher = ref<{ focus: () => void } | null>(null);
const expanded = ref(false);

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const incidentsOn = computed(
  () =>
    (config.isEnterprise === "true" || config.isCloud === "true") &&
    vuex.state.zoConfig?.incidents_enabled === true &&
    !incidentsLock.locked.value,
);
const openIncidents = useQuery(() => ({
  ...incidentsQuery(org.value, "open", INCIDENT_PAGE, 0),
  enabled: !!org.value && incidentsOn.value,
  refetchInterval: expanded.value ? INCIDENT_REFRESH_OPEN_MS : INCIDENT_REFRESH_COLLAPSED_MS,
}));
// An empty incidents column collapses to one line, so the threads get the panel.
const liveIncidents = computed(() => incidentsOn.value && incidents.value.shown.length > 0);
const incidents = computed(() =>
  liveIncidentPills(incidentsOn.value ? openIncidents.data.value?.incidents : null),
);

const threads = computed(() => {
  const fromRuns: ThreadPill[] = runs.rows.value
    .filter((row) => !row.otherOrg)
    .flatMap((row): ThreadPill[] => {
      const title = String(row.title ?? t("assistant.thread.newChatTitle"));
      if (row.group === "needs_you") return [{ sid: row.sid, title, signal: "approval" }];
      if (row.group === "answering") return [{ sid: row.sid, title, signal: "running" }];
      return row.group === "ready" ? [{ sid: row.sid, title, signal: "unread" }] : [];
    });
  const unread: ThreadPill[] = Object.values(store.state.sessions)
    .filter((session) => session.unread && session.org === org.value)
    .map((session) => ({
      sid: session.sid,
      title: String(session.title ?? t("assistant.thread.newChatTitle")),
      signal: "unread",
    }));
  return threadPills([...fromRuns, ...unread], props.order);
});
const minimisedPills = computed<ThreadPill[]>(() =>
  props.order.map((sid) => {
    const session = store.state.sessions[sid];
    const state = trayState(session);
    return {
      sid,
      title: String(session?.title ?? t("assistant.thread.newChatTitle")),
      signal: state === "needsYou" ? "approval" : state === "working" ? "running" : "idle",
    };
  }),
);
// Waiting chats first, then answering, then the rest; minimised ones newest first.
const launcherItems = computed<ThreadPill[]>(() => {
  const rank = { approval: 0, running: 1, unread: 2, idle: 2 } as const;
  return [...threads.value, ...[...minimisedPills.value].reverse()].sort(
    (a, b) => rank[a.signal] - rank[b.signal],
  );
});
const hasItems = computed(
  () => incidents.value.shown.length > 0 || threads.value.length > 0 || props.order.length > 0,
);

watch(hasItems, (has) => {
  if (!has) expanded.value = false;
});

useShortcuts([{ id: "threadsBarOpen", handler: () => (expanded.value ? collapse() : expand()) }]);

// The dialog is not a control itself, so its arrow and Escape keys are bound on the element, not in the template.
watch(panel, (el, prev) => {
  prev?.removeEventListener("keydown", onPanelKey);
  el?.addEventListener("keydown", onPanelKey);
});

function items(): HTMLElement[] {
  return [...(panel.value?.querySelectorAll<HTMLElement>("[data-threads-item]") ?? [])];
}

async function expand(): Promise<void> {
  if (!hasItems.value) return;
  expanded.value = true;
  if (incidentsOn.value) void openIncidents.refetch?.();
  await nextTick();
  const firstThread = panel.value?.querySelector<HTMLElement>('[data-threads-item="thread"]');
  (firstThread ?? items()[0])?.focus();
}

function collapse(): void {
  expanded.value = false;
  launcher.value?.focus();
}

function toggle(): void {
  if (expanded.value) collapse();
  else void expand();
}

function onPanelKey(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    collapse();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const list = items();
  if (list.length === 0) return;
  event.preventDefault();
  const at = list.indexOf(document.activeElement as HTMLElement);
  const step = event.key === "ArrowDown" ? 1 : list.length - 1;
  list[(Math.max(at, 0) + (at < 0 ? 0 : step)) % list.length]?.focus();
}

function openIncident(id: string): void {
  expanded.value = false;
  void router
    .push({
      name: "incidentDetail",
      params: { id },
      query: { org_identifier: org.value, tab: "incidentAnalysis" },
    })
    .catch(() => undefined);
}

function openIncidentList(): void {
  expanded.value = false;
  void router
    .push({ name: "incidentList", query: { org_identifier: org.value, status: "open" } })
    .catch(() => undefined);
}

// A minimised chat comes back as its window; any other thread opens as Float, or where it already shows.
function openThread(sid: Sid): void {
  expanded.value = false;
  if (isHomeAskShown(route)) return openOnHome(sid);
  if (props.order.includes(sid)) return emit("restore", sid);
  const row = runs.rows.value.find((candidate) => candidate.sid === sid);
  if (store.state.sessions[sid] && store.floatChat(sid).ok) return;
  if (row) void runs.open(row, { focus: "composer" });
  else void store.openSession({ sid }, { focus: true }).catch(() => undefined);
}

// Home's Ask box is the assistant there, so a thread opens on Home instead of in a window.
function openOnHome(sid: Sid): void {
  if (store.state.sessions[sid]) store.open({ kind: "full" }, { sid, focus: "composer" });
  void router.push(fullThreadLocation(sid, route.query)).catch(() => undefined);
}

defineExpose({ el: root });
</script>
