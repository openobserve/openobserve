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
  <OButton
    v-if="offered"
    variant="ghost"
    size="xs"
    :disabled="!!entry.undoing"
    focusable-unavailable
    :class="TOUCH_TARGET_CLASS"
    :data-test="`${testId}-${entry.id}`"
    @click="undo"
  >
    {{ entry.undoing ? t("assistant.actions.undoing") : t("assistant.actions.undo") }}
  </OButton>
  <!-- Undo goes away once it worked, so focus moves to what took its place -->
  <span
    v-else-if="entry.status === 'undone'"
    ref="restored"
    tabindex="-1"
    class="text-text-secondary rounded-default focus-visible:ring-border-strong outline-none focus-visible:ring-2"
    :data-test="`${testId}-restored-${entry.id}`"
  >
    {{ t("assistant.actions.restored") }}
  </span>
  <span v-if="entry.undoFailed" class="text-status-error-text">
    {{ t("assistant.actions.undoFailed") }}
  </span>
  <span v-if="entry.undoUnconfirmed" class="text-text-secondary">
    {{ t("assistant.actions.undoUnconfirmed") }}
  </span>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, ref } from "vue";

import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  assistantEvidenceHostKey,
  type ActionLedgerEntry,
  type Sid,
} from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import { raw, useI18nTyped } from "@/types/i18n";

import { assistantApprovalsHostKey } from "./approvals.types";

const props = defineProps<{
  entry: ActionLedgerEntry;
  sid: Sid;
  testId: string;
}>();

const { t } = useI18nTyped();
const host = inject(assistantApprovalsHostKey, null);
const evidence = inject(assistantEvidenceHostKey, null);
const restored = ref<HTMLElement | null>(null);

const offered = computed(
  () =>
    props.entry.undoable &&
    !props.entry.undoUnconfirmed &&
    (props.entry.status === "done" || !!props.entry.undoing),
);

async function undo(): Promise<void> {
  if (!host) return;
  const result = await host.undo(props.sid, props.entry.id);
  if (!result.ok && result.reason === "gated") return;
  await nextTick();
  const line = result.ok
    ? t("assistant.actions.undone", { name: raw(props.entry.resource.name) })
    : props.entry.undoUnconfirmed
      ? t("assistant.actions.undoUnconfirmed")
      : t("assistant.actions.undoFailed");
  evidence?.announce(props.sid, line);
  if (result.ok) restored.value?.focus();
}
</script>
