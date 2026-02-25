// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * useTracesTableColumns
 *
 * Returns TanStack ColumnDef[] for the traces search-result table.
 * Complex cells (timestamp, service, latency) are defined as lightweight
 * Vue components at module level so they are only created once.
 * Simple cells (duration, spans, status, LLM numbers) use inline h() calls.
 *
 * Usage:
 *   const columns = useTracesTableColumns(hasLlmTraces)  // Ref<boolean>
 *   // columns is a ComputedRef<ColumnDef<Record<string,any>>[]>
 */

import {
  computed,
  defineComponent,
  h,
  onBeforeMount,
  ref,
  watch,
  type Ref,
} from "vue";
import { QBadge, QTooltip, date as qDate } from "quasar";
import { type ColumnDef } from "@tanstack/vue-table";
import { useStore } from "vuex";
import useTraces from "@/composables/useTraces";
import { formatTimeWithSuffix } from "@/utils/zincutils";
import {
  extractLLMData,
  formatCost,
  formatTokens,
  isLLMTrace,
} from "@/utils/llmUtils";

// ─────────────────────────────────────────────────────────────────────────────
// Moment.js — shared promise so all TimestampCell instances reuse one import
// ─────────────────────────────────────────────────────────────────────────────
let _moment: any = null;
const _momentReady = import("moment-timezone").then((m) => {
  _moment = m.default;
});

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatTimeTo12Hour(date: Date): string {
  let hr = date.getHours();
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ampm = hr >= 12 ? "PM" : "AM";
  hr = hr % 12 || 12;
  return `${String(hr).padStart(2, "0")}:${m}:${s} ${ampm}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TimestampCell
// ─────────────────────────────────────────────────────────────────────────────
const TimestampCell = defineComponent({
  name: "TimestampCell",
  props: {
    item: { type: Object as () => Record<string, any>, required: true },
  },
  setup(props) {
    const store = useStore();
    const formatted = ref({ day: "", time: "" });

    function buildFormatted() {
      if (!_moment) return;
      const tz = store.state.timezone;
      const ts = (props.item.trace_start_time || 0) / 1000;
      const FMT = "YYYY-MM-DD HH:mm:ss";
      const dateStr = _moment.tz(new Date(ts), tz).format(FMT);
      const nowStr = _moment.tz(new Date(), tz).format(FMT);
      const diffSec = qDate.getDateDiff(nowStr, dateStr, "seconds");

      let day = "";
      if (diffSec < 86400) day = "Today";
      else if (diffSec < 86400 * 2) day = "Yesterday";
      else {
        const d = new Date(dateStr);
        day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
      }
      formatted.value = { day, time: formatTimeTo12Hour(new Date(dateStr)) };
    }

    watch(() => props.item?.trace_start_time, buildFormatted);

    onBeforeMount(async () => {
      await _momentReady;
      buildFormatted();
    });

    return () =>
      h(
        "div",
        {
          class: "column justify-center",
          "data-test": "trace-row-timestamp",
        },
        [
          h(
            "span",
            {
              class:
                "text-caption text-weight-medium tw:text-[var(--o2-text-1)]!",
              "data-test": "trace-row-timestamp-day",
            },
            `${formatted.value.day} ${formatted.value.time}`,
          ),
        ],
      );
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ServiceCell
// ─────────────────────────────────────────────────────────────────────────────
const ServiceCell = defineComponent({
  name: "ServiceCell",
  props: {
    item: { type: Object as () => Record<string, any>, required: true },
  },
  setup(props) {
    const { searchObj } = useTraces();
    const serviceColors = computed(() => searchObj.meta.serviceColors ?? {});

    const rootColor = computed(
      () => serviceColors.value[props.item.service_name] ?? "#9e9e9e",
    );

    const extraServices = computed(() => {
      const svcs = props.item.services ?? {};
      return Object.keys(svcs)
        .filter((s) => s !== props.item.service_name)
        .map((s) => ({ name: s, color: serviceColors.value[s] ?? "#9e9e9e" }));
    });

    return () => {
      const nodes: any[] = [
        // Service colour dot
        h("span", {
          "data-test": "trace-row-service-dot",
          class: "q-mr-sm",
          style: {
            display: "inline-block",
            width: "10px",
            height: "10px",
            borderRadius: "50%",
            flexShrink: "0",
            backgroundColor: rootColor.value,
            boxShadow: `0 0 0.5rem ${rootColor.value}`,
          },
        }),

        // Service name + operation
        h("div", { class: "column", style: "min-width: 0" }, [
          h(
            "span",
            {
              "data-test": "trace-row-service-name",
              class:
                "text-weight-bold ellipsis tw:text-[var(--o2-text-4)]! tw:text-[0.875rem]! tw:tracking-[0.03rem]!",
            },
            props.item.service_name,
          ),
          h(
            "span",
            {
              "data-test": "trace-row-operation-name",
              class:
                "text-caption text-grey-6 ellipsis tw:text-[var(--o2-text-1)]!",
            },
            props.item.operation_name,
          ),
        ]),
      ];

      // +N more badge for multi-service traces
      if (extraServices.value.length > 0) {
        nodes.push(
          h(
            QBadge,
            {
              "data-test": "trace-row-extra-services",
              label: `+${extraServices.value.length}`,
              class:
                "tw:bg-[var(--o2-tag-grey-2)]! tw:text-[var(--o2-text-1)]! tw:px-[0.5rem]! tw:py-[0.25rem]! tw:ml-[0.325rem]",
            },
            {
              default: () =>
                h(
                  QTooltip,
                  {
                    anchor: "bottom middle",
                    self: "top middle",
                    class: "extra-services-tooltip",
                  },
                  {
                    default: () =>
                      extraServices.value.map((svc) =>
                        h("div", { class: "tw:flex tw:items-center" }, [
                          h("div", {
                            style: {
                              height: "0.5rem",
                              width: "0.5rem",
                              borderRadius: "2px",
                              marginRight: "0.5rem",
                              backgroundColor: svc.color,
                              boxShadow: `0 0 0.5rem ${svc.color}`,
                            },
                          }),
                          h(
                            "span",
                            {
                              class:
                                "text-weight-bold ellipsis tw:text-[var(--o2-text-4)]! tw:text-[0.875rem]! tw:tracking-[0.03rem]!",
                            },
                            svc.name,
                          ),
                        ]),
                      ),
                  },
                ),
            },
          ),
        );
      }

      return h(
        "div",
        { class: "row items-center", "data-test": "trace-row-service" },
        nodes,
      );
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// LatencyCell
// ─────────────────────────────────────────────────────────────────────────────
const LatencyCell = defineComponent({
  name: "LatencyCell",
  props: {
    item: { type: Object as () => Record<string, any>, required: true },
  },
  setup(props) {
    const { searchObj } = useTraces();
    const serviceColors = computed(() => searchObj.meta.serviceColors ?? {});

    const totalDuration = computed(() => {
      const svcs = props.item.services ?? {};
      return (
        Object.values(svcs).reduce<number>(
          (acc, svc) => acc + ((svc as any).duration ?? 0),
          0,
        ) || 1
      );
    });

    return () => {
      const svcs = props.item.services ?? {};
      const segments = Object.entries(svcs).map(([service, svc]) =>
        h(
          "div",
          {
            "data-test": "trace-row-latency-segment",
            style: {
              width: `${(((svc as any).duration ?? 0) / totalDuration.value) * 100}%`,
              backgroundColor: serviceColors.value[service] || "#9e9e9e",
              height: "100%",
              minWidth: "2px",
            },
          },
          [
            h(
              QTooltip,
              {
                class:
                  "tw:font-bold ellipsis tw:text-[var(--o2-text-4)]! tw:text-[0.875rem]! tw:tracking-[0.03rem]!",
              },
              {
                default: () =>
                  `${service}: ${((((svc as any).duration ?? 0) / totalDuration.value) * 100).toFixed(1)}%`,
              },
            ),
          ],
        ),
      );

      return h(
        "div",
        {
          "data-test": "trace-row-latency-bar",
          class: "row no-wrap",
          style: {
            height: "0.85rem",
            borderRadius: "4px",
            overflow: "hidden",
            width: "100%",
            background: "var(--o2-border-color, rgba(0, 0, 0, 0.08))",
          },
        },
        segments,
      );
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// renderStatusPill — pure render function (no reactive deps needed)
// ─────────────────────────────────────────────────────────────────────────────
function renderStatusPill(item: Record<string, any>) {
  const hasErrors = (item.errors ?? 0) > 0;
  const label = hasErrors
    ? `${item.errors} ERROR${item.errors !== 1 ? "S" : ""}`
    : "SUCCESS";

  const pillBg = hasErrors
    ? "rgba(244, 67, 54, 0.12)"
    : "rgba(76, 175, 80, 0.12)";
  const pillColor = hasErrors
    ? "var(--q-negative, #c62828)"
    : "var(--q-positive, #388e3c)";
  const dotColor = hasErrors
    ? "var(--q-negative, #f44336)"
    : "var(--q-positive, #4caf50)";

  return h(
    "div",
    {
      "data-test": "trace-row-status-pill",
      style: {
        borderRadius: "12px",
        padding: "2px 10px",
        display: "inline-flex",
        alignItems: "center",
        width: "fit-content",
        background: pillBg,
        color: pillColor,
      },
    },
    [
      h("span", {
        class: "q-mr-xs",
        style: {
          display: "inline-block",
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          flexShrink: "0",
          backgroundColor: dotColor,
        },
      }),
      h(
        "span",
        {
          style: {
            fontSize: "0.7rem",
            letterSpacing: "0.03em",
            textTransform: "uppercase",
            fontWeight: "bold",
          },
        },
        label,
      ),
    ],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Composable
// ─────────────────────────────────────────────────────────────────────────────
export function useTracesTableColumns(showLlmColumns: Ref<boolean>) {
  return computed<ColumnDef<Record<string, any>>[]>(() => {
    const base: ColumnDef<Record<string, any>>[] = [
      {
        id: "timestamp",
        header: "TIMESTAMP",
        size: 160,
        cell: (info) => h(TimestampCell, { item: info.row.original }),
      },
      {
        id: "service_operation",
        header: "SERVICE & OPERATION",
        meta: { grow: true, minWidth: 180 },
        cell: (info) => h(ServiceCell, { item: info.row.original }),
      },
      {
        id: "duration",
        header: "DURATION",
        size: 120,
        cell: (info) =>
          h(
            "span",
            { class: "text-caption", "data-test": "trace-row-duration" },
            formatTimeWithSuffix(info.row.original.duration) || "0us",
          ),
      },
      {
        id: "spans",
        header: "SPANS",
        size: 100,
        meta: { align: "center" },
        cell: (info) =>
          h(QBadge, {
            "data-test": "trace-row-spans-badge",
            label: info.row.original.spans,
            class:
              "tw:bg-[var(--o2-tag-grey-2)]! tw:text-[var(--o2-text-1)]! tw:px-[0.5rem]! tw:py-[0.325rem]!",
          }),
      },
      {
        id: "status",
        header: "STATUS",
        size: 160,
        meta: { align: "center" },
        cell: (info) => renderStatusPill(info.row.original),
      },
    ];

    const llm: ColumnDef<Record<string, any>>[] = showLlmColumns.value
      ? [
          {
            id: "input_tokens",
            header: "INPUT TOKENS",
            size: 110,
            meta: { align: "right" },
            cell: (info) => {
              const d = isLLMTrace(info.row.original)
                ? extractLLMData(info.row.original)
                : null;
              return h(
                "span",
                {
                  class: "text-caption",
                  "data-test": "trace-row-input-tokens",
                },
                d ? formatTokens(d.usage.input) : "-",
              );
            },
          },
          {
            id: "output_tokens",
            header: "OUTPUT TOKENS",
            size: 110,
            meta: { align: "right" },
            cell: (info) => {
              const d = isLLMTrace(info.row.original)
                ? extractLLMData(info.row.original)
                : null;
              return h(
                "span",
                {
                  class: "text-caption",
                  "data-test": "trace-row-output-tokens",
                },
                d ? formatTokens(d.usage.output) : "-",
              );
            },
          },
          {
            id: "cost",
            header: "COST",
            size: 80,
            meta: { align: "right" },
            cell: (info) => {
              const d = isLLMTrace(info.row.original)
                ? extractLLMData(info.row.original)
                : null;
              return h(
                "span",
                { class: "text-caption", "data-test": "trace-row-cost" },
                d ? `$${formatCost(d.cost.total)}` : "-",
              );
            },
          },
        ]
      : [];

    const tail: ColumnDef<Record<string, any>>[] = [
      {
        id: "service_latency",
        header: "SERVICE LATENCY",
        size: 160,
        cell: (info) =>
          h(LatencyCell, {
            "data-test": "trace-row-latency",
            item: info.row.original,
          }),
      },
    ];

    return [...base, ...llm, ...tail];
  });
}
