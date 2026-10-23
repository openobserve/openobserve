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
    size="sm"
    :title="t('fleet.move.title', { count: collectorIds.length }, collectorIds.length)"
    :primary-button-label="t('fleet.move.confirm')"
    :primary-button-disabled="!target || tooMany"
    :primary-button-loading="move.isPending.value"
    :secondary-button-label="t('common.cancel')"
    data-test="fleet-move-dialog"
    @update:open="(v: boolean) => emit('update:open', v)"
    @click:secondary="emit('update:open', false)"
    @click:primary="submit"
  >
    <div class="flex flex-col gap-4">
      <OSelect
        v-model="target"
        :label="t('fleet.move.destination')"
        :options="options"
        :placeholder="t('fleet.move.pick')"
        data-test="fleet-move-dialog-target"
      />
      <OText v-if="effect" variant="meta" data-test="fleet-move-dialog-effect">{{ effect }}</OText>
      <OBanner
        v-if="tooMany"
        variant="warning"
        dense
        :content="t('fleet.move.tooMany', { max: MAX_MOVE })"
        data-test="fleet-move-dialog-too-many"
      />
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation } from "@tanstack/vue-query";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOrgId } from "@/composables/query/useOrgId";
import { moveCollectorsMutation } from "@/services/fleet.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { serverMessage, useFleets } from "./useFleetApi";

const props = defineProps<{
  open: boolean;
  collectorIds: string[];
  /** The fleet every selected collector is in, left out of the choices; empty for a mixed selection. */
  sourceFleetId?: string;
}>();
const emit = defineEmits<{ "update:open": [open: boolean]; moved: [] }>();

// The bulk move endpoint takes at most this many collectors per call.
const MAX_MOVE = 1000;

const { t } = useI18nTyped();
const orgId = useOrgId();
const fleets = useFleets(() => props.open);
const move = useMutation(() => moveCollectorsMutation(orgId.value));
const target = ref<string | null>(null);

watch(
  () => props.open,
  (open) => open && (target.value = null),
);

const tooMany = computed(() => props.collectorIds.length > MAX_MOVE);
const options = computed(() =>
  fleets.rows.value
    .filter((f) => f.readable && f.id !== props.sourceFleetId)
    .map((f) => ({ label: raw(f.name), value: f.id })),
);

// A move is an immediate assignment of the destination's stable version, not a rollout.
const effect = computed<I18nText | null>(() => {
  const f = fleets.rows.value.find((x) => x.id === target.value);
  if (!f) return null;
  return f.stable
    ? t("fleet.move.receivesStable", {
        fleet: raw(f.name),
        config: raw(f.stable.config),
        version: f.stable.version,
      })
    : t("fleet.move.receivesPlaceholder", { fleet: raw(f.name) });
});

async function submit() {
  const to = target.value;
  if (!to || tooMany.value) return;
  try {
    const res = await move.mutateAsync({ ids: props.collectorIds, to });
    const count = res?.moved ?? props.collectorIds.length;
    toast({ variant: "success", message: t("fleet.move.moved", { count }, count) });
    emit("update:open", false);
    emit("moved");
  } catch (err) {
    toast({
      variant: "error",
      message: raw(serverMessage(err)) || t("fleet.common.requestFailed"),
    });
  }
}
</script>
