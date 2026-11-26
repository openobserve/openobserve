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
  <ODropdownSub
    v-model:open="open"
    :text-value="t('assistant.composer.connectors.label')"
    align="end"
    data-test="assistant-composer-connectors"
  >
    <template #icon-left>
      <OIcon :name="CONNECTORS_ICON" size="sm" />
    </template>
    <template #trigger>
      <span class="flex min-w-0 flex-1 items-center gap-2">
        <span class="flex-1 truncate">{{ t("assistant.composer.connectors.label") }}</span>
        <span
          v-if="enabledCount > 0"
          class="text-text-secondary text-xs"
          data-test="assistant-composer-connectors-count"
          >{{ t("assistant.composer.connectors.on", { count: enabledCount }) }}</span
        >
      </span>
    </template>
    <ODropdownGroup :label="t('assistant.composer.connectors.heading')">
      <OText
        v-if="list.isError.value"
        variant="meta"
        as="p"
        class="px-3 py-1.5"
        data-test="assistant-connectors-failed"
        >{{ t("assistant.composer.connectors.failed") }}</OText
      >
      <OText
        v-else-if="!list.isPending.value && shown.length === 0"
        variant="meta"
        as="p"
        class="px-3 py-1.5"
        data-test="assistant-connectors-empty"
        >{{ t("assistant.composer.connectors.empty") }}</OText
      >
      <AssistantMenuSwitchRow
        v-for="row in shown"
        :key="row.id"
        :label="raw(row.name)"
        :checked="enabledOf(row)"
        :disabled="forbidden || pending.has(row.id)"
        :data-test="`assistant-connector-${row.name}`"
        @toggle="(value) => toggle(row, value)"
      >
        <template #badge>
          <OTag :label="t(KIND_LABEL_KEYS[row.kind])" size="sm" shape="rounded" class="shrink-0" />
        </template>
      </AssistantMenuSwitchRow>
      <OText
        v-if="failedName"
        variant="meta"
        as="p"
        role="alert"
        class="text-status-error-text! px-3 py-1.5"
        data-test="assistant-connectors-toggle-failed"
        >{{ t("assistant.composer.connectors.toggleFailed", { name: raw(failedName) }) }}</OText
      >
    </ODropdownGroup>
    <ODropdownSeparator />
    <ODropdownItem
      icon-left="open-in-new"
      data-test="assistant-connectors-add"
      @select="addToolset"
    >
      {{ t("assistant.composer.connectors.add") }}
    </ODropdownItem>
    <OText
      v-if="forbidden"
      variant="meta"
      as="p"
      class="px-3 pt-1 pb-1.5"
      data-test="assistant-connectors-scope"
      >{{ t("assistant.composer.connectors.noPermission") }}</OText
    >
  </ODropdownSub>
</template>

<script lang="ts">
import type { IconName } from "@/lib/core/Icon/OIcon.types";

const CONNECTORS_ICON: IconName = "extension";
</script>

<script setup lang="ts">
import { useMutation, useQuery } from "@tanstack/vue-query";
import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import {
  KIND_LABEL_KEYS,
  parseToolsetRows,
  type ToolsetRow,
} from "@/components/settings/assistant/assistantToolsets";
import { openTabWithoutOpener } from "@/composables/assistant/pure";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import ODropdownSub from "@/lib/overlay/Dropdown/ODropdownSub.vue";
import { aiToolsetsQuery } from "@/services/ai_toolsets.queries";
import { setToolsetEnabledMutation } from "@/services/assistant_settings.queries";
import { raw, useI18nTyped } from "@/types/i18n";

import AssistantMenuSwitchRow from "./AssistantMenuSwitchRow.vue";

const { t } = useI18nTyped();
const vuex = useStore();
const router = useRouter();
const open = ref(false);

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const list = useQuery(computed(() => ({ ...aiToolsetsQuery(org.value), enabled: !!org.value })));
const rows = computed<ToolsetRow[]>(() => parseToolsetRows(list.data.value));
const enableMutation = useMutation(() => setToolsetEnabledMutation(org.value));

// Switches are org-wide (D4'); a flip shows at once and the server's answer settles it.
const flipped = reactive(new Map<string, boolean>());
const pending = reactive(new Set<string>());
const forbidden = ref(false);
// The mutation keeps the shared error toast quiet, so a refused switch says so in the menu itself.
const failedName = ref<string | null>(null);
const enabledOf = (row: ToolsetRow) => flipped.get(row.id) ?? row.enabled !== false;
const enabledCount = computed(() => rows.value.filter(enabledOf).length);

// Disabled toolsets stay hidden, but one switched off here keeps its row until the menu closes.
const kept = ref<ReadonlySet<string>>(new Set());
watch(
  [open, rows],
  ([shownNow]) => {
    if (!shownNow) {
      flipped.clear();
      failedName.value = null;
    }
    kept.value = new Set(
      rows.value.filter((row) => kept.value.has(row.id) || enabledOf(row)).map((row) => row.id),
    );
    if (!shownNow) kept.value = new Set(rows.value.filter(enabledOf).map((row) => row.id));
  },
  { immediate: true },
);
const shown = computed(() => rows.value.filter((row) => kept.value.has(row.id)));

async function toggle(row: ToolsetRow, value: boolean): Promise<void> {
  flipped.set(row.id, value);
  pending.add(row.id);
  failedName.value = null;
  try {
    await enableMutation.mutateAsync({ id: row.id, enabled: value });
  } catch (error) {
    flipped.delete(row.id);
    if ((error as { response?: { status?: number } })?.response?.status === 403)
      forbidden.value = true;
    else failedName.value = row.name;
  } finally {
    pending.delete(row.id);
  }
}

// A new tab keeps the draft and the chat where they are.
function addToolset(): void {
  const target = router.resolve({
    name: "assistantSettings",
    params: { tab: "toolsets" },
    query: { org_identifier: org.value },
  });
  openTabWithoutOpener(target.href);
}
</script>
