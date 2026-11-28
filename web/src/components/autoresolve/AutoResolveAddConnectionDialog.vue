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
  <ODialog
    :open="open"
    size="md"
    :title="t('autoresolve.missing.add', { mcp })"
    :primary-button-label="t('autoresolve.missing.dialogConfirm')"
    primary-button-data-test="autoresolve-add-connection-confirm"
    :primary-button-loading="add.isPending.value"
    :secondary-button-label="t('common.cancel')"
    data-test="autoresolve-add-connection-dialog"
    @update:open="(value) => emit('update:open', value)"
    @click:primary="onAdd"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-4">
      <ODescriptionList label-width="narrow" dense>
        <ODescriptionItem
          v-if="run.autoresolve"
          :label="t('autoresolve.missing.dialogAutoResolve')"
        >
          <span class="wrap-anywhere">{{ run.autoresolve.name }}</span>
        </ODescriptionItem>
        <ODescriptionItem :label="t('autoresolve.missing.dialogConnection')">
          <span class="flex min-w-0 flex-col">
            <span class="text-text-heading font-semibold wrap-anywhere">{{ missing.name }}</span>
            <span
              v-if="description"
              class="text-text-secondary text-xs wrap-anywhere"
              data-test="autoresolve-add-connection-description"
            >
              {{ description }}
            </span>
          </span>
        </ODescriptionItem>
      </ODescriptionList>
      <OInlineNotice
        v-if="triggerTurnsOff"
        variant="warning"
        wrap
        :text="t('autoresolve.missing.dialogTriggerOff')"
        data-test="autoresolve-add-connection-trigger-off"
      />
      <p class="text-text-secondary m-0 text-xs">
        {{ t("autoresolve.missing.dialogThen", { mcp }) }}
      </p>
      <OInlineNotice
        v-if="failed"
        variant="error"
        wrap
        :text="failed"
        data-test="autoresolve-add-connection-refused"
      />
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import {
  autoresolveErrorMessage,
  type AutoResolveMissingConnection,
  type AutoResolveRun,
} from "@/services/autoresolve";
import {
  addAutoResolveConnectionMutation,
  autoresolveSavedQuery,
} from "@/services/autoresolve.queries";
import { aiToolsetsQuery } from "@/services/ai_toolsets.queries";
import productAnalytics from "@/services/product_analytics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { theMcps, triggerState } from "@/utils/autoresolve/autoresolveText";

const props = defineProps<{
  open: boolean;
  run: AutoResolveRun;
  missing: AutoResolveMissingConnection;
}>();

const emit = defineEmits<{ "update:open": [value: boolean]; added: [] }>();

const { t } = useI18nTyped();
const orgId = useOrgId();
const mcp = computed(() => theMcps([props.missing.name], t));

// The description is a nicety: a viewer who may not list connections still gets the dialog.
const toolsets = useQuery(() =>
  Object.assign(aiToolsetsQuery(orgId.value), { enabled: props.open && !!orgId.value }),
);
const description = computed(() => {
  const found = (toolsets.data.value?.toolsets ?? []).find(
    (ts: { id?: string }) => ts?.id === props.missing.connection_id,
  ) as { description?: string } | undefined;
  return found?.description?.trim() || "";
});

const saved = useQuery(() =>
  Object.assign(autoresolveSavedQuery(orgId.value, props.run.autoresolve?.id ?? ""), {
    enabled: props.open && !!orgId.value && !!props.run.autoresolve,
  }),
);
// The server turns the trigger off only when the AutoResolve lacked the connection.
const triggerTurnsOff = computed(() => {
  const flow = saved.data.value;
  if (!flow?.trigger || flow.connections.some((c) => c.id === props.missing.connection_id)) {
    return false;
  }
  return triggerState(flow.trigger) === "on";
});

const add = useMutation(() => addAutoResolveConnectionMutation(orgId.value));
const failed = ref<I18nText | null>(null);
watch(
  () => props.open,
  () => (failed.value = null),
);

const onAdd = () => {
  failed.value = null;
  add.mutate(
    { id: props.run.id, connectionId: props.missing.connection_id },
    {
      onSuccess: () => {
        productAnalytics.track("autoresolve_connection_added", { saved: !!props.run.autoresolve });
        emit("update:open", false);
        emit("added");
      },
      onError: (err: unknown) => {
        failed.value =
          raw(autoresolveErrorMessage(err)) ||
          t("autoresolve.missing.addFailed", { mcp: mcp.value });
      },
    },
  );
};
</script>
