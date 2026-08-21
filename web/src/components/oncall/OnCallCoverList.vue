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
  The covers standing over this team's rotations, as rows.

  A cover used to appear only as a "· override" annotation on a calendar cell:
  no reason, no whose-shift, no way to see two of them stacked on one window,
  and no way to take one back. `GET .../overrides` and `DELETE .../overrides/{id}`
  both existed and neither had a caller, so from the UI a cover was permanent —
  somebody who arranged the wrong week could only arrange another on top of it.

  Overlaps are legal and the newest wins, so the list is ordered by `created_at`
  descending: the row at the top of an overlapping pair is the one in force.
-->
<template>
  <div
    class="card-container rounded-surface bg-surface-base border-border-default flex flex-col gap-2 border px-4 py-3"
    data-test="oncall-cover-list"
  >
    <span class="flex flex-wrap items-baseline gap-x-2">
      <OText variant="panel-title">{{ t("oncall.coverListTitle") }}</OText>
      <OText variant="meta">{{ t("oncall.coverListHint") }}</OText>
    </span>

    <OTable
      v-if="covers.length || loading"
      :data="covers"
      :columns="columns"
      row-key="id"
      :frame="false"
      :loading="loading"
      pagination="client"
      :show-global-filter="false"
      table-id="oncall-team-covers"
      data-test="oncall-cover-table"
    >
      <template #cell-who="{ row }">
        <span class="flex flex-wrap items-center gap-1">
          <OUserCell :value="row.user_email" />
          <!-- Which rotation it stands over. Only when the team staffs more
               than one — otherwise it is the answer to a question nobody on
               this team can ask. -->
          <OTag v-if="rotations.length > 1" variant="default-soft" size="xs">
            {{ rotationName(row.rotation_id) }}
          </OTag>
        </span>
      </template>

      <!-- Optional on the wire, and legitimately so: "cover tonight" is a real
           request before anybody has worked out whose night it is. -->
      <template #cell-coveringFor="{ row }">
        <OUserCell v-if="row.covering_for" :value="row.covering_for" />
        <OText v-else variant="meta">{{ t("oncall.coverForNobodyNamed") }}</OText>
      </template>

      <template #cell-window="{ row }">
        <OText variant="meta">{{ raw(windowOf(row)) }}</OText>
      </template>

      <template #cell-reason="{ row }">
        <OText v-if="row.reason" variant="meta">{{ raw(row.reason) }}</OText>
        <OText v-else variant="meta">{{ raw("—") }}</OText>
      </template>

      <template #cell-actions="{ row }">
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="delete-outline"
          :aria-label="t('oncall.coverRemove')"
          :data-test="`oncall-cover-remove-${row.id}`"
          @click.stop="toRemove = row"
        />
      </template>
    </OTable>

    <OText v-else variant="meta" data-test="oncall-cover-empty">
      {{ t("oncall.coverListEmpty") }}
    </OText>

    <!-- Deleting a cover puts the rotation back in charge of that window, and
         who that is is not always obvious from the row. The confirm says the
         window rather than only the name. -->
    <ODialog
      :open="!!toRemove"
      :title="t('oncall.coverRemoveTitle')"
      :primary-button-label="t('oncall.coverRemove')"
      :secondary-button-label="t('oncall.cancel')"
      :primary-button-loading="removing"
      data-test="oncall-cover-remove-dialog"
      @update:open="(v: boolean) => !v && (toRemove = null)"
      @click:primary="removeCover"
      @click:secondary="toRemove = null"
    >
      <OText v-if="toRemove">
        {{
          t("oncall.coverRemoveBody", {
            who: raw(toRemove.user_email),
            range: raw(windowOf(toRemove)),
          })
        }}
      </OText>
    </ODialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import oncallService from "@/services/oncall";
import type { Override, Rotation } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatInZone } from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    teamId: string;
    timezone?: string;
    /**
     * The window the calendar above is showing, so the two agree about what
     * "this schedule" means. Both bounds or neither — the endpoint refuses a
     * half-specified window rather than quietly answering the unfiltered list.
     */
    window?: { from: number; to: number } | null;
    /**
     * The team's rotations, so the chip naming one appears only where there is
     * a choice — and so an id can be shown as the name somebody recognises.
     */
    rotations?: Rotation[];
  }>(),
  { timezone: "UTC", window: null, rotations: () => [] },
);

const emit = defineEmits<{ changed: [] }>();

const { t } = useI18nTyped();

/// A cover stores the rotation's **id**; the chip has to show the name. An
/// unknown id is a rotation the team has deleted since — worth saying rather
/// than printing an identifier nobody can look up.
function rotationName(rotationId: string) {
  const found = props.rotations.find((rotation) => rotation.id === rotationId);
  return found ? raw(found.name) : t("oncall.coverRotationGone");
}
const store = useStore();
const orgId = computed(() => store.state.selectedOrganization.identifier);

const covers = ref<Override[]>([]);
const loading = ref(false);
const removing = ref(false);
const toRemove = ref<Override | null>(null);

const columns = computed<OTableColumnDef<Override>[]>(() => [
  {
    id: "who",
    header: t("oncall.coverWho"),
    accessorFn: (row: Override) => row.user_email,
    meta: { isName: true },
  },
  {
    id: "coveringFor",
    header: t("oncall.coverForColumn"),
    accessorFn: (row: Override) => row.covering_for ?? "",
  },
  {
    id: "window",
    header: t("oncall.coverWhen"),
    accessorFn: (row: Override) => row.start_at,
  },
  {
    id: "reason",
    header: t("oncall.coverReasonColumn"),
    accessorFn: (row: Override) => row.reason ?? "",
    hideable: true,
  },
  {
    id: "actions",
    header: t("oncall.actions"),
    isAction: true,
    sortable: false,
    size: 80,
    meta: { align: "center", cellClass: "actions-column", actionCount: 1 },
  },
]);

function windowOf(cover: Override): string {
  const fmt = (micros: number) =>
    formatInZone(micros, props.timezone, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return `${fmt(cover.start_at)} – ${fmt(cover.end_at)}`;
}

/// Newest first, because that is the one in force where two overlap. The
/// endpoint already answers in this order for the unfiltered read; sorting
/// here keeps it true for the windowed one as well.
async function fetchCovers() {
  loading.value = true;
  try {
    const res = await oncallService.listOverrides({
      org_identifier: orgId.value,
      team_id: props.teamId,
      ...(props.window ? { from: props.window.from, to: props.window.to } : {}),
    });
    covers.value = [...(res.data ?? [])].sort(
      (a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id),
    );
  } catch {
    // A cover list that cannot load is not worth an error over the calendar it
    // sits under — the calendar still answers who is on call, which is the
    // question people came with.
    covers.value = [];
  } finally {
    loading.value = false;
  }
}

async function removeCover() {
  const cover = toRemove.value;
  if (!cover) return;
  removing.value = true;
  try {
    await oncallService.deleteOverride({
      org_identifier: orgId.value,
      team_id: props.teamId,
      override_id: cover.id,
    });
    toast({ variant: "success", message: t("oncall.coverRemoved") });
    toRemove.value = null;
    await fetchCovers();
    // The calendar above is resolved server-side, so it has to be re-asked:
    // the window this cover held now belongs to the rotation again.
    emit("changed");
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.coverRemoveFailed"),
    });
  } finally {
    removing.value = false;
  }
}

watch(() => [props.teamId, props.window?.from, props.window?.to], fetchCovers, {
  immediate: true,
});

defineExpose({ refresh: fetchCovers });
</script>
