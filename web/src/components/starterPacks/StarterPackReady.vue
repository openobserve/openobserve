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

<script setup lang="ts">
import { computed, ref } from "vue";
import type { RouteLocationRaw } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OText from "@/lib/core/Typography/OText.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { EmailMeFailure } from "@/composables/starterPacks/useEmailMeDestination";
import { packScope } from "@/composables/starterPacks/packCopy";
import { packTitle } from "@/composables/starterPacks/usePackCatalog";
import type { PackRecordItem } from "@/composables/starterPacks/types";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";

/** What step 1 asked of the alerts, and how the Email me save went. */
export interface ReadyAlerts {
  turnOn: boolean;
  sendTo: boolean;
  /** The destination as the select showed it. */
  destination?: I18nText;
  /** The destination's own name, for the progress row. */
  name?: string;
  /** Set when the destination is the user's own Email me one. */
  email?: string;
  failure?: EmailMeFailure;
}

type Kind = "dashboard" | "alert" | "savedView";

interface ViewRow {
  key: string;
  name: I18nText;
  summary?: string;
  icon: IconName;
  iconClass: string;
  failed: boolean;
  status?: I18nText;
  to?: RouteLocationRaw;
}

interface ViewGroup {
  id: "view" | Kind;
  title: I18nText;
  meta: I18nText;
  icon: IconName;
  to?: RouteLocationRaw;
  /** A one-item group whose item was not created, so it carries the row's Retry. */
  failed?: boolean;
  /** Some or all of the group's items were not created. */
  look?: "partial" | "failed";
  /** Only a group of several items lists them; one item is the group itself. */
  rows: ViewRow[];
}

const props = defineProps<{
  flow: StarterPackFlow;
  clusters: string[];
  /** Ready says how the setup went above the groups; View Pack shows the groups only. */
  mode: "ready" | "installed";
  alerts?: ReadyAlerts;
}>();
const emit = defineEmits<{ go: [to: RouteLocationRaw]; retry: [] }>();

const { t } = useI18nTyped();

const ROWS_SHOWN = 5;
const KINDS: Kind[] = ["dashboard", "alert", "savedView"];
const KIND_ICONS: Record<Kind, IconName> = {
  dashboard: "dashboard",
  alert: "notifications",
  savedView: "bookmark",
};
const CHIP_LOOKS: Record<"done" | "partial" | "failed", { class: string; icon: IconName }> = {
  done: { class: "bg-icon-chip-success-bg text-icon-chip-success-text", icon: "check" },
  partial: { class: "bg-icon-chip-warning-bg text-icon-chip-warning-text", icon: "warning" },
  failed: { class: "bg-icon-chip-error-bg text-icon-chip-error-text", icon: "error" },
};

const flow = props.flow;
const pack = flow.pack;
const title = packTitle(pack);
const expanded = ref<Partial<Record<ViewGroup["id"], boolean>>>({});
const showAll = ref(new Set<string>());

const summaryOf = (item: PackRecordItem): string | undefined => {
  if (item.kind === "alert") return pack.alertSummaries?.[item.copyOf ?? item.itemId];
  if (item.kind === "dashboard")
    return pack.dashboards.find(({ id }) => id === item.itemId)?.summary;
  return pack.savedViews.find(({ id }) => id === item.itemId)?.summary;
};
const isOn = (item: PackRecordItem) => !!item.id && flow.enabledAlertIds.value.has(item.id);
const created = (items: PackRecordItem[]) => items.filter(({ status }) => status === "created");

const rowOf = (item: PackRecordItem): ViewRow => {
  const base = {
    key: item.itemId,
    name: raw(flow.nameOf(item.itemId)),
    summary: summaryOf(item),
  };
  if (item.status === "failed") {
    return { ...base, icon: "error", iconClass: "text-status-error-text", failed: true };
  }
  if (item.kind !== "alert") {
    return {
      ...base,
      icon: KIND_ICONS[item.kind as Kind],
      iconClass: "text-text-secondary",
      failed: false,
      to: flow.itemRoute(item),
    };
  }
  const on = isOn(item);
  return {
    ...base,
    icon: on ? "notifications-active" : "notifications-off",
    iconClass: on ? "text-status-positive" : "text-text-secondary",
    failed: false,
    status: t(on ? "starterPacks.viewPack.on" : "starterPacks.viewPack.silent"),
    to: flow.itemRoute(item),
  };
};

const alertsMeta = (items: PackRecordItem[]) => {
  const made = created(items);
  const on = made.filter(isOn).length;
  const failed = items.length - made.length;
  const counts = { count: items.length, on, silent: made.length - on, failed };
  return failed
    ? t("starterPacks.viewPack.alertsMetaFailed", counts)
    : t("starterPacks.viewPack.alertsMeta", counts);
};

const kindGroup = (kind: Kind, items: PackRecordItem[]): ViewGroup => {
  const single = items.length === 1 ? items[0] : null;
  const listRoute: Record<Kind, RouteLocationRaw> = {
    dashboard: flow.dashboardsRoute.value,
    alert: flow.alertsRoute.value,
    savedView: { name: "logs", query: { org_identifier: flow.org } },
  };
  const titles: Record<Kind, I18nText> = {
    dashboard: t("starterPacks.viewPack.dashboards"),
    alert: t("starterPacks.viewPack.alerts"),
    savedView: t("starterPacks.viewPack.savedViews"),
  };
  const metas: Record<Kind, I18nText> = {
    dashboard: single
      ? t("starterPacks.viewPack.dashboard")
      : t("starterPacks.viewPack.dashboardsMeta", { count: items.length }, items.length),
    alert: alertsMeta(items),
    savedView: single
      ? t("starterPacks.viewPack.savedView")
      : t("starterPacks.viewPack.savedViewsMeta", { count: items.length }, items.length),
  };
  const made = created(items).length;
  const failed = items.length - made;
  const singleFailed = single?.status === "failed";
  const partialMeta = t("starterPacks.viewPack.partialSubtitle", {
    made,
    total: items.length,
    failed,
  });
  let meta = metas[kind];
  if (singleFailed) meta = t("starterPacks.viewPack.notCreated");
  else if (failed && kind !== "alert") meta = partialMeta;
  return {
    id: kind,
    title: single ? raw(flow.nameOf(single.itemId)) : titles[kind],
    meta,
    icon: KIND_ICONS[kind],
    to: made ? (single ? flow.itemRoute(single) : listRoute[kind]) : undefined,
    failed: singleFailed,
    look: made ? (failed ? "partial" : undefined) : "failed",
    rows: single ? [] : items.map(rowOf),
  };
};

const groups = computed<ViewGroup[]>(() => {
  const view: ViewGroup[] =
    pack.nativeView && flow.licensed.value
      ? [
          {
            id: "view",
            title: t("starterPacks.drawer.view"),
            meta: t("starterPacks.drawer.viewPath"),
            icon: "hub",
            to: { name: pack.nativeView.route, query: { org_identifier: flow.org } },
            rows: [],
          },
        ]
      : [];
  const kinds = KINDS.flatMap((kind) => {
    const items = flow.items.value.filter(
      (item) => item.kind === kind && (item.status === "created" || item.status === "failed"),
    );
    return items.length ? [kindGroup(kind, items)] : [];
  });
  return [...view, ...kinds];
});

const isOpen = (group: ViewGroup) => expanded.value[group.id] ?? group.id === "alert";
const toggle = (group: ViewGroup) => {
  if (group.rows.length) expanded.value = { ...expanded.value, [group.id]: !isOpen(group) };
};
const shownRows = (group: ViewGroup) =>
  showAll.value.has(group.id) ? group.rows : group.rows.slice(0, ROWS_SHOWN);
const toggleAll = (group: ViewGroup) => {
  const next = new Set(showAll.value);
  if (next.has(group.id)) next.delete(group.id);
  else next.add(group.id);
  showAll.value = next;
};

const failedCount = computed(() => flow.failed.value.length);
const emailFailedNote = computed<I18nText | undefined>(() => {
  const failure = props.alerts?.failure;
  if (!failure) return undefined;
  return failure === "forbidden"
    ? t("starterPacks.ready.emailForbidden")
    : t("starterPacks.ready.emailFailed");
});
const scope = computed(() => (pack.clusterScoped ? packScope(t, props.clusters) : ""));
</script>

<template>
  <div class="flex flex-col text-sm" data-test="starter-pack-ready">
    <div v-if="mode === 'ready'" class="flex flex-col gap-1 px-4 pt-3.5">
      <h3
        class="text-text-heading m-0 flex items-center gap-2 text-base font-semibold"
        data-test="starter-pack-ready-title"
      >
        <OIcon
          :name="failedCount ? 'warning-filled' : 'check-circle'"
          size="sm"
          :class="['shrink-0', failedCount ? 'text-status-warning-text' : 'text-status-positive']"
        />
        {{
          failedCount
            ? t("starterPacks.viewPack.partialTitle", { title, count: failedCount }, failedCount)
            : t("starterPacks.ready.title", { title })
        }}
      </h3>
      <OText
        v-if="failedCount"
        variant="meta"
        class="ps-6"
        wrap
        data-test="starter-pack-ready-partial-note"
        >{{ t("starterPacks.viewPack.partialNote") }}</OText
      >
      <span
        v-if="emailFailedNote"
        class="flex items-start gap-2 text-xs"
        data-test="starter-pack-ready-email-failed"
      >
        <OIcon name="warning" size="sm" class="text-status-warning-text mt-px shrink-0" />
        <OText variant="meta" wrap>{{ emailFailedNote }}</OText>
      </span>
    </div>

    <div class="flex flex-col gap-2 px-4 py-3">
      <section
        v-for="group in groups"
        :key="group.id"
        class="border-border-default rounded-default overflow-hidden border"
        :data-test="`starter-pack-view-group-${group.id}`"
      >
        <div
          :class="[
            'flex items-center gap-3 px-3 py-2.5',
            group.rows.length && 'hover:bg-surface-subtle cursor-pointer',
          ]"
          @click="toggle(group)"
        >
          <span
            :class="[
              'rounded-default flex size-7 shrink-0 items-center justify-center',
              CHIP_LOOKS[group.look ?? 'done'].class,
            ]"
          >
            <OIcon :name="CHIP_LOOKS[group.look ?? 'done'].icon" size="sm" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col">
            <span
              class="text-text-heading truncate font-semibold"
              data-test="starter-pack-view-group-title"
              >{{ group.title }}</span
            >
            <OText variant="meta" class="truncate" data-test="starter-pack-view-group-meta">{{
              group.meta
            }}</OText>
          </div>
          <span
            v-if="group.failed"
            class="text-status-error-text flex shrink-0 items-center gap-1.5 text-xs"
            data-test="starter-pack-view-row-failed"
          >
            <span v-if="flow.forbidden.value" class="text-text-secondary">{{
              t("starterPacks.askAdmin")
            }}</span>
            <OButton
              v-else
              variant="ghost-primary"
              size="xs"
              data-test="starter-pack-view-row-retry"
              @click.stop="emit('retry')"
            >
              {{ t("common.retry") }}
            </OButton>
          </span>
          <OButton
            v-else-if="group.to"
            variant="outline"
            size="xs"
            icon-right="arrow-forward"
            :aria-label="t('starterPacks.viewPack.openLabel', { name: group.title })"
            data-test="starter-pack-view-group-open"
            @click.stop="group.to && emit('go', group.to)"
          >
            {{ t("starterPacks.viewPack.open") }}
          </OButton>
          <span class="flex w-4 shrink-0 justify-center">
            <OButton
              v-if="group.rows.length"
              variant="ghost-muted"
              size="icon-xs"
              :icon-left="isOpen(group) ? 'expand-less' : 'expand-more'"
              :aria-label="isOpen(group) ? t('common.collapse') : t('common.expand')"
              :aria-expanded="isOpen(group)"
              data-test="starter-pack-view-group-expand"
              @click.stop="toggle(group)"
            />
          </span>
        </div>
        <template v-if="group.rows.length && isOpen(group)">
          <component
            :is="row.to ? 'button' : 'div'"
            v-for="row in shownRows(group)"
            :key="row.key"
            :type="row.to ? 'button' : undefined"
            :class="[
              'border-border-default flex min-h-9 w-full items-center gap-3 border-t px-3 text-left',
              row.to &&
                'hover:bg-surface-subtle focus-visible:bg-surface-subtle cursor-pointer outline-none',
            ]"
            :data-test="`starter-pack-view-${group.id}-row`"
            @click="row.to && emit('go', row.to)"
          >
            <span class="flex w-7 shrink-0 justify-center">
              <OIcon :name="row.icon" size="sm" :class="row.iconClass" />
            </span>
            <span class="text-text-heading shrink-0 font-medium">{{ row.name }}</span>
            <OText variant="meta" class="min-w-0 flex-1 truncate">{{
              row.summary ? raw(row.summary) : ""
            }}</OText>
            <span
              v-if="row.failed"
              class="text-status-error-text flex shrink-0 items-center gap-1.5 text-xs"
              data-test="starter-pack-view-row-failed"
            >
              {{ t("starterPacks.viewPack.notCreated") }}
              <span aria-hidden="true">{{ raw("·") }}</span>
              <span v-if="flow.forbidden.value" class="text-text-secondary">{{
                t("starterPacks.askAdmin")
              }}</span>
              <OButton
                v-else
                variant="ghost-primary"
                size="xs"
                data-test="starter-pack-view-row-retry"
                @click.stop="emit('retry')"
              >
                {{ t("common.retry") }}
              </OButton>
            </span>
            <template v-else>
              <OText v-if="row.status" variant="meta" class="shrink-0">{{ row.status }}</OText>
              <OIcon name="arrow-forward" size="sm" class="text-accent shrink-0" />
            </template>
          </component>
          <button
            v-if="group.rows.length > ROWS_SHOWN"
            type="button"
            class="border-border-default text-accent hover:bg-surface-subtle flex min-h-9 w-full cursor-pointer items-center gap-1 border-t ps-13 pe-3 text-left font-semibold"
            data-test="starter-pack-view-show-more"
            @click="toggleAll(group)"
          >
            {{
              showAll.has(group.id)
                ? t("starterPacks.viewPack.showLess")
                : t(
                    "starterPacks.viewPack.showMore",
                    { count: group.rows.length - ROWS_SHOWN },
                    group.rows.length - ROWS_SHOWN,
                  )
            }}
            <OIcon :name="showAll.has(group.id) ? 'expand-less' : 'expand-more'" size="sm" />
          </button>
        </template>
      </section>
    </div>

    <div class="text-text-secondary flex flex-col gap-1.5 px-4 pb-3.5 text-xs">
      <span v-if="scope" class="flex items-start gap-2">
        <OIcon name="public" size="sm" class="shrink-0" />
        <span data-test="starter-pack-progress-scope">{{ scope }}</span>
      </span>
      <span class="flex items-start gap-2">
        <OIcon name="info" size="sm" class="shrink-0" />
        <span data-test="starter-pack-view-ordinary">{{
          t("starterPacks.viewPack.ordinary")
        }}</span>
      </span>
    </div>
  </div>
</template>
