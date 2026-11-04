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
  Alerts that fired and woke nobody, because no rule claimed them.

  These never became a page at all — nobody was called and nobody declined, so
  they appear in no incident list and no postmortem. The queue is org-wide by
  design: a path nobody owns is not any one team's problem to see, and the fix
  is for whichever team recognises the dimensions to claim it.

  Claiming writes an ownership rule for the exact dimensions that went
  unmatched, which is why the row drops out afterwards — the path is now owned,
  so it stops being unrouted.
-->
<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3" data-test="oncall-unrouted">
    <span
      v-if="showHeader"
      class="flex flex-wrap items-baseline gap-x-2 gap-y-1"
      data-test="oncall-unrouted-header"
    >
      <OText variant="panel-title">{{ t("oncall.unroutedTitle") }}</OText>
      <!-- Bulk claim needs a team to claim FOR, so it only renders where the
           host screen supplies one. The org queue claims row by row, because
           "assign everything unowned to one team" is rarely the true intent. -->
      <OButton
        v-if="signals.length && teamName"
        variant="primary"
        size="sm"
        icon-left="add"
        class="ms-auto"
        :loading="claiming"
        data-test="oncall-unrouted-claim-all"
        @click="emit('claim-all', signals)"
      >
        {{ t("oncall.unroutedClaimAll", { count: signals.length }) }}
      </OButton>
    </span>

    <OTable
      :data="signals"
      :columns="columns"
      row-key="id"
      :frame="false"
      :loading="loading"
      :error="error || null"
      show-index
      pagination="client"
      :global-filter="search"
      :show-global-filter="false"
      :row-class="rowClass"
      table-id="oncall-unrouted-queue"
      :persist-columns="true"
      :enable-column-resize="true"
      data-test="oncall-unrouted-table"
    >
      <template v-if="$slots.toolbar" #toolbar><slot name="toolbar" /></template>
      <template v-if="$slots['toolbar-trailing']" #toolbar-trailing>
        <slot name="toolbar-trailing" />
      </template>

      <!-- Inside the table, so the host's toolbar — and the way back to the other tab — stays up. -->
      <template #error>
        <OEmptyState
          size="block"
          preset="load-error"
          :title="error || undefined"
          data-test="oncall-unrouted-error"
          @action="emit('retry')"
        />
      </template>

      <template #cell-signal="{ row }">
        <span class="flex min-w-0 items-center gap-2">
          <!-- Dismissing stamps the field and keeps the row — the evidence that
               a page fell through is worth more than a tidy table. -->
          <OTag
            v-if="row.dismissed_at"
            variant="default-soft"
            size="sm"
            class="shrink-0"
            :data-test="`oncall-unrouted-dismissed-${row.id}`"
          >
            {{ t("oncall.unroutedDismissedTag") }}
          </OTag>
          <OTruncatedText class="text-text-heading">{{ titleOf(row) }}</OTruncatedText>
        </span>
      </template>

      <!-- Identity only: pod names and status codes are evidence about one firing, not what a rule pins. -->
      <template #cell-path="{ row }">
        <OnCallFitChips
          :items="pathChips(row)"
          :tooltip="pathChipsText(row)"
          :data-test="`oncall-unrouted-path-${row.id}`"
        >
          <template #item="{ item }">
            <ODimensionChip :dim-key="item.name" :key-label="item.label" :value="item.value" />
          </template>
        </OnCallFitChips>
      </template>

      <template #cell-fires="{ row }">
        <span class="text-text-body tabular-nums" :data-test="`oncall-unrouted-fires-${row.id}`">
          {{ row.occurrences }}
        </span>
      </template>

      <template #cell-last="{ row }">
        <OTimeCell
          :value="row.last_seen_at"
          unit="us"
          :timezone="timezone"
          :empty-label="raw('—')"
        />
      </template>

      <!-- §G.3: two different emergencies share this queue. A row the default
           team absorbed is an ownership gap that PAGED somebody; a row with no
           `defaulted_team_id` woke nobody at all. An operator triages those in
           opposite orders, so the row must say which it is. -->
      <template #cell-outcome="{ row }">
        <OTag
          v-if="row.defaulted_team_id"
          type="oncallUnroutedOutcome"
          value="default_team"
          size="sm"
          :data-test="`oncall-unrouted-defaulted-${row.id}`"
        >
          {{ t("oncall.unroutedAbsorbedBy", { team: raw(teamNameOf(row.defaulted_team_id)) }) }}
        </OTag>
        <OTag
          v-else
          type="oncallUnroutedOutcome"
          value="nobody"
          size="sm"
          :data-test="`oncall-unrouted-nobody-${row.id}`"
        />
      </template>

      <template #cell-actions="{ row }">
        <span class="flex items-center justify-end gap-1">
          <OButton
            variant="outline-primary"
            size="xs"
            icon-left="alt-route"
            class="max-md:hidden"
            :data-test="`oncall-unrouted-claim-${row.id}`"
            @click.stop="emit('claim', row)"
          >
            {{ claimLabel }}
          </OButton>
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="close"
            class="max-md:hidden"
            :aria-label="t('oncall.routingNotOurs')"
            :data-test="`oncall-unrouted-dismiss-${row.id}`"
            @click.stop="emit('dismiss', row)"
          >
            <OTooltip side="bottom" :content="t('oncall.routingNotOurs')" />
          </OButton>
          <ODropdown side="bottom" align="end">
            <template #trigger>
              <OButton
                icon-left="more-vert"
                variant="ghost"
                size="icon-xs-sq"
                class="md:hidden"
                :aria-label="t('oncall.moreActions')"
                data-test="oncall-unrouted-row-more-actions"
                @click.stop
              />
            </template>
            <ODropdownItem
              icon-left="alt-route"
              class="md:hidden"
              :data-test="`oncall-unrouted-claim-${row.id}-menu`"
              @select="emit('claim', row)"
            >
              <span>{{ claimLabel }}</span>
            </ODropdownItem>
            <ODropdownItem
              icon-left="close"
              class="md:hidden"
              :data-test="`oncall-unrouted-dismiss-${row.id}-menu`"
              @select="emit('dismiss', row)"
            >
              <span>{{ t("oncall.routingNotOurs") }}</span>
            </ODropdownItem>
          </ODropdown>
        </span>
      </template>

      <!-- Silence here is the good outcome, so it gets a sentence rather than
           an empty panel somebody has to interpret. -->
      <template #empty>
        <!-- An empty search result says nothing about whether alerts reached a team. -->
        <template v-if="!loading">
          <OEmptyState
            v-if="search"
            size="block"
            preset="no-oncall-unrouted"
            filtered
            data-test="oncall-unrouted-empty"
            @action="onEmptyAction"
          />
          <OEmptyState
            v-else
            size="block"
            preset="no-oncall-unrouted"
            data-test="oncall-unrouted-empty"
          />
        </template>
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";

import OnCallFitChips from "@/components/oncall/OnCallFitChips.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { UnroutedSignal } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  claimableDimensions,
  dimensionsSentence,
  fieldLabel,
  identityDimensions,
} from "@/utils/oncall";

/// Beyond this a row grows taller than the rest; the remainder sits behind "+N".

export interface UnroutedFilters {
  landing?: "default_team" | "nobody";
  include_dismissed: boolean;
}

const props = withDefaults(
  defineProps<{
    signals?: UnroutedSignal[];
    /** The team a claim would assign to — this screen's team. */
    teamName?: string;
    /** Resolves `defaulted_team_id` to a name the operator recognises. */
    teams?: { id: string; name: string }[];
    loading?: boolean;
    claiming?: boolean;
    /** Hosts that already name the section — a tab strip, a page header — turn
     *  the title row off rather than repeat themselves. */
    showHeader?: boolean;
    search?: string;
    /** The queue's own failure, shown in the table body with a Retry. */
    error?: I18nText | "";
  }>(),
  {
    signals: () => [],
    teamName: "",
    teams: () => [],
    loading: false,
    claiming: false,
    showHeader: true,
    search: "",
    error: "",
  },
);

const emit = defineEmits<{
  (e: "claim", signal: UnroutedSignal): void;
  (e: "claim-all", signals: UnroutedSignal[]): void;
  (e: "dismiss", signal: UnroutedSignal): void;
  (e: "retry"): void;
  (e: "clear-search"): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const timezone = computed<string | undefined>(() => store.state.timezone || undefined);

const claimLabel = computed<I18nText>(() =>
  props.teamName
    ? t("oncall.unroutedClaimFor", { team: raw(props.teamName) })
    : t("oncall.unroutedClaimShort"),
);

const columns = computed<OTableColumnDef<UnroutedSignal>[]>(() => [
  {
    id: "signal",
    header: t("oncall.unroutedSignal"),
    accessorFn: (row: UnroutedSignal) => String(titleOf(row)),
    meta: { isName: true },
  },
  {
    id: "path",
    header: t("oncall.unroutedPath"),
    size: 280,
    minSize: 220,
    sortable: false,
    hideable: true,
    accessorFn: (row: UnroutedSignal) => routablePathOf(row),
    meta: { cellOverflowTooltip: false },
  },
  {
    id: "fires",
    header: t("oncall.unroutedFiresHeader"),
    size: 150,
    hideable: true,
    accessorFn: (row: UnroutedSignal) => row.occurrences,
  },
  {
    id: "last",
    header: t("oncall.unroutedLastSeen"),
    size: 130,
    hideable: true,
    accessorFn: (row: UnroutedSignal) => row.last_seen_at ?? 0,
  },
  {
    id: "outcome",
    header: t("oncall.unroutedOutcome"),
    size: 170,
    sortable: false,
    hideable: true,
    // The team's name, not its id: search has to match what the cell shows.
    accessorFn: (row: UnroutedSignal) =>
      row.defaulted_team_id
        ? teamNameOf(row.defaulted_team_id)
        : String(t("oncall.unroutedPagedNobody")),
  },
  {
    id: "actions",
    header: t("oncall.actions"),
    isAction: true,
    pinned: "right",
    sortable: false,
    size: 160,
    meta: { align: "center", cellClass: "actions-column", actionCount: 2 },
  },
]);

/// A dismissed row stays in the table as the record, dimmed so the outstanding
/// work still reads first.
function rowClass(row: UnroutedSignal): string {
  return row.dismissed_at ? "opacity-60" : "";
}

/// The alert's own title when the server captured one. Its `description` is
/// the fallback because the empty-path case reads nothing like the normal one,
/// and that is exactly the branch a client composing its own sentence gets
/// wrong.
function titleOf(signal: UnroutedSignal): I18nText {
  return raw(signal.last_title) || raw(signal.description);
}

/// The dimensions are the actionable part: they are what a rule would be
/// written against.
function pathOf(signal: UnroutedSignal): string {
  return dimensionsSentence(signal.dimensions) || signal.path;
}

/// The id is the honest fallback: it is what the wire said, and a renamed or
/// deleted team should not make the row lie about who was paged.
function teamNameOf(teamId: string): string {
  return props.teams.find((team) => team.id === teamId)?.name || teamId;
}

/// Only the identity dimensions — the ones the claim will write into a rule.
/// The row shows exactly what claiming does, and the full evidence stays a
/// hover away for whoever is identifying the alert.
function routablePathOf(signal: UnroutedSignal): string {
  const kept = identityDimensions(signal.dimensions);
  return Object.keys(kept).length ? dimensionsSentence(kept) : pathOf(signal);
}

function pathChips(signal: UnroutedSignal) {
  const dims = claimableDimensions(signal.dimensions);
  return Object.keys(dims)
    .sort()
    .map((name) => ({ name, label: fieldLabel(name), value: dims[name] }));
}

function pathChipsText(signal: UnroutedSignal): I18nText {
  return raw(
    pathChips(signal)
      .map((chip) => `${chip.label} ${chip.value}`)
      .join(" · "),
  );
}

function onEmptyAction(id?: string) {
  if (id === "clear-filters") emit("clear-search");
}
</script>
