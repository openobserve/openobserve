// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed } from "vue";

import { STARTER_PACKS_ENABLED } from "@/constants/starterPacks";
import type { Notice } from "@/lib/feedback/NoticeBar/ONoticeBar.types";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";

import { staleSinceText } from "./usePackHealth";
import type { StarterPackPage } from "./useStarterPackPage";

const HOUR_US = 60 * 60 * 1_000_000;
const STOPPED_KEYS = [
  "starterPacks.page.notice.stopped",
  "starterPacks.page.notice.stoppedMore",
] as const;
const NEVER_KEYS = [
  "starterPacks.page.notice.never",
  "starterPacks.page.notice.neverMore",
] as const;

export interface NoticeActions {
  retry: () => void;
  repair: () => void;
  routeAlerts: () => void;
  checkCollector: () => void;
  undo: () => void;
}

/** The page's notices in the design's order; the bar sorts by tone and keeps this order inside one. */
export function useStarterPackNotices(page: StarterPackPage, actions: NoticeActions) {
  const { t, locale } = useI18nTyped();
  const { flow, updates } = page;
  const pack = flow.pack;
  const title = computed(() => t(pack.titleKey));
  const act = <T extends object>(enabled: boolean, extra: T) => (enabled ? extra : {});

  const partlyFailed = (): Notice[] => {
    const failed = page.failedItems.value.length;
    if (!failed) return [];
    const total = flow.items.value.length;
    return [
      {
        key: "failed",
        tone: "error",
        text: t("starterPacks.page.notice.partlyFailed", { failed, total }),
        ...act(page.canManage.value, { actionLabel: t("common.retry"), onAction: actions.retry }),
        dataTest: "starter-pack-page-notice-failed",
      },
    ];
  };

  const renamed = (): Notice[] => {
    const issue = page.repairIssue.value;
    if (!issue || !page.canManage.value) return [];
    const stream = raw(issue.from);
    const alerts = t("starterPacks.countAlerts", { count: issue.alerts }, issue.alerts);
    const panels = t("starterPacks.page.notice.panels", { count: issue.panels }, issue.panels);
    const text =
      issue.alerts && issue.panels
        ? t("starterPacks.page.notice.renamedBoth", { stream, alerts, panels })
        : t("starterPacks.page.notice.renamed", { stream, what: issue.panels ? panels : alerts });
    return [
      {
        key: "repair",
        tone: "error",
        text,
        actionLabel: t("starterPacks.page.notice.repair"),
        onAction: actions.repair,
        dataTest: "starter-pack-page-notice-repair",
      },
    ];
  };

  const silent = (): Notice[] => {
    const count = page.silentIds.value.size;
    if (!count) return [];
    return [
      {
        key: "silent",
        tone: "warning",
        text: t("starterPacks.page.notice.silentFired", { count }, count),
        actionLabel: t("starterPacks.page.notice.routeAlerts"),
        onAction: actions.routeAlerts,
        dataTest: "starter-pack-page-notice-silent",
      },
    ];
  };

  const collector = () =>
    act(!!pack.collectorRoute, {
      actionLabel: t("starterPacks.health.checkCollector"),
      onAction: actions.checkCollector,
    });

  // Many streams would make the notice unreadable, so the first is named and the rest counted.
  const streamText = (
    rows: { name: string }[],
    keys: readonly [I18nKey, I18nKey],
    params: Record<string, unknown>,
  ) => {
    const stream = raw(rows[0].name);
    const more = rows.length - 1;
    if (!more) return t(keys[0], { stream, ...params });
    return t(keys[1], { stream, count: more, ...params }, more);
  };

  const noData = (): Notice[] => {
    // The longest outage leads, so the date shown is when data first went missing.
    const stopped = page.brokenStreams.value
      .filter(({ state }) => state === "stopped")
      .sort((a, b) => (a.lastUs ?? 0) - (b.lastUs ?? 0));
    const never = page.brokenStreams.value.filter(({ state }) => state === "never");
    return [
      ...(stopped.length
        ? [
            {
              key: "stopped",
              tone: "warning" as const,
              text: streamText(stopped, STOPPED_KEYS, {
                since: raw(staleSinceText(stopped[0].lastUs)),
              }),
              ...collector(),
              dataTest: "starter-pack-page-notice-stopped",
            },
          ]
        : []),
      ...(never.length
        ? [
            {
              key: "never",
              tone: "warning" as const,
              text: streamText(never, NEVER_KEYS, { title: title.value }),
              ...collector(),
              dataTest: "starter-pack-page-notice-never",
            },
          ]
        : []),
    ];
  };

  const paused = (): Notice[] => {
    const count = page.pausedRows.value.length;
    if (!count) return [];
    const text = pack.pausedImpactKey
      ? t("starterPacks.page.notice.paused", { count, impact: t(pack.pausedImpactKey) }, count)
      : t("starterPacks.page.notice.pausedPlain", { count }, count);
    return [{ key: "paused", tone: "warning", text, dataTest: "starter-pack-page-notice-paused" }];
  };

  const planChanged = (): Notice[] =>
    STARTER_PACKS_ENABLED && page.canManage.value && updates.needsDashboard.value
      ? [
          {
            key: "plan",
            tone: "info",
            text: t("starterPacks.page.notice.planChanged", { title: title.value }),
            actionLabel: t("starterPacks.page.addDashboardBtn"),
            onAction: () => void updates.addDashboard(),
            dataTest: "starter-pack-page-notice-plan",
          },
        ]
      : [];

  const justUpdated = (): Notice[] =>
    STARTER_PACKS_ENABLED && page.canManage.value && updates.canRevert.value
      ? [
          {
            key: "updated",
            tone: "info",
            text: t("starterPacks.page.notice.updated", {
              version: raw(flow.record.value?.version ?? pack.version),
            }),
            actionLabel: t("starterPacks.update.revert"),
            onAction: () => void updates.revert(),
            dataTest: "starter-pack-page-notice-updated",
          },
        ]
      : [];

  const undoWindow = (): Notice[] => {
    if (!flow.canUndo.value || !page.canManage.value) return [];
    const hours = Math.floor(flow.undoLeftUs.value / HOUR_US);
    const left = hours
      ? t("starterPacks.page.notice.hoursLeft", { hours })
      : t("starterPacks.page.notice.leftSoon");
    return [
      {
        key: "undo",
        tone: "info",
        text: t("starterPacks.page.notice.undo", { left }),
        actionLabel: t("starterPacks.page.undoSetup"),
        onAction: actions.undo,
        dataTest: "starter-pack-page-notice-undo",
      },
    ];
  };

  const notSetUp = (): Notice[] => {
    const dashboards = flow.dashboardCount.value;
    const alerts = flow.alertCount.value;
    const views = flow.viewCount.value;
    // Without the preview there is nothing true to say about what setup adds.
    if (dashboards === null || alerts === null || views === null) return [];
    const parts = [
      t("starterPacks.page.notice.countDashboards", { count: dashboards }, dashboards),
      t("starterPacks.page.notice.countAlertsPaused", { count: alerts }, alerts),
      t("starterPacks.countViews", { count: views }, views),
    ].filter((_, index) => [dashboards, alerts, views][index] > 0);
    const what = new Intl.ListFormat(String(locale.value), { type: "conjunction" }).format(parts);
    return [
      {
        key: "notSetUp",
        tone: "info",
        text: t("starterPacks.page.notice.notSetUp", {
          what: raw(what),
          folder: raw(pack.folder.name),
        }),
        dataTest: "starter-pack-page-notice-not-set-up",
      },
    ];
  };

  const notices = computed<Notice[]>(() => {
    if (page.pageState.value === "empty") return notSetUp();
    if (!page.installed.value) return [];
    return [
      ...partlyFailed(),
      ...renamed(),
      ...silent(),
      ...noData(),
      ...paused(),
      ...planChanged(),
      ...justUpdated(),
      ...undoWindow(),
    ];
  });

  return { notices };
}
