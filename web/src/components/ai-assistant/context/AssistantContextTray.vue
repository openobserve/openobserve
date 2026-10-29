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
  <div
    ref="root"
    role="group"
    :aria-label="t('assistant.context.trayLabel')"
    data-test="assistant-context-tray"
    data-dd-privacy="mask"
    :data-collapsed="compact && !expanded ? '' : undefined"
    class="flex shrink-0 flex-col gap-1 px-3 pt-2"
  >
    <div class="flex min-w-0 items-start gap-1">
      <ul class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <li v-for="chip in shownChips" :key="chip.id" class="max-w-full min-w-0 shrink-0">
          <AssistantChipPopover
            :chip="chip"
            :open="openId === chip.id"
            :window="context.window.value"
            :timezone="timezone"
            :open-label="openLabelOf(chip)"
            @update:open="(open) => (openId = open ? chip.id : null)"
            @open-source="openSource(chip)"
            @remove="remove(chip)"
            @remove-row="(index) => removeRow(chip, index)"
            @trim="(include) => trim(chip, include)"
            @apply-time="applyTime"
            @tab-out="tabOut(chip.id)"
          >
            <template #anchor>
              <AssistantContextChip
                :chip="chip"
                :compact="!mdUp"
                :short-label="mdUp ? undefined : shortLabelOf(chip)"
                :expanded="openId === chip.id"
                @open="openChip(chip)"
                @remove="remove(chip)"
                @move="(direction) => move(chip.id, direction)"
              />
            </template>
          </AssistantChipPopover>
        </li>
        <li v-for="chip in shownGhosts" :key="chip.id" class="max-w-full min-w-0 shrink-0">
          <AssistantContextChip
            :chip="chip"
            state="ghost"
            :popup="false"
            @open="addBack(chip)"
            @move="(direction) => move(chip.id, direction)"
          />
        </li>
        <li v-if="hiddenCount > 0 || (expanded && collapsible)" class="shrink-0">
          <OButton
            variant="ghost"
            size="sm"
            class="max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            :aria-expanded="expanded"
            :aria-label="
              expanded
                ? t('assistant.context.fewerName')
                : t('assistant.context.moreName', { count: hiddenCount }, hiddenCount)
            "
            data-test="assistant-context-more"
            @click="expanded = !expanded"
          >
            {{
              expanded
                ? t("assistant.context.fewer")
                : t("assistant.context.more", { count: hiddenCount })
            }}
          </OButton>
        </li>
      </ul>
      <AssistantContextSeesPopover :sid="sid" :icon-only="compact" class="shrink-0" />
    </div>

    <p
      v-if="threadTitle"
      class="flex min-w-0 flex-wrap items-center gap-x-1 text-xs"
      data-test="assistant-context-thread"
    >
      <OTruncatedText class="text-text-secondary min-w-0">{{
        t("assistant.context.inChat", { title: threadTitle })
      }}</OTruncatedText>
      <OButton
        variant="ghost"
        size="sm"
        class="max-md:min-h-11 pointer-coarse:min-h-11"
        data-test="assistant-context-start-new"
        @click="startNew"
      >
        {{ t("assistant.context.startNew") }}
      </OButton>
    </p>
    <OText v-if="capLine" variant="meta" as="p" data-test="assistant-context-cap">{{
      capLine
    }}</OText>
  </div>
</template>

<script lang="ts">
import type { Sid } from "@/composables/assistant";

export interface AssistantContextTrayProps {
  sid: Sid | null;
  /** Docked containers, the sheet and a sidebar at 24 rem or narrower show `Time` + N + `+{count}`. */
  collapsed?: boolean;
  /** Only the container the user sees announces and reacts to page changes. */
  visible?: boolean;
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

import {
  announceComposer,
  CAP_NOTICE_MS,
  composerUi,
  moveDraft,
} from "@/components/ai-assistant/composer/composerUi";
import { explorerLabel } from "@/components/ai-assistant/evidence/evidenceText";
import {
  byteSize,
  timeRangeShortText,
  useAssistantContext,
  useAssistantStore,
  type ComposerState,
  type ContextChip,
} from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import { chipOpenQuery } from "@/composables/assistant/pure";
import { explorerOf } from "@/utils/assistant/explorerRoutes";

import AssistantChipPopover from "./AssistantChipPopover.vue";
import AssistantContextChip from "./AssistantContextChip.vue";
import AssistantContextSeesPopover from "./AssistantContextSeesPopover.vue";

const THREAD_WINDOW_MS = 30 * 60_000;

// A page that just loaded fills its fields in over its first reads; that is not a change the user made.
const PAGE_SETTLE_MS = 3_000;

const props = withDefaults(defineProps<AssistantContextTrayProps>(), {
  collapsed: false,
  visible: true,
});

const { t } = useI18nTyped();
const store = useAssistantStore();
const route = useRoute();
const vuex = useStore();
const { mdUp } = useBreakpoint();
const context = useAssistantContext(() => props.sid, { store });
const root = ref<HTMLElement | null>(null);
const openId = ref<string | null>(null);
const expanded = ref(false);
const now = ref(Date.now());
let capTimer: ReturnType<typeof setTimeout> | null = null;

// Another user+org's chat is never shown or edited here (D21, F8).
const session = computed(() => {
  const found = store.state.sessions[props.sid ?? ""];
  return found && found.userOrgKey === store.state.userOrgKey ? found : null;
});
const timezone = computed<string>(() => vuex.state.timezone || "UTC");
const compact = computed(() => !mdUp.value || props.collapsed);
const limit = computed(() => (mdUp.value ? 3 : 2));

const allChips = computed(() =>
  context.chips.value.map((chip) =>
    !mdUp.value && chip.kind === "time"
      ? {
          ...chip,
          label: t("assistant.context.time.page", {
            range: timeRangeShortText(context.window.value),
          }),
        }
      : chip,
  ),
);
const collapsible = computed(
  () => compact.value && allChips.value.length + context.removed.value.length > limit.value,
);
const shownChips = computed(() =>
  compact.value && !expanded.value ? allChips.value.slice(0, limit.value) : allChips.value,
);
const shownGhosts = computed(() => (compact.value && !expanded.value ? [] : context.removed.value));
const hiddenCount = computed(() =>
  compact.value && !expanded.value
    ? allChips.value.length - shownChips.value.length + context.removed.value.length
    : 0,
);

// A door's staging into a chat that answered in the last 30 min offers a fresh chat instead (`40` §2.4).
const threadTitle = computed(() => {
  const current = session.value;
  if (!current || current.messages.length === 0 || !current.title) return null;
  if (!current.composer.chips.some((chip) => chip.provenance === "door")) return null;
  const last = store.lastTurnAt(current.sid);
  return last !== null && now.value - last < THREAD_WINDOW_MS ? current.title : null;
});

const capLine = computed(() => {
  const cap = props.sid ? composerUi(props.sid).cap : null;
  return cap && now.value - cap.at < CAP_NOTICE_MS ? cap.text : null;
});

watch(
  () => (props.sid ? composerUi(props.sid).cap?.at : undefined),
  (at) => {
    if (at === undefined) return;
    now.value = Date.now();
    if (capTimer) clearTimeout(capTimer);
    capTimer = setTimeout(() => (now.value = Date.now()), CAP_NOTICE_MS);
  },
);

// A chip a page change adds is announced once; the page's own load and the time chip's ticks never are (CT-01 AC 12).
let settledAt = context.page.value ? 0 : null;
watch(
  () => context.chips.value.filter((chip) => chip.provenance === "page" && chip.kind !== "time"),
  (next, previous) => {
    if (settledAt === null && context.page.value) settledAt = Date.now() + PAGE_SETTLE_MS;
    if (settledAt === null || Date.now() < settledAt) return;
    if (!props.visible || !props.sid || !previous) return;
    const before = new Set(previous.map((chip) => chip.id));
    for (const chip of next)
      if (!before.has(chip.id))
        announceComposer(props.sid, t("assistant.context.added", { label: chip.label }));
  },
);

onBeforeUnmount(() => {
  if (capTimer) clearTimeout(capTimer);
});

function changed(
  action: "remove" | "add_back" | "swap_time" | "trim",
  chip: ContextChip,
  bytes = chip.sizeBytes,
): void {
  trackAssistant("ai_context_changed", { action, kind: chip.kind, count: chip.count ?? 1, bytes });
}

function openChip(chip: ContextChip): void {
  openId.value = openId.value === chip.id ? null : chip.id;
  if (openId.value) trackAssistant("ai_context_inspected", { target: "chip", kind: chip.kind });
}

function pageField(chip: ContextChip): string | null {
  return chip.provenance === "page" && chip.id.startsWith("page:") ? chip.id.slice(5) : null;
}

async function remove(chip: ContextChip): Promise<void> {
  const current = session.value;
  const sid = current?.sid;
  if (!sid || !current) return;
  const order = [...allChips.value, ...context.removed.value].map((c) => c.id);
  const next = order[order.indexOf(chip.id) + 1] ?? null;
  const field = pageField(chip);
  if (field) store.setDraft(sid, { removedPageKeys: [...current.composer.removedPageKeys, field] });
  else store.removeChip(sid, chip.id);
  openId.value = null;
  announceComposer(sid, t("assistant.context.removed", { label: chip.label }));
  changed("remove", chip);
  await nextTick();
  focusChip(next === chip.id ? null : next);
}

function addBack(chip: ContextChip): void {
  const sid = session.value?.sid;
  if (!sid) return;
  const field = chip.id.replace(/^ghost:/, "");
  store.addBackChip(sid, field);
  announceComposer(sid, t("assistant.context.added", { label: chip.label }));
  changed("add_back", chip);
  // The ghost unmounts under the focused button, so focus follows the chip it became (U2).
  void nextTick(() => focusChip(`page:${field}`));
}

// Below md the icon names the kind, so the chip shows the range or the name the chip was built with, never an id (CT-01 AC 9).
function shortLabelOf(chip: ContextChip): I18nText | undefined {
  return chip.kind === "time" ? raw(timeRangeShortText(context.window.value)) : chip.short;
}

// Tab past the popover's last control lands on the control after its chip (APG non-modal popover, U3).
async function tabOut(id: string): Promise<void> {
  await nextTick();
  const button =
    chipButtons()[[...shownChips.value, ...shownGhosts.value].findIndex((c) => c.id === id)];
  const tabbable = Array.from(
    root.value?.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex='0']") ?? [],
  );
  const next = button ? tabbable[tabbable.indexOf(button) + 1] : undefined;
  (next ?? button)?.focus();
}

function applyTime(range: ComposerState["timeOverride"]): void {
  const sid = session.value?.sid;
  if (!sid) return;
  store.setTimeOverride(sid, range);
  openId.value = null;
  changed("swap_time", context.timeChip.value, 0);
}

function trim(chip: ContextChip, includeInternal: boolean): void {
  const current = session.value;
  const sid = current?.sid;
  if (!sid || !current) return;
  const chips = current.composer.chips.map((c) =>
    c.id === chip.id ? { ...c, includeInternal } : c,
  );
  store.setDraft(sid, { chips });
  const updated = chips.find((c) => c.id === chip.id) ?? chip;
  changed("trim", chip, byteSize(updated.data));
}

function removeRow(chip: ContextChip, index: number): void {
  const sid = session.value?.sid;
  const current = session.value;
  if (!sid || !current || !Array.isArray(chip.data)) return;
  const rows = chip.data.filter((_row, i) => i !== index);
  if (rows.length === 0) return void remove(chip);
  const data = rows.length === 1 ? rows[0] : rows;
  const label = chip.kind === "log_row" ? logRowsLabel(chip, rows.length) : chip.label;
  const chips = current.composer.chips.map((c) =>
    c.id === chip.id
      ? {
          ...c,
          label,
          data,
          count: rows.length > 1 ? rows.length : undefined,
          sizeBytes: byteSize(data),
        }
      : c,
  );
  store.setDraft(sid, { chips });
  changed("remove", chip);
}

// A door chip names its stream in `short`, a legacy one in `secondary`.
function logRowsLabel(chip: ContextChip, count: number): I18nText {
  const name = chip.short ?? chip.secondary;
  return name
    ? t("assistant.context.chip.logRows", { count, name }, count)
    : t("assistant.context.chip.logRowsPlain", { count }, count);
}

// The whole staged payload moves, so the new chat sends exactly what this one would have (S8).
function startNew(): void {
  const current = session.value;
  if (!current) return;
  const fresh = store.createSession({ origin: { ...current.origin }, thread: "new" });
  moveDraft(store, current.sid, fresh);
}

function chipButtons(): HTMLElement[] {
  return Array.from(
    root.value?.querySelectorAll<HTMLElement>('[data-test="assistant-context-chip-button"]') ?? [],
  );
}

function move(id: string, direction: -1 | 1): void {
  const order = [...shownChips.value, ...shownGhosts.value].map((chip) => chip.id);
  focusChip(order[order.indexOf(id) + direction] ?? null);
}

// Focus goes to the chip with this id, else the textbox, so a keyboard removal never strands focus (CT-08 AC 4).
function focusChip(id: string | null): void {
  const order = [...shownChips.value, ...shownGhosts.value].map((chip) => chip.id);
  const target = id ? chipButtons()[order.indexOf(id)] : undefined;
  if (target) return target.focus();
  root.value
    ?.closest("[data-assistant-root]")
    ?.querySelector<HTMLElement>("[data-assistant-composer]")
    ?.focus();
}

defineExpose({ focusLast: () => chipButtons().at(-1)?.focus() });

function openQueryOf(chip: ContextChip) {
  const sid = props.sid;
  const org = sid ? store.state.sessions[sid]?.org : null;
  return org ? chipOpenQuery(chip, org) : null;
}

// The incident page reads `?tab` only on load, so on that incident's own page the action would do nothing.
function incidentRouteOf(chip: ContextChip) {
  const id = chip.ref?.type === "incident" ? chip.ref.id : undefined;
  if (!id || id.startsWith("door:")) return null;
  if (route?.name === "incidentDetail" && route.params.id === id) return null;
  return { name: "incidentDetail", params: { id }, query: { tab: "incidentAnalysis" } };
}

function openLabelOf(chip: ContextChip): I18nText | null {
  if (incidentRouteOf(chip)) return t("assistant.rca.runAnalysis");
  const query = openQueryOf(chip);
  if (!query) return null;
  return t("assistant.context.openSource", { page: explorerLabel(explorerOf(query), t) });
}

// Through the explorer applier, so a docked container opens a new tab and nothing runs.
async function openSource(chip: ContextChip): Promise<void> {
  const incident = incidentRouteOf(chip);
  if (incident) return runAnalysis(chip, incident);
  const query = openQueryOf(chip);
  const sid = props.sid;
  if (!sid || !query) return;
  openId.value = null;
  const result = await store.dispatch(sid, {
    kind: "open_in_explorer",
    query,
    explorer: explorerOf(query),
  });
  if (!result.ok && result.reason === "other_org")
    announceComposer(sid, t("assistant.evidence.otherOrg", { org: raw(query.org) }));
}

async function runAnalysis(
  chip: ContextChip,
  target: NonNullable<ReturnType<typeof incidentRouteOf>>,
): Promise<void> {
  const sid = props.sid;
  const org = sid ? store.state.sessions[sid]?.org : null;
  if (!sid || !org) return;
  openId.value = null;
  // The navigation sets the session's org, so a chip from another org must not open under it.
  if (chip.ref?.org && chip.ref.org !== org) {
    announceComposer(sid, t("assistant.evidence.otherOrg", { org: raw(chip.ref.org) }));
    return;
  }
  const result = await store.dispatch(sid, {
    kind: "navigate",
    target,
    label: t("assistant.rca.runAnalysis"),
  });
  if (!result.ok && result.reason === "other_org")
    announceComposer(sid, t("assistant.evidence.otherOrg", { org: raw(chip.ref?.org ?? org) }));
}
</script>
