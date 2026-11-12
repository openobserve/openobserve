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
  <!-- Nothing at all without covers: the timeline and its legend already say there are none. -->
  <section v-if="covers.length" class="flex flex-col gap-2" data-test="oncall-cover-list">
    <span class="flex flex-wrap items-baseline gap-x-2">
      <OText variant="section" as="h3" data-test="oncall-cover-list-title">
        {{ t("oncall.coverListCount", { count: covers.length }) }}
      </OText>
      <OText variant="meta" data-test="oncall-cover-list-zone">
        {{ t("oncall.timesInZone", { zone: raw(timezone) }) }}
      </OText>
    </span>

    <OTable
      :data="covers"
      :columns="columns"
      row-key="id"
      :frame="false"
      :loading-reset-key="teamId"
      pagination="client"
      :show-global-filter="false"
      :column-visibility="{ reason: false }"
      :persist-columns="true"
      table-id="oncall-team-covers"
      data-test="oncall-cover-table"
    >
      <template #cell-who="{ row }">
        <OnCallPersonName truncate :email="row.user_email" />
      </template>

      <!-- Optional on the wire, and legitimately so: "cover tonight" is a real
           request before anybody has worked out whose night it is. -->
      <template #cell-coveringFor="{ row }">
        <OnCallPersonName v-if="row.covering_for" truncate :email="row.covering_for" />
        <OText v-else variant="meta">{{ t("oncall.coverForNobodyNamed") }}</OText>
      </template>

      <template #cell-rotation="{ row }">
        <OText variant="meta">{{ rotationName(row.rotation_id) }}</OText>
      </template>

      <template #cell-window="{ row }">
        <OText variant="meta">{{ raw(windowOf(row)) }}</OText>
      </template>

      <template #cell-reason="{ row }">
        <OText v-if="row.reason" variant="meta">{{ raw(row.reason) }}</OText>
        <OText v-else variant="meta">{{ raw("—") }}</OText>
      </template>

      <template #cell-actions="{ row }">
        <div class="flex items-center justify-end">
          <OButton
            variant="ghost-destructive"
            size="icon-sm"
            icon-left="delete-outline"
            :aria-label="t('oncall.coverRemove')"
            :data-test="`oncall-cover-remove-${row.id}`"
            @click.stop="openRemove(row)"
          >
            <OTooltip side="bottom" :content="t('oncall.coverRemove')" />
          </OButton>
        </div>
      </template>
    </OTable>
  </section>

  <!-- Deleting a cover hands the window back to the rotation, so the confirm names the window, not only the person. -->
  <ODialog
    :open="!!toRemove"
    :title="t('oncall.coverRemoveTitle')"
    :primary-button-label="t('oncall.coverRemove')"
    :secondary-button-label="t('oncall.cancel')"
    primary-button-variant="destructive"
    :primary-button-loading="removing"
    data-test="oncall-cover-remove-dialog"
    @update:open="(v: boolean) => !v && (toRemove = null)"
    @click:primary="removeCover"
    @click:secondary="toRemove = null"
  >
    <OText v-if="shownRemove">
      <i18n-t keypath="oncall.coverRemoveBody" tag="span">
        <template #who>
          <OnCallPersonName
            :email="shownRemove.user_email"
            data-test="oncall-cover-remove-name"
            class="text-text-heading font-semibold"
          />
        </template>
        <template #range>{{ windowOf(shownRemove) }}</template>
      </i18n-t>
    </OText>
  </ODialog>
</template>

<script setup lang="ts">
import { useMutation } from "@tanstack/vue-query";
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";

import { queryClient } from "@/composables/query/queryClient";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OnCallPersonName from "./OnCallPersonName.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { deleteOverrideMutation, teamOverridesQuery } from "@/services/oncall.queries";
import type { Override, Rotation } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { licenseDeniedFeatures } from "@/utils/featureGate";
import { formatInZone } from "@/utils/oncall";
import { serverMessageOf } from "@/utils/slackLink";

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
    /**
     * Show only the covers standing over ONE rotation, by id.
     *
     * A cover replaces the holder of one position and leaves the others alone,
     * so "which covers apply to this rotation" is a real question — and on a
     * team with three of them the unfiltered list answers it by making the
     * reader check every chip.
     */
    rotationId?: string | null;
  }>(),
  { timezone: "UTC", window: null, rotations: () => [], rotationId: null },
);

const emit = defineEmits<{ changed: []; licenseDenied: [features: string[]] }>();

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
// Set on open and never cleared, so the closing fade keeps the sentence.
const shownRemove = ref<Override | null>(null);

// Getter form, so the write follows an org switch and a change of team.
const removeCoverWrite = useMutation(() => deleteOverrideMutation(orgId.value, props.teamId));

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
    id: "rotation",
    header: t("oncall.coverRotationColumn"),
    accessorFn: (row: Override) => row.rotation_id,
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
    pinned: "right",
    meta: { align: "center", actionCount: 1 },
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

// The newest read: a slower answer for a window the calendar has already left must not overwrite the list.
let latestCoversRead = 0;

async function fetchCovers(force = false) {
  // A parent window still at 0 is not yet initialised; the endpoint rejects it with a 400.
  if (props.window && (!props.window.from || !props.window.to)) return;
  loading.value = true;
  const readId = ++latestCoversRead;
  try {
    const options = teamOverridesQuery(
      orgId.value,
      props.teamId,
      props.window?.from,
      props.window?.to,
    );
    // Only a user-initiated refresh must reach the server; every other read takes the cache.
    if (force) {
      await queryClient.invalidateQueries({
        queryKey: options.queryKey,
        exact: true,
        refetchType: "none",
      });
    }
    const res = await queryClient.fetchQuery(options);
    if (readId !== latestCoversRead) return;
    // Filtered here rather than per rotation: N requests to narrow a list already in hand.
    const all = props.rotationId
      ? res.filter((cover) => cover.rotation_id === props.rotationId)
      : res;
    // Newest first, the one in force where two overlap; the windowed read does not promise that order.
    covers.value = [...all].sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
  } catch (err) {
    if (readId !== latestCoversRead) return;
    const denied = licenseDeniedFeatures(err);
    if (denied) emit("licenseDenied", denied);
    // No error over the calendar: it still answers who is on call.
    covers.value = [];
  } finally {
    if (readId === latestCoversRead) loading.value = false;
  }
}

function openRemove(cover: Override) {
  shownRemove.value = cover;
  toRemove.value = cover;
}

async function removeCover() {
  const cover = toRemove.value;
  if (!cover) return;
  removing.value = true;
  try {
    await removeCoverWrite.mutateAsync(cover.id);
    toast({ variant: "success", message: t("oncall.coverRemoved") });
    toRemove.value = null;
    // Unforced: the write expired the entry, so one server read repaints this ref.
    await fetchCovers();
    // The calendar is resolved server-side, so the window this cover held must be re-asked.
    emit("changed");
  } catch (err: unknown) {
    toast({
      variant: "error",
      message: raw(serverMessageOf(err)) || t("oncall.coverRemoveFailed"),
    });
  } finally {
    removing.value = false;
  }
}

// Another team's covers must not linger, deletable, while this team's first read is in flight.
watch([orgId, () => props.teamId], () => {
  latestCoversRead++;
  covers.value = [];
  toRemove.value = null;
  loading.value = false;
});

// Wrapped: a watcher hands its new value to the callback, which `force` would take.
watch(
  () => [props.teamId, props.window?.from, props.window?.to, props.rotationId],
  () => fetchCovers(),
  { immediate: true },
);

// The parent calls this after it changed something the server resolves itself.
const refresh = () => fetchCovers(true);

defineExpose({ refresh });
</script>
