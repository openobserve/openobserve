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
    :data-collapsed="hiddenCount > 0 ? '' : undefined"
    :class="['flex min-w-0 items-center gap-0.5', expanded ? 'flex-wrap' : '']"
  >
    <AssistantTimePrefix
      :window="context.window.value"
      :page-window="pageWindow"
      :timezone="timezone"
      @change="applyTime"
    />
    <ul v-if="shownChips.length > 0" class="flex min-w-0 flex-wrap items-center gap-0.5">
      <li v-for="chip in shownChips" :key="chip.id" class="max-w-40 min-w-0">
        <AssistantChipPopover
          :chip="chip"
          :open="openId === chip.id"
          :image-src="imageSrcOf(chip)"
          :open-label="openLabelOf(chip)"
          @update:open="(open) => (openId = open ? chip.id : null)"
          @open-source="openSource(chip)"
          @paste-inline="pasteInline(chip)"
          @remove="remove(chip)"
          @remove-row="(index) => removeRow(chip, index)"
          @trim="(include) => trim(chip, include)"
          @tab-out="tabOut(chip.id)"
        >
          <template #anchor>
            <AssistantContextChip
              :chip="chip"
              compact
              :short-label="chip.short"
              :expanded="openId === chip.id"
              @open="openChip(chip)"
              @remove="remove(chip)"
              @move="(direction) => move(chip.id, direction)"
            />
          </template>
        </AssistantChipPopover>
      </li>
    </ul>
    <OButton
      v-if="!layout.yieldChips && (hiddenCount > 0 || expanded)"
      variant="ghost"
      size="chip"
      :class="['text-text-secondary min-w-6 shrink-0 justify-center', TOUCH_TARGET_CLASS]"
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
  </div>
</template>

<script lang="ts">
import type { Sid } from "@/composables/assistant";

export interface AssistantContextTrayProps {
  sid: Sid | null;
}

/** Chips shown before `+N`; the composer's width decides which. */
export function trayChipLimit(layout: { narrow: boolean; wide: boolean }): number {
  if (layout.narrow) return 0;
  return layout.wide ? 3 : 1;
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import { announceComposer, useComposerLayout } from "@/components/ai-assistant/composer/composerUi";
import { explorerLabel } from "@/components/ai-assistant/evidence/evidenceText";
import {
  byteSize,
  timeWindowOf,
  useAssistantContext,
  useAssistantPlacement,
  useAssistantStore,
  type ComposerState,
  type ContextChip,
} from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatBytes } from "@/utils/formatters";

import { chipOpenQuery } from "@/composables/assistant/pure";
import { explorerOf } from "@/utils/assistant/explorerRoutes";

import AssistantChipPopover from "./AssistantChipPopover.vue";
import AssistantContextChip from "./AssistantContextChip.vue";
import AssistantTimePrefix from "./AssistantTimePrefix.vue";

const props = defineProps<AssistantContextTrayProps>();

const { t } = useI18nTyped();
const store = useAssistantStore();
const route = useRoute();
const vuex = useStore();
const context = useAssistantContext(() => props.sid, { store });
const layout = useComposerLayout();
const placement = useAssistantPlacement(store);
const root = ref<HTMLElement | null>(null);
const openId = ref<string | null>(null);
const expanded = ref(false);

// Another user+org's chat is never shown or edited here (D21, F8).
const session = computed(() => {
  const found = store.state.sessions[props.sid ?? ""];
  return found && found.userOrgKey === store.state.userOrgKey ? found : null;
});
const timezone = computed<string>(() => vuex.state.timezone || "UTC");

// The page's own window, whatever the draft overrides it with; a page with no range offers no "Page time".
const pageWindow = computed(() => {
  const own = timeWindowOf(context.page.value, null);
  return own.source === "page" ? own : null;
});

// Page context shows in the `i` and the placeholder; chips are only what the user added (composer §1).
const imageChips = computed<ContextChip[]>(() =>
  (session.value?.composer.images ?? []).map((image) => ({
    id: image.id ?? image.filename,
    kind: "image",
    label: raw(image.filename),
    secondary: raw(formatBytes(image.size)),
    sizeBytes: image.size,
    provenance: "attach",
    sent: "serialized",
  })),
);
const allChips = computed(() => [
  ...context.chips.value.filter((chip) => chip.kind !== "time" && chip.provenance !== "page"),
  ...imageChips.value,
]);
const shownChips = computed(() => {
  if (expanded.value) return allChips.value;
  return layout.value.yieldChips ? [] : allChips.value.slice(0, trayChipLimit(layout.value));
});
const hiddenCount = computed(() =>
  expanded.value ? 0 : allChips.value.length - shownChips.value.length,
);

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

async function remove(chip: ContextChip): Promise<void> {
  const current = session.value;
  const sid = current?.sid;
  if (!sid || !current) return;
  const order = allChips.value.map((c) => c.id);
  const next = order[order.indexOf(chip.id) + 1] ?? null;
  if (chip.kind === "image") store.removeImage(sid, chip.id);
  else store.removeChip(sid, chip.id);
  openId.value = null;
  announceComposer(sid, t("assistant.context.removed", { label: chip.label }));
  changed("remove", chip);
  await nextTick();
  focusChip(next === chip.id ? null : next);
}

// The text joins the end of the draft on its own line, so nothing typed is overwritten.
function pasteInline(chip: ContextChip): void {
  const current = session.value;
  if (!current || typeof chip.data !== "string") return;
  const typed = current.composer.text;
  store.removeChip(current.sid, chip.id);
  store.setDraft(current.sid, { text: typed ? `${typed}\n${chip.data}` : chip.data });
  openId.value = null;
  changed("remove", chip);
}

function imageSrcOf(chip: ContextChip): string | undefined {
  if (chip.kind !== "image") return undefined;
  const image = session.value?.composer.images.find((row) => (row.id ?? row.filename) === chip.id);
  return image ? `data:${image.mimeType};base64,${image.data}` : undefined;
}

// Tab past the popover's last control lands on the control after its chip (APG non-modal popover, U3).
async function tabOut(id: string): Promise<void> {
  await nextTick();
  const button = chipButtons()[shownChips.value.findIndex((c) => c.id === id)];
  const tabbable = Array.from(
    root.value?.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex='0']") ?? [],
  );
  const next = button ? tabbable[tabbable.indexOf(button) + 1] : undefined;
  (next ?? button)?.focus();
}

// A time picked before the first keystroke starts the chat, as a pick of an agent does.
function applyTime(range: ComposerState["timeOverride"]): void {
  const sid =
    session.value?.sid ??
    (store.state.ready
      ? store.createSession({
          origin: {
            entryKind: "empty_state",
            objectKind: "none",
            container: placement.container.value ?? "sidebar",
          },
        })
      : null);
  if (!sid) return;
  store.setTimeOverride(sid, range);
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

function chipButtons(): HTMLElement[] {
  return Array.from(
    root.value?.querySelectorAll<HTMLElement>('[data-test="assistant-context-chip-button"]') ?? [],
  );
}

function move(id: string, direction: -1 | 1): void {
  const order = shownChips.value.map((chip) => chip.id);
  focusChip(order[order.indexOf(id) + direction] ?? null);
}

// Focus goes to the chip with this id, else the textbox, so a keyboard removal never strands focus (CT-08 AC 4).
function focusChip(id: string | null): void {
  const order = shownChips.value.map((chip) => chip.id);
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
