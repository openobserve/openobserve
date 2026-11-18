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
  <AssistantContextInfo :rows="rows">
    <template v-if="$slots.detail" #detail><slot name="detail" /></template>
  </AssistantContextInfo>
</template>

<script lang="ts">
import type { AssistantContextInfoRow } from "./AssistantContextInfo.vue";
import { fieldRowOf, type ContextDraft, type SeesRow, type Sid } from "@/composables/assistant";

export interface AssistantContextSeesPopoverProps {
  sid: Sid | null;
  /** A box with no chat yet says what it holds; a chat's composer is read from its session. */
  draft?: ContextDraft | null;
  /** Home names no streams: it has no page to read them from. */
  hideStreams?: boolean;
}

const STREAMS_ROW = "selectedStreams";

const ATTACHMENTS_ROW = "attachments";

const MERGED_ROWS = ["org_id", "currentPage", "timeRange", "user_timezone", "request_timestamp"];

// Only this list capitalises the range, so the shared formatter stays untouched.
function rangeText(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// A field the user's @ mention fills is theirs, so it lists after the page's own rows.
function isAdded(row: SeesRow, mentioned: ReadonlySet<string>): boolean {
  const kind = fieldRowOf(row.id)?.chip;
  return row.id === ATTACHMENTS_ROW || (!!kind && mentioned.has(kind));
}
</script>

<script setup lang="ts">
import { computed } from "vue";

import { useAssistantContext, useAssistantStore } from "@/composables/assistant";
import { useI18nTyped } from "@/types/i18n";

import AssistantContextInfo from "./AssistantContextInfo.vue";

const props = withDefaults(defineProps<AssistantContextSeesPopoverProps>(), {
  draft: null,
  hideStreams: false,
});

defineSlots<{ detail?: () => unknown }>();

const { t } = useI18nTyped();
const store = useAssistantStore();
const context = useAssistantContext(() => props.sid, { store, draft: () => props.draft });

const rows = computed<AssistantContextInfoRow[]>(() => {
  const mentioned = new Set<string>(
    context.chips.value.filter((chip) => chip.provenance === "mention").map((chip) => chip.kind),
  );
  const sent = context.sees.value.filter(
    (row) => row.group !== "not_read" && !(props.hideStreams && row.id === STREAMS_ROW),
  );
  const added = sent.filter((row) => isAdded(row, mentioned));
  const base = sent.filter((row) => !isAdded(row, mentioned));
  const byId = (id: string) => base.find((row) => row.id === id);
  const plain = (row: SeesRow): AssistantContextInfoRow => ({
    id: row.id,
    label: row.label,
    value: row.id === "timeRange" ? rangeText(String(row.value)) : row.value,
  });
  const org = byId("org_id");
  const page = byId("currentPage");
  const range = byId("timeRange");
  const zone = byId("user_timezone");
  const out: AssistantContextInfoRow[] = [];
  if (page)
    out.push({
      ...plain(page),
      secondary: org ? t("assistant.context.orgLine", { org: org.value }) : undefined,
      secondaryTest: "assistant-context-sees-org",
    });
  else if (org) out.push(plain(org));
  for (const row of base) if (!MERGED_ROWS.includes(row.id)) out.push(plain(row));
  if (range)
    out.push({
      ...plain(range),
      secondary: zone?.value,
      secondaryTest: "assistant-context-sees-timezone",
    });
  return [...out, ...added.map(plain)];
});
</script>
