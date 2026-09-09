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

// Kubernetes content pack (design §4.2): drift variants where both collector spellings exist, instant-vector inventory tables.

import { GROUP, STALENESS_24H_US, type CuratedPageManifest, type CuratedPanelDef } from "../types";
import { explorerDrilldown } from "./drilldown";

const CLUSTER = "${f:k8s-cluster}";
const NODE = "${f:k8s-node-name}";
const NS = "${f:k8s-namespace}";
const POD = "${f:k8s-pod-name}";
const CONTAINER = "${f:k8s-container-name}";

/** The fleet quadrant's bubble click, carrying `detail.cluster`; CuratedPageView routes it so the SPA is never torn down. */
export const FLEET_DRILLDOWN_EVENT = "o2-curated-cluster-drilldown";

/** The tab a fleet-quadrant bubble drills into. */
export const FLEET_DRILLDOWN_TAB = "health";

// Author JS for the fleet quadrant: the ${theme:} tokens are resolved by translateTitles (useCuratedPage.ts) because the sandbox CSP blocks every stylesheet.
/* eslint-disable local/no-hardcoded-px -- the tooltip CSS below is serialised by ECharts into its own container, where no CSS cascade resolves rem */
const FLEET_QUADRANT_JS = `
var byCluster = {};
var row = function (name) {
  if (!byCluster[name]) {
    byCluster[name] = { name: name, allocCpu: 0, allocMem: 0, reqCpu: 0, reqMem: 0, running: 0, pending: 0, failed: 0, other: 0, restarts: 0 };
  }
  return byCluster[name];
};
// The cluster field is resolved from \${f:k8s-cluster} at query time, so its spelling is unknown here: prefer a cluster-ish key, else the one label the query did not name.
var NAMED_LABELS = { __name__: 1, resource: 1, phase: 1, le: 1, quantile: 1 };
var clusterOf = function (metric) {
  var keys = Object.keys(metric || {});
  var fallback = "";
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    if (NAMED_LABELS[key]) continue;
    if (key.toLowerCase().indexOf("cluster") >= 0) return String(metric[key]);
    if (!fallback) fallback = String(metric[key]);
  }
  return fallback;
};
var lastValue = function (series) {
  var values = series.values || [];
  if (values.length) return Number(values[values.length - 1][1]) || 0;
  if (series.value) return Number(series.value[1]) || 0;
  return 0;
};
var eachSeries = function (frame, visit) {
  var results = (frame && frame.result) || [];
  for (var i = 0; i < results.length; i++) visit(results[i].metric || {}, lastValue(results[i]));
};

eachSeries(data[0], function (metric, value) {
  var entry = row(clusterOf(metric));
  if (metric.resource === "cpu") entry.allocCpu += value;
  if (metric.resource === "memory") entry.allocMem += value;
});
eachSeries(data[1], function (metric, value) {
  var entry = row(clusterOf(metric));
  if (metric.resource === "cpu") entry.reqCpu += value;
  if (metric.resource === "memory") entry.reqMem += value;
});
eachSeries(data[2], function (metric, value) {
  var entry = row(clusterOf(metric));
  if (metric.phase === "Running") entry.running += value;
  if (metric.phase === "Pending") entry.pending += value;
  if (metric.phase === "Failed") entry.failed += value;
});
eachSeries(data[3], function (metric, value) {
  row(clusterOf(metric)).other += value;
});
eachSeries(data[4], function (metric, value) {
  row(clusterOf(metric)).restarts += value;
});

var pct = function (used, total) {
  return total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
};
var maxCores = 1;
var points = [];
var names = Object.keys(byCluster);
for (var n = 0; n < names.length; n++) {
  var c = byCluster[names[n]];
  if (!c.name) continue;
  if (c.allocCpu > maxCores) maxCores = c.allocCpu;
  points.push({
    name: c.name,
    cpuPct: pct(c.reqCpu, c.allocCpu),
    memPct: pct(c.reqMem, c.allocMem),
    cores: c.allocCpu,
    pods: c.running + c.pending + c.failed + c.other,
    pending: c.pending,
    failed: c.failed,
    restarts: Math.round(c.restarts * 10) / 10,
  });
}

var CRITICAL = "\${theme:chart-critical}";
var WARNING = "\${theme:chart-warning}";
var HEALTHY = "\${theme:chart-healthy}";
var COST = "\${theme:chart-cost}";
var AXIS = "\${theme:chart-axis}";
var LABEL = "\${theme:chart-label}";
var ZONE_LABEL = "\${theme:chart-zone-label}";
var GUIDE = "\${theme:chart-guide}";
var GRID = "\${theme:chart-grid}";
var SURFACE = "\${theme:chart-surface}";
var ZONE_HOT = "\${theme:zone-hot}";
var ZONE_CPU = "\${theme:zone-cpu}";
var ZONE_MEM = "\${theme:zone-mem}";
var ZONE_COLD = "\${theme:zone-cold}";
var ZONE_HOT_INK = "\${theme:zone-hot-ink}";
var ZONE_COLD_INK = "\${theme:zone-cold-ink}";
var ZONE_CPU_INK = "\${theme:zone-cpu-ink}";
var ZONE_MEM_INK = "\${theme:zone-mem-ink}";
var TIP_BG = "\${theme:tooltip-bg}";
var TIP_TEXT = "\${theme:tooltip-text}";
var TIP_BORDER = "\${theme:tooltip-border}";

var HOT = 80;
var COLD = 40;
var FULL = 100;
// Axis chrome, reserved OUTSIDE the square: containLabel would fold the labels back in and make the solved side advisory.
var AXIS_LEFT = 58;
var AXIS_TOP = 24;
var AXIS_BOTTOM = 52;
var AXIS_RIGHT = 18;

// ECharts drops any point outside a fixed axis range, so a hard max:100 would silently ERASE the over-committed cluster this chart exists to surface.
var axisMax = FULL;
for (var m = 0; m < points.length; m++) {
  var worst = Math.max(points[m].cpuPct, points[m].memPct);
  // +10 of headroom: a bubble centred exactly on the axis max is drawn half outside the grid and loses its label.
  if (worst > axisMax) axisMax = Math.ceil(worst / 10) * 10 + 10;
}

var guides = [{ xAxis: HOT }, { yAxis: HOT }];
// Drawn only once something is past it: at exactly 100 the axis edge already IS the line, so a second one there is noise.
if (axisMax > FULL) {
  guides.push({ xAxis: FULL, lineStyle: { color: CRITICAL, type: "dashed", width: 1 } });
  guides.push({ yAxis: FULL, lineStyle: { color: CRITICAL, type: "dashed", width: 1 } });
}

// Health is judged ONLY from fault fields: position already encodes commitment, so counting it twice would paint a busy-but-sound cluster as sick.
var state = function (p) {
  var faults = (p.pending > 1 ? 1 : 0) + (p.restarts > 0 ? 1 : 0) + (p.failed > 0 ? 1 : 0);
  // One fault is an incident; two co-occurring kinds is a pattern, and only a pattern earns the ring.
  if (faults >= 2) return "crit";
  if (p.pending > 0 || p.restarts > 0 || p.failed > 0) return "warn";
  // Requesting MORE than the nodes can allocate is a measured capacity fact, not an inference, so it outranks a clean fault sheet.
  if (p.cpuPct > FULL || p.memPct > FULL) return "warn";
  // Slack on BOTH axes is a cost finding, not a health one, so it is not folded into "healthy".
  if (p.cpuPct < COLD && p.memPct < COLD) return "cost";
  return "ok";
};
var STATE_COLOR = { ok: HEALTHY, warn: WARNING, crit: CRITICAL, cost: COST };
var STATE_LABEL = { ok: "Healthy", warn: "Isolated fault", crit: "Fault pattern", cost: "Over-provisioned" };

// Sizes are baked into each data item, never a symbolSize callback: a function crossing the sandbox is serialized and loses this closure.
// sqrt so AREA, not radius, tracks allocatable cores — a radius-linear bubble overstates a big cluster fourfold.
var radius = function (cores) {
  return 9 + 25 * Math.sqrt((cores > 0 ? cores : 0) / maxCores);
};

// Sorted by x so the alternating left/right assignment below makes NEIGHBOURS lean apart, which fanning by input order does not.
points.sort(function (a, b) {
  return a.cpuPct - b.cpuPct;
});

// Centres a SQUARE plot in whatever canvas it is given: both axes span the same 0..axisMax domain, so any other aspect draws the 45-degree diagonal at atan(h/w).
var solveGrid = function (w, h) {
  var side = Math.min(w - AXIS_LEFT - AXIS_RIGHT, h - AXIS_TOP - AXIS_BOTTOM);
  if (side < 40) side = 40;
  var slackX = w - AXIS_LEFT - AXIS_RIGHT - side;
  var slackY = h - AXIS_TOP - AXIS_BOTTOM - side;
  if (slackX < 0) slackX = 0;
  if (slackY < 0) slackY = 0;
  var halfX = Math.round(slackX / 2);
  var halfY = Math.round(slackY / 2);
  return {
    left: AXIS_LEFT + halfX,
    right: AXIS_RIGHT + (slackX - halfX),
    top: AXIS_TOP + halfY,
    bottom: AXIS_BOTTOM + (slackY - halfY),
    containLabel: false,
  };
};

var zone = function (x0, x1, y0, y1, fill, text, pos, labelColor) {
  return [
    {
      coord: [x0, y0],
      itemStyle: { color: fill },
      label: { show: true, formatter: text, position: pos, color: labelColor || ZONE_LABEL, fontSize: 11, fontWeight: 700, padding: [8, 10] },
    },
    { coord: [x1, y1] },
  ];
};


var critical = [];
var bubbles = [];
for (var q = 0; q < points.length; q++) {
  var pt = points[q];
  var st = state(pt);
  var isCrit = st === "crit";
  if (isCrit) {
    critical.push({
      name: pt.name,
      value: [pt.cpuPct, pt.memPct, pt.cores],
      symbolSize: radius(pt.cores) * 2 + 15,
    });
  }
  bubbles.push({
    name: pt.name,
    value: [pt.cpuPct, pt.memPct, pt.cores],
    symbolSize: radius(pt.cores) * 2,
    meta: pt,
    stateLabel: STATE_LABEL[st],
    stateColor: STATE_COLOR[st],
    z: isCrit ? 12 : 5,
    itemStyle: {
      color: STATE_COLOR[st],
      opacity: isCrit ? 1 : 0.88,
      borderColor: SURFACE,
      borderWidth: 2,
    },
    label: {
      show: true,
      position: q % 2 ? "right" : "left",
      distance: isCrit ? 15 : 8,
      formatter: "{b}",
      color: isCrit ? CRITICAL : LABEL,
      fontSize: 11,
      fontWeight: isCrit ? 700 : 500,
      // Surface-coloured halo keeps a name legible wherever it crosses a bubble.
      textBorderColor: SURFACE,
      textBorderWidth: 3,
    },
  });
}

option = {
  backgroundColor: "transparent",
  // Off deliberately: the renderer re-runs setOption on every data identity change, and a re-entry animation reads as a flicker.
  animation: false,
  tooltip: {
    // "item", not the house "axis": a scatter has no shared category, so per-point is the only correct trigger.
    trigger: "item",
    confine: true,
    appendToBody: false,
    transitionDuration: 0,
    enterable: false,
    className: "o2-echarts-tooltip",
    backgroundColor: TIP_BG,
    borderColor: TIP_BORDER,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: TIP_TEXT, fontSize: 12 },
    extraCssText: "max-width: 500px; user-select: text; border-radius: 8px !important;",
    // No \`&&\` and no HTML entities in this body: DOMPurify.sanitize runs over the serialized function text and would escape them into a syntax error.
    formatter: function (p) {
      if (!p.data) return "";
      var d = p.data.meta;
      if (!d) return "";
      var faults = [];
      if (d.pending) faults.push(d.pending + " pending");
      if (d.failed) faults.push(d.failed + " failed");
      if (d.restarts) faults.push(d.restarts + " restarts/hr");
      return (
        "<b>" + d.name + "</b>" +
        "<br/>" + p.data.stateLabel +
        "<br/>CPU committed " + d.cpuPct + "%" +
        "<br/>Memory committed " + d.memPct + "%" +
        "<br/>Allocatable CPU " + Math.round(d.cores * 10) / 10 + " cores" +
        "<br/>Pods " + d.pods +
        "<br/>" + (faults.length ? faults.join(", ") : "No faults")
      );
    },
  },
  // Seeded square against a mid-range canvas so the FIRST paint is not skewed; o2_events.finished re-solves it against the real one.
  // containLabel false deliberately: it folds the axis labels back inside the grid, which would make the solved square advisory.
  grid: solveGrid(1180, 620),
  xAxis: {
    name: "CPU committed %",
    nameLocation: "middle",
    nameGap: 33,
    type: "value",
    min: 0,
    max: axisMax,
    interval: 20,
    boundaryGap: false,
    axisLine: { lineStyle: { color: AXIS } },
    axisTick: { show: false },
    axisLabel: { color: LABEL, formatter: "{value}%" },
    splitLine: { lineStyle: { color: GRID, type: "dashed", width: 1 } },
  },
  yAxis: {
    name: "Memory committed %",
    nameLocation: "middle",
    nameGap: 44,
    type: "value",
    min: 0,
    max: axisMax,
    interval: 20,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: LABEL, formatter: "{value}%" },
    splitLine: { lineStyle: { color: GRID, type: "dashed", width: 1 } },
  },
  series: [
    {
      // A detached halo, not a thicker border: state survives greyscale and red/green CVD because it is encoded in FORM too.
      type: "scatter",
      symbol: "circle",
      silent: true,
      animation: false,
      z: 10,
      itemStyle: { color: "transparent", borderColor: CRITICAL, borderWidth: 1.6 },
      data: critical,
    },
    {
      type: "scatter",
      symbol: "circle",
      cursor: "pointer",
      data: bubbles,
      // shiftY moves a colliding label instead of dropping it, so every cluster stays named; hideOverlap only culls what still cannot fit.
      labelLayout: { moveOverlap: "shiftY", hideOverlap: true },
      // Pinned rather than left to the default: an unbounded emphasis re-scale is what reads as a hover flicker.
      emphasis: { scale: 1.06, focus: "none" },
      // The quadrants, not the grid, are what make the hot corner legible against the slack one.
      markArea: {
        silent: true,
        z: -10,
        data: [
          zone(0, COLD, 0, COLD, ZONE_COLD, "Over-provisioned", "insideBottomLeft", ZONE_COLD_INK),
          zone(HOT, axisMax, HOT, axisMax, ZONE_HOT, "No headroom", "insideTopRight", ZONE_HOT_INK),
          zone(HOT, axisMax, 0, HOT, ZONE_CPU, "CPU-bound", "insideBottomRight", ZONE_CPU_INK),
          zone(0, HOT, HOT, axisMax, ZONE_MEM, "Memory-bound", "insideTopLeft", ZONE_MEM_INK),
        ],
      },
      markLine: {
        silent: true,
        symbol: "none",
        label: { show: false },
        // GUIDE, not GRID: the quadrant boundary must read above the faint dashed grid without competing with the bubbles.
        lineStyle: { color: GUIDE, type: "solid", width: 1 },
        data: guides,
      },
    },
  ],
  // The handler below is serialized with NO closure, so the axis chrome has to cross as data rather than as captured vars.
  o2_layout: { axisLeft: AXIS_LEFT, axisTop: AXIS_TOP, axisBottom: AXIS_BOTTOM, axisRight: AXIS_RIGHT },
  // Serialized across the sandbox and rebuilt by CustomChartRenderer in the PARENT, which is the only reason this can reach the page at all.
  o2_events: {
    // Announces the pick and lets CuratedPageView route it: location.assign here would tear down and reload the whole SPA.
    // Reaches the document off the chart's own DOM node: every global here would be a free identifier the sandbox never passes in.
    // No "<" and no "&" ANYWHERE in this body: DOMPurify.sanitize runs over the serialized function text, escaping "&" and TRUNCATING the function at "<".
    // The sandbox cannot read the canvas — only \`data\` and \`echarts\` are in scope at build time — so the square is solved HERE, where a live chart exists.
    // \`finished\` fires after every render including every resize(), which is what makes this responsive at all.
    // No "<" and no "&" in this body either: it crosses the same DOMPurify pass as the click handler.
    finished: function (params, chart) {
      // ECharts returns a KNOWN component as an array but hands an unrecognised top-level key straight back as the object it was given.
      var raw = chart.getOption().o2_layout;
      var cfg = raw ? (raw.length === undefined ? raw : raw[0]) : null;
      if (!cfg) return;
      var w = chart.getWidth();
      var h = chart.getHeight();
      var side = Math.min(w - cfg.axisLeft - cfg.axisRight, h - cfg.axisTop - cfg.axisBottom);
      // Clamped via Math.max, never a less-than test: that operator would be TRUNCATED by the DOMPurify pass this handler crosses.
      side = Math.max(side, 40);
      var slackX = Math.max(w - cfg.axisLeft - cfg.axisRight - side, 0);
      var slackY = Math.max(h - cfg.axisTop - cfg.axisBottom - side, 0);
      var halfX = Math.round(slackX / 2);
      var halfY = Math.round(slackY / 2);
      var next = {
        left: cfg.axisLeft + halfX,
        right: cfg.axisRight + (slackX - halfX),
        top: cfg.axisTop + halfY,
        bottom: cfg.axisBottom + (slackY - halfY),
        containLabel: false,
      };
      // Re-entrancy guard: setOption paints, painting fires \`finished\` again, so an unconditional apply never settles.
      // Counted rather than chained with a boolean-and, which DOMPurify would escape into an entity and break the parse.
      var live = (chart.getOption().grid || [])[0] || {};
      var same = 0;
      if (live.left === next.left) same += 1;
      if (live.right === next.right) same += 1;
      if (live.top === next.top) same += 1;
      if (live.bottom === next.bottom) same += 1;
      if (same === 4) return;
      // Deferred because ECharts rejects a setOption issued inside the render pass with "should not be called during main process".
      // Re-measured inside the timer: CustomChartRenderer re-applies the STATIC seeded option on every data refresh, so the size
      // captured above can already be stale by the time this runs, which paints the plot as a narrow strip.
      setTimeout(function () {
        var lw = chart.getWidth();
        var lh = chart.getHeight();
        var lside = Math.max(Math.min(lw - cfg.axisLeft - cfg.axisRight, lh - cfg.axisTop - cfg.axisBottom), 40);
        var lx = Math.max(lw - cfg.axisLeft - cfg.axisRight - lside, 0);
        var ly = Math.max(lh - cfg.axisTop - cfg.axisBottom - lside, 0);
        var lhx = Math.round(lx / 2);
        var lhy = Math.round(ly / 2);
        chart.setOption({
          grid: {
            left: cfg.axisLeft + lhx,
            right: cfg.axisRight + (lx - lhx),
            top: cfg.axisTop + lhy,
            bottom: cfg.axisBottom + (ly - lhy),
            containLabel: false,
          },
        });
      }, 100);
    },
    click: function (params, chart) {
      if (!params.data) return;
      var meta = params.data.meta;
      if (!meta) return;
      var doc = chart.getDom().ownerDocument;
      // Bubbles because the listener sits on the document, not on this chart's container.
      doc.dispatchEvent(
        new CustomEvent("${FLEET_DRILLDOWN_EVENT}", { detail: { cluster: String(meta.name) }, bubbles: true }),
      );
    },
  },
};
`;
/* eslint-enable local/no-hardcoded-px */

/** One-variant panels share this shape; the drilldown always carries variant 1. */
const panel = (
  def: Omit<CuratedPanelDef, "drilldown">,
  drilldownStream: string,
): CuratedPanelDef => ({
  ...def,
  drilldown: [explorerDrilldown(drilldownStream, def.variants[0].queries[0].query)],
});

export const kubernetesPage: CuratedPageManifest = {
  id: "kubernetes",
  titleKey: "infra.workload.kubernetesTitle",
  icon: "hub",
  contentVersion: 1,
  defaultRelativePeriod: "3h",
  stalenessThresholdUs: STALENESS_24H_US,

  groups: [
    {
      id: "kubelet-node",
      labelKey: "infra.k8s.group.nodeMetrics",
      capabilityKey: "infra.k8s.group.nodeMetricsCap",
      setupHintKey: "infra.k8s.group.nodeMetricsHint",
      setup: { kind: "card", slug: "kubernetes" },
      streamType: "metrics",
      // The rung-4a net for an org whose saved override dropped the group, and for OSS until the groups are exposed.
      probeFields: {
        [GROUP.node]: ["k8s_node_name", "k8s_node", "node"],
        [GROUP.cluster]: ["k8s_cluster_name", "k8s_cluster", "cluster"],
      },
    },
    {
      id: "kubelet-pod",
      labelKey: "infra.k8s.group.podMetrics",
      capabilityKey: "infra.k8s.group.podMetricsCap",
      setupHintKey: "infra.k8s.group.podMetricsHint",
      setup: { kind: "card", slug: "kubernetes" },
      streamType: "metrics",
      anchorStream: "k8s_pod_memory_usage",
      // Rung-1 certainty for the labels the utilization tables group BY: a ${f:}
      // token is a REQUIRED concept, so a cluster-less resolution hides the panel
      // instead of collapsing to fleet-wide. Measured, every kubeletstats pod
      // stream carries k8s_cluster (and a dead k8s_cluster_name spelling beside it).
      fieldOverrides: {
        [GROUP.cluster]: "k8s_cluster",
      },
      probeFields: {
        [GROUP.namespace]: ["k8s_namespace_name", "k8s_namespace", "namespace"],
        [GROUP.pod]: ["k8s_pod_name", "k8s_pod", "pod"],
      },
    },
    {
      id: "kube-state",
      labelKey: "infra.k8s.group.kubeState",
      capabilityKey: "infra.k8s.group.kubeStateCap",
      setupHintKey: "infra.k8s.group.kubeStateHint",
      setup: { kind: "card", slug: "kubernetes" },
      streamType: "metrics",
      // kube_pod_status_phase carries no node field at all, while the node panels query kube_node_status_condition, which does.
      fieldOverrides: {
        [GROUP.namespace]: "namespace",
        [GROUP.pod]: "pod",
        [GROUP.node]: "node",
        [GROUP.cluster]: "k8s_cluster",
      },
    },
  ],

  scopePickers: [
    {
      name: "cluster",
      group: GROUP.cluster,
      // Sourced from kube_pod_status_phase, not a kubeletstats stream: measured, both
      // list all 10 clusters, but the SPARSE kube-state families (waiting_reason has 2
      // clusters, HPA conditions 3) only ever appear where kube-state runs, so the
      // values must come from the same collector the health tables query. The picker
      // supplies VALUES only — each panel still spells the label via its own group
      // (resolve.ts:909 prefers panel.resolvedFields), so this is schema-safe for the
      // kubeletstats sections too.
      valuesFrom: { groupId: "kube-state", stream: "kube_pod_status_phase", streamType: "metrics" },
      multiSelect: true,
      // A fleet-wide default mixes ten clusters into one crash-loop list nobody can
      // act on; the first cluster is a readable starting point.
      defaultFirstValue: true,
      omitWhenFieldAbsent: true,
      omitWhenValuesEmpty: true,
    },
    {
      name: "namespace",
      group: GROUP.namespace,
      // Measured: 61 namespaces here against 58 on the kubeletstats stream, and
      // crucially the same collector the health tables filter on — sourcing from
      // kubeletstats offered 46 of 58 namespaces that returned zero health rows.
      valuesFrom: { groupId: "kube-state", stream: "kube_pod_status_phase", streamType: "metrics" },
      multiSelect: true,
      chainedOn: [{ picker: "cluster" }],
      omitWhenValuesEmpty: true,
    },
    {
      name: "pod",
      group: GROUP.pod,
      valuesFrom: { groupId: "kubelet-pod", stream: "k8s_pod_memory_usage", streamType: "metrics" },
      multiSelect: true,
      chainedOn: [{ picker: "namespace" }],
      omitWhenValuesEmpty: true,
    },
  ],

  sections: [
    {
      id: "summary",
      titleKey: "infra.k8s.section.summary",
      // Deliberately unscoped: the over-provisioned corner is only legible NEXT TO
      // the tight one, and filtering to one cluster degenerates the chart to a dot.
      panels: [
        panel(
          {
            id: "k8s_sm_fleet_quadrant",
            titleKey: "infra.k8s.panel.fleetQuadrant",
            type: "custom_chart",
            unit: "percent",
            groupId: "kube-state",
            // 17px gridstack cells: h:39 is the tallest that still fits a 1440x900 viewport unscrolled, and it seats the square plot plus its axis chrome.
            // w:120 of 192 leaves 72 for the resource overview beside it; the quadrant stays the hero, and flowLayout puts them on one row without an engine change.
            layout: { w: 120, h: 39 },
            customChartContent: FLEET_QUADRANT_JS,
            variants: [
              {
                requiresStreams: [
                  "kube_node_status_allocatable",
                  "kube_pod_container_resource_requests",
                  "kube_pod_status_phase",
                  "kube_pod_container_status_restarts_total",
                ],
                queryType: "promql",
                // Each ratio divides two SEPARATE queries, so a range window let the JS take numerator and denominator from different instants (measured 3.6x wrong while autoscaling); staleness at the instant also drops decommissioned clusters.
                queryMode: "instant",
                queries: [
                  // Index 0 must be the allocatable query: convertPanelData.ts:231 gates the
                  // whole chart on data[0].result.length, and a fault query is empty on a
                  // healthy fleet — the panel would blank exactly when nothing is wrong.
                  {
                    query: `sum by (${CLUSTER}, resource) (kube_node_status_allocatable{resource=~"cpu|memory|pods"})`,
                    legend: "",
                  },
                  {
                    query: `sum by (${CLUSTER}, resource) (kube_pod_container_resource_requests{resource=~"cpu|memory"})`,
                    legend: "",
                  },
                  {
                    query: `sum by (${CLUSTER}, phase) (kube_pod_status_phase{phase=~"Running|Pending|Failed"})`,
                    legend: "",
                  },
                  // Running|Pending|Failed are three of five phases, so the fault counts
                  // need the other two to have an honest pod denominator.
                  {
                    query: `sum by (${CLUSTER}, phase) (kube_pod_status_phase{phase=~"Succeeded|Unknown"})`,
                    legend: "",
                  },
                  // A counter read raw ranks a long-lived healthy cluster above one crash-looping now.
                  {
                    query: `sum by (${CLUSTER}) (increase(kube_pod_container_status_restarts_total[1h]))`,
                    legend: "",
                  },
                ],
              },
            ],
          },
          "kube_node_status_allocatable",
        ),
        // The fleet's ABSOLUTE size, which no other tab reports: all 25 panels on
        // Inventory / Nodes / Utilization are cluster-scoped, and the quadrant beside
        // this one plots ratios per cluster. The subject here is the reserved-vs-used
        // GAP — reserving 59% while burning 13% is the finding, and it is only visible
        // with both bars on one axis.
        panel(
          {
            id: "k8s_sm_fleet_resources",
            titleKey: "infra.k8s.panel.fleetResources",
            // "h-bar", not promql "bar": convertPromQLBarChart.ts:138 makes one ROW per
            // series with the category axis taking the series name, so four bare sums with
            // literal legends give four labelled rows. promql "bar" plots x as TIME.
            type: "h-bar",
            // One unit per panel, so cores and bytes cannot share a value axis: both rows
            // are normalised to percent-of-capacity, which is also the comparison the
            // panel is about.
            unit: "percent",
            groupId: "kube-state",
            layout: { w: 72, h: 39 },
            variants: [
              {
                // k8s_node_memory_usage / k8s_node_cpu_usage are kubeletstats and stop on a
                // NotReady node; kept OUT of requiresStreams so the panel still reports
                // capacity and reservation when a node drops. An absent usage query yields
                // NO bar rather than a zero one (dataProcessor.ts maps an empty result to an
                // empty series list), so a gap reads as a gap.
                requiresStreams: [
                  "kube_node_status_allocatable",
                  "kube_pod_container_resource_requests",
                ],
                queryType: "promql",
                // Instant for the same reason as the quadrant: each ratio divides two
                // separate queries, and a range window would take numerator and denominator
                // from different instants.
                queryMode: "instant",
                // Bare sum(), no `by (...)`: a fleet total needs no grouping.
                // Declared BOTTOM-UP: an ECharts category y-axis draws index 0 at the
                // bottom, so this order paints CPU reserved, CPU used, Memory reserved,
                // Memory used from the top down.
                queries: [
                  {
                    query: `sum(k8s_node_memory_usage) / sum(kube_node_status_allocatable{resource="memory"}) * 100`,
                    legend: "Memory used",
                  },
                  {
                    query: `sum(kube_pod_container_resource_requests{resource="memory"}) / sum(kube_node_status_allocatable{resource="memory"}) * 100`,
                    legend: "Memory reserved",
                  },
                  {
                    query: `sum(k8s_node_cpu_usage) / sum(kube_node_status_allocatable{resource="cpu"}) * 100`,
                    legend: "CPU used",
                  },
                  {
                    query: `sum(kube_pod_container_resource_requests{resource="cpu"}) / sum(kube_node_status_allocatable{resource="cpu"}) * 100`,
                    legend: "CPU reserved",
                  },
                ],
              },
            ],
          },
          "kube_node_status_allocatable",
        ),
      ],
    },

    {
      id: "overview",
      titleKey: "infra.k8s.section.overview",
      scopedBy: ["cluster"],
      // Running/Pending/Failed are three of FIVE phases, so the tiles do not sum
      // to the fleet (dry-run finding 10). Stated once for the trio: inlined per
      // tile it consumed the bar and truncated the very titles it qualified.
      noteKey: "infra.k8s.section.overviewNote",
      panels: [
        // Counted from kube-state, the SAME collector as the ready tile beside it: a
        // NotReady node stops emitting kubeletstats entirely, so a kubeletstats
        // denominator shrinks toward the numerator and reads 30/30 exactly when a
        // node has failed — the total must come from the source that still sees it.
        panel(
          {
            id: "k8s_ov_nodes",
            titleKey: "infra.k8s.panel.nodes",
            type: "metric",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            variants: [
              {
                requiresStreams: ["kube_node_status_allocatable"],
                queryType: "promql",
                queries: [
                  {
                    query: `count(count by (${NODE}) (kube_node_status_allocatable{\${scope:cluster}}))`,
                    legend: "",
                  },
                ],
              },
            ],
          },
          "kube_node_status_allocatable",
        ),

        // `status="true"` selects series; the assertion lives in the series VALUE, so counting READY nodes needs `== 1`.
        panel(
          {
            id: "k8s_ov_nodes_ready",
            titleKey: "infra.k8s.panel.nodesReady",
            type: "metric",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            variants: [
              {
                requiresStreams: ["kube_node_status_condition"],
                queryType: "promql",
                queries: [
                  {
                    query:
                      'count(kube_node_status_condition{condition="Ready",status="true",${scope:cluster}} == 1)',
                    legend: "",
                  },
                ],
              },
            ],
          },
          "kube_node_status_condition",
        ),

        panel(
          {
            id: "k8s_ov_pods_running",
            titleKey: "infra.k8s.panel.podsRunning",
            type: "metric",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            variants: [
              {
                requiresStreams: ["kube_pod_status_phase"],
                queryType: "promql",
                queries: [
                  {
                    query: 'sum(kube_pod_status_phase{phase="Running",${scope:cluster}})',
                    legend: "",
                  },
                ],
              },
            ],
          },
          "kube_pod_status_phase",
        ),

        panel(
          {
            id: "k8s_ov_pods_pending",
            titleKey: "infra.k8s.panel.podsPending",
            type: "metric",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            variants: [
              {
                requiresStreams: ["kube_pod_status_phase"],
                queryType: "promql",
                queries: [
                  {
                    query: 'sum(kube_pod_status_phase{phase="Pending",${scope:cluster}})',
                    legend: "",
                  },
                ],
              },
            ],
          },
          "kube_pod_status_phase",
        ),

        panel(
          {
            id: "k8s_ov_pods_failed",
            titleKey: "infra.k8s.panel.podsFailed",
            type: "metric",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            variants: [
              {
                requiresStreams: ["kube_pod_status_phase"],
                queryType: "promql",
                queries: [
                  {
                    query: 'sum(kube_pod_status_phase{phase="Failed",${scope:cluster}})',
                    legend: "",
                  },
                ],
              },
            ],
          },
          "kube_pod_status_phase",
        ),

        // Scoping ONE side of the ratio is the addendum's "lying gauge": measured
        // live, production's used-over-FLEET-allocatable reads 3.76% where the
        // truth is 24.15%. Both sides carry ${scope:cluster} or neither may.
        panel(
          {
            id: "k8s_ov_cpu_used",
            titleKey: "infra.k8s.panel.cpuUsed",
            type: "metric",
            unit: "percent",
            groupId: "kubelet-node",
            layout: { w: 32, h: 6 },
            variants: [
              {
                requiresStreams: ["k8s_node_cpu_usage", "kube_node_status_allocatable"],
                queryType: "promql",
                queries: [
                  {
                    query:
                      'sum(k8s_node_cpu_usage${scope:cluster}) / sum(kube_node_status_allocatable{resource="cpu",${scope:cluster}}) * 100',
                    legend: "",
                  },
                ],
              },
              {
                // No denominator on this org: cores in use, never a percentage
                // of a capacity we cannot see.
                requiresStreams: ["k8s_node_cpu_usage"],
                queryType: "promql",
                unit: "numbers",
                queries: [{ query: "sum(k8s_node_cpu_usage${scope:cluster})", legend: "" }],
              },
            ],
          },
          "k8s_node_cpu_usage",
        ),

        // Five phases exist on a live org, so this chart carries no PHASE filter — the superset the three tiles draw from.
        panel(
          {
            id: "k8s_ov_pods_by_phase",
            titleKey: "infra.k8s.panel.podsByPhase",
            type: "line",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_pod_status_phase"],
                queryType: "promql",
                queries: [
                  {
                    query: "sum by (phase)(kube_pod_status_phase${scope:cluster})",
                    legend: "{phase}",
                  },
                ],
              },
            ],
          },
          "kube_pod_status_phase",
        ),

        panel(
          {
            id: "k8s_ov_node_cpu_top",
            titleKey: "infra.k8s.panel.nodeCpuTop",
            type: "line",
            unit: "percent-1",
            groupId: "kubelet-node",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_node_cpu_utilization"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(10, avg by (${NODE}) (k8s_node_cpu_utilization\${scope:cluster}))`,
                    legend: `{${NODE}}`,
                  },
                ],
              },
              {
                requiresStreams: ["k8s_node_cpu_usage"],
                queryType: "promql",
                unit: "numbers",
                queries: [
                  {
                    query: `topk(10, sum by (${NODE}) (k8s_node_cpu_usage\${scope:cluster}))`,
                    legend: `{${NODE}}`,
                  },
                ],
              },
            ],
          },
          "k8s_node_cpu_utilization",
        ),

        // The inventory the tiles above imply, and it must agree with them: run at
        // the same instant, or a 3h range lists every pod that was ever unhealthy.
        panel(
          {
            id: "k8s_ov_unhealthy_pods",
            titleKey: "infra.k8s.panel.unhealthyPods",
            type: "table",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_pod_status_phase"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `topk(20, sum by (${CLUSTER}, ${NS}, ${POD}, phase)(kube_pod_status_phase{phase=~"Pending|Failed|Unknown",\${scope:cluster}} > 0))`,
                    legend: `{${CLUSTER}} {${NS}}/{${POD}} {phase}`,
                  },
                ],
              },
            ],
          },
          "kube_pod_status_phase",
        ),
      ],
    },

    {
      id: "health",
      titleKey: "infra.k8s.section.health",
      // The caveats belong to the panel SET: waiting containers mix normal startup
      // with real failures, and kube-state exposes only a container's LAST exit.
      noteKey: "infra.k8s.section.healthNote",
      // kube-state omits a family entirely when nothing is in that state, so an
      // empty panel here is GOOD news, not missing data (§ empty-means-healthy).
      emptyMeansHealthy: true,
      scopedBy: ["cluster", "namespace"],
      panels: [
        panel(
          {
            id: "k8s_wh_containers_failing",
            titleKey: "infra.k8s.panel.containersFailing",
            type: "metric",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            fleetWide: ["namespace"],
            variants: [
              {
                requiresStreams: ["kube_pod_container_status_waiting_reason"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `count(count by (${CLUSTER}, ${NS}, ${POD}, ${CONTAINER}) (kube_pod_container_status_waiting_reason{\${scope:cluster},reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull|ErrImageNeverPull|CreateContainerConfigError"} > 0))`,
                    legend: "",
                  },
                ],
              },
            ],
          },
          "kube_pod_container_status_waiting_reason",
        ),
        panel(
          {
            id: "k8s_wh_deploy_short",
            titleKey: "infra.k8s.panel.deploymentsShort",
            type: "metric",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            fleetWide: ["namespace"],
            variants: [
              {
                requiresStreams: [
                  "kube_deployment_spec_replicas",
                  "kube_deployment_status_replicas_ready",
                ],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `count(count by (${CLUSTER}, ${NS}, deployment) (kube_deployment_spec_replicas{\${scope:cluster}} - kube_deployment_status_replicas_ready{\${scope:cluster}} > 0))`,
                    legend: "",
                  },
                ],
              },
            ],
          },
          "kube_deployment_spec_replicas",
        ),
        panel(
          {
            id: "k8s_wh_sts_short",
            titleKey: "infra.k8s.panel.statefulSetsShort",
            type: "metric",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            fleetWide: ["namespace"],
            variants: [
              {
                requiresStreams: [
                  "kube_statefulset_replicas",
                  "kube_statefulset_status_replicas_ready",
                ],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `count(count by (${CLUSTER}, ${NS}, statefulset) (kube_statefulset_replicas{\${scope:cluster}} - kube_statefulset_status_replicas_ready{\${scope:cluster}} > 0))`,
                    legend: "",
                  },
                ],
              },
            ],
          },
          "kube_statefulset_replicas",
        ),
        panel(
          {
            id: "k8s_wh_ds_unavailable",
            titleKey: "infra.k8s.panel.daemonSetsUnavailable",
            type: "metric",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            fleetWide: ["namespace"],
            variants: [
              {
                requiresStreams: ["kube_daemonset_status_number_unavailable"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `count(kube_daemonset_status_number_unavailable{\${scope:cluster}} > 0)`,
                    legend: "",
                  },
                ],
              },
            ],
          },
          "kube_daemonset_status_number_unavailable",
        ),
        panel(
          {
            id: "k8s_wh_jobs_failed",
            titleKey: "infra.k8s.panel.jobsFailed",
            type: "metric",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            fleetWide: ["namespace"],
            variants: [
              {
                requiresStreams: ["kube_job_status_failed"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  { query: `count(kube_job_status_failed{\${scope:cluster}} > 0)`, legend: "" },
                ],
              },
            ],
          },
          "kube_job_status_failed",
        ),
        panel(
          {
            id: "k8s_wh_pvc_unbound",
            titleKey: "infra.k8s.panel.volumeClaimsUnbound",
            type: "metric",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            fleetWide: ["namespace"],
            variants: [
              {
                requiresStreams: ["kube_persistentvolumeclaim_status_phase"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `count(kube_persistentvolumeclaim_status_phase{\${scope:cluster},phase!="Bound"} == 1)`,
                    legend: "",
                  },
                ],
              },
            ],
          },
          "kube_persistentvolumeclaim_status_phase",
        ),
        panel(
          {
            id: "k8s_wh_waiting_top",
            titleKey: "infra.k8s.panel.containersWaitingTop",
            type: "table",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_pod_container_status_waiting_reason"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `topk(20, sum by (${CLUSTER}, ${NS}, ${POD}, ${CONTAINER}, reason) (kube_pod_container_status_waiting_reason{\${scope:cluster},\${scope:namespace},reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull|ErrImageNeverPull|CreateContainerConfigError"} > 0) * 2 or sum by (${CLUSTER}, ${NS}, ${POD}, ${CONTAINER}, reason) (kube_pod_container_status_waiting_reason{\${scope:cluster},\${scope:namespace}} > 0))`,
                    legend: `{${CLUSTER}} {${NS}}/{${POD}}/{${CONTAINER}} {reason}`,
                  },
                ],
              },
            ],
          },
          "kube_pod_container_status_waiting_reason",
        ),
        panel(
          {
            id: "k8s_wh_terminated_top",
            titleKey: "infra.k8s.panel.containersTerminatedTop",
            type: "table",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_pod_container_status_terminated_reason"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `topk(20, sum by (${CLUSTER}, ${NS}, ${POD}, ${CONTAINER}, reason) (kube_pod_container_status_terminated_reason{\${scope:cluster},\${scope:namespace},reason!="Completed"} > 0))`,
                    legend: `{${CLUSTER}} {${NS}}/{${POD}}/{${CONTAINER}} {reason}`,
                  },
                ],
              },
            ],
          },
          "kube_pod_container_status_terminated_reason",
        ),
        panel(
          {
            id: "k8s_wh_hpa_limited",
            titleKey: "infra.k8s.panel.hpaLimitedTop",
            type: "table",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_horizontalpodautoscaler_status_condition"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `topk(20, sum by (${CLUSTER}, ${NS}, horizontalpodautoscaler, condition) (kube_horizontalpodautoscaler_status_condition{\${scope:cluster},\${scope:namespace},condition="ScalingLimited",status="true"} == 1))`,
                    legend: `{${CLUSTER}} {${NS}}/{horizontalpodautoscaler} {condition}`,
                  },
                ],
              },
            ],
          },
          "kube_horizontalpodautoscaler_status_condition",
        ),
        panel(
          {
            id: "k8s_wh_deploy_short_top",
            titleKey: "infra.k8s.panel.deploymentsShortTop",
            type: "table",
            unit: "percent-1",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: [
                  "kube_deployment_spec_replicas",
                  "kube_deployment_status_replicas_ready",
                ],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `topk(20, (sum by (${CLUSTER}, ${NS}, deployment) (kube_deployment_status_replicas_ready{\${scope:cluster},\${scope:namespace}}) / sum by (${CLUSTER}, ${NS}, deployment) (kube_deployment_spec_replicas{\${scope:cluster},\${scope:namespace}})) < 1)`,
                    legend: `{${CLUSTER}} {${NS}}/{deployment}`,
                  },
                ],
              },
            ],
          },
          "kube_deployment_spec_replicas",
        ),
        panel(
          {
            id: "k8s_wh_sts_short_top",
            titleKey: "infra.k8s.panel.statefulSetsShortTop",
            type: "table",
            unit: "percent-1",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: [
                  "kube_statefulset_replicas",
                  "kube_statefulset_status_replicas_ready",
                ],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `topk(20, (sum by (${CLUSTER}, ${NS}, statefulset) (kube_statefulset_status_replicas_ready{\${scope:cluster},\${scope:namespace}}) / sum by (${CLUSTER}, ${NS}, statefulset) (kube_statefulset_replicas{\${scope:cluster},\${scope:namespace}})) < 1)`,
                    legend: `{${CLUSTER}} {${NS}}/{statefulset}`,
                  },
                ],
              },
            ],
          },
          "kube_statefulset_replicas",
        ),
        panel(
          {
            id: "k8s_wh_ds_unavailable_top",
            titleKey: "infra.k8s.panel.daemonSetsUnavailableTop",
            type: "table",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_daemonset_status_number_unavailable"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `topk(20, sum by (${CLUSTER}, ${NS}, daemonset) (kube_daemonset_status_number_unavailable{\${scope:cluster},\${scope:namespace}}) > 0)`,
                    legend: `{${CLUSTER}} {${NS}}/{daemonset}`,
                  },
                ],
              },
            ],
          },
          "kube_daemonset_status_number_unavailable",
        ),
        panel(
          {
            id: "k8s_wh_jobs_failed_top",
            titleKey: "infra.k8s.panel.jobsFailedTop",
            type: "table",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_job_status_failed"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `topk(20, sum by (${CLUSTER}, ${NS}, job_name) (kube_job_status_failed{\${scope:cluster},\${scope:namespace}} > 0))`,
                    legend: `{${CLUSTER}} {${NS}}/{job_name}`,
                  },
                ],
              },
            ],
          },
          "kube_job_status_failed",
        ),
        panel(
          {
            id: "k8s_wh_pvc_unbound_top",
            titleKey: "infra.k8s.panel.volumeClaimsUnboundTop",
            type: "table",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_persistentvolumeclaim_status_phase"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `topk(20, sum by (${CLUSTER}, ${NS}, persistentvolumeclaim, phase) (kube_persistentvolumeclaim_status_phase{\${scope:cluster},\${scope:namespace},phase!="Bound"} == 1))`,
                    legend: `{${CLUSTER}} {${NS}}/{persistentvolumeclaim} {phase}`,
                  },
                ],
              },
            ],
          },
          "kube_persistentvolumeclaim_status_phase",
        ),
      ],
    },

    {
      id: "utilization",
      titleKey: "infra.k8s.section.utilization",
      // The caveats belong to the panel set, not to any one tile: the ratios cannot
      // see a pod that declares no request at all, and the tiles deliberately ignore
      // the namespace picker while the tables honour it.
      noteKey: "infra.k8s.section.utilizationNote",
      scopedBy: ["cluster", "namespace"],
      panels: [
        panel(
          {
            id: "k8s_ut_over_limit",
            titleKey: "infra.k8s.panel.containersOverLimit",
            type: "metric",
            unit: "numbers",
            groupId: "kubelet-pod",
            layout: { w: 32, h: 6 },
            fleetWide: ["namespace"],
            variants: [
              {
                requiresStreams: ["k8s_pod_memory_limit_utilization"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `count(k8s_pod_memory_limit_utilization\${scope:cluster} > 1)`,
                    legend: "",
                  },
                ],
              },
            ],
          },
          "k8s_pod_memory_limit_utilization",
        ),
        panel(
          {
            id: "k8s_ut_near_limit",
            titleKey: "infra.k8s.panel.containersNearLimit",
            type: "metric",
            unit: "numbers",
            groupId: "kubelet-pod",
            layout: { w: 32, h: 6 },
            fleetWide: ["namespace"],
            variants: [
              {
                requiresStreams: ["k8s_pod_memory_limit_utilization"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `count(k8s_pod_memory_limit_utilization\${scope:cluster} > 0.9)`,
                    legend: "",
                  },
                ],
              },
            ],
          },
          "k8s_pod_memory_limit_utilization",
        ),
        panel(
          {
            id: "k8s_ut_cpu_idle_pods",
            titleKey: "infra.k8s.panel.podsIdleCpuRequest",
            type: "metric",
            unit: "numbers",
            groupId: "kubelet-pod",
            layout: { w: 32, h: 6 },
            fleetWide: ["namespace"],
            variants: [
              {
                requiresStreams: ["k8s_pod_cpu_request_utilization"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `count(k8s_pod_cpu_request_utilization\${scope:cluster} < 0.2)`,
                    legend: "",
                  },
                ],
              },
            ],
          },
          "k8s_pod_cpu_request_utilization",
        ),
        panel(
          {
            id: "k8s_ut_mem_idle_pods",
            titleKey: "infra.k8s.panel.podsIdleMemRequest",
            type: "metric",
            unit: "numbers",
            groupId: "kubelet-pod",
            layout: { w: 32, h: 6 },
            fleetWide: ["namespace"],
            variants: [
              {
                requiresStreams: ["k8s_pod_memory_request_utilization"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `count(k8s_pod_memory_request_utilization\${scope:cluster} < 0.2)`,
                    legend: "",
                  },
                ],
              },
            ],
          },
          "k8s_pod_memory_request_utilization",
        ),
        panel(
          {
            id: "k8s_ut_cpu_commit",
            titleKey: "infra.k8s.panel.cpuReserved",
            type: "metric",
            unit: "percent-1",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            fleetWide: ["namespace"],
            variants: [
              {
                requiresStreams: [
                  "kube_pod_container_resource_requests",
                  "kube_node_status_allocatable",
                ],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `sum(kube_pod_container_resource_requests{\${scope:cluster},resource="cpu"}) / sum(kube_node_status_allocatable{\${scope:cluster},resource="cpu"})`,
                    legend: "",
                  },
                ],
              },
            ],
          },
          "kube_pod_container_resource_requests",
        ),
        panel(
          {
            id: "k8s_ut_cpu_free",
            titleKey: "infra.k8s.panel.cpuFree",
            type: "metric",
            unit: "custom",
            unitCustom: " cores",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            fleetWide: ["namespace"],
            variants: [
              {
                requiresStreams: [
                  "kube_node_status_allocatable",
                  "kube_pod_container_resource_requests",
                ],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `sum(kube_node_status_allocatable{\${scope:cluster},resource="cpu"}) - sum(kube_pod_container_resource_requests{\${scope:cluster},resource="cpu"})`,
                    legend: "",
                  },
                ],
              },
            ],
          },
          "kube_node_status_allocatable",
        ),
        panel(
          {
            id: "k8s_ut_commit_trend",
            titleKey: "infra.k8s.panel.cpuReservedTrend",
            type: "line",
            unit: "custom",
            unitCustom: " cores",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            fleetWide: ["namespace"],
            variants: [
              {
                requiresStreams: [
                  "kube_pod_container_resource_requests",
                  "kube_node_status_allocatable",
                ],
                queryType: "promql",
                queries: [
                  {
                    query: `sum(kube_pod_container_resource_requests{\${scope:cluster},resource="cpu"})`,
                    legend: "reserved",
                  },
                  {
                    query: `sum(kube_node_status_allocatable{\${scope:cluster},resource="cpu"})`,
                    legend: "allocatable",
                  },
                ],
              },
            ],
          },
          "kube_pod_container_resource_requests",
        ),
        panel(
          {
            id: "k8s_ut_over_limit_top",
            titleKey: "infra.k8s.panel.containersOverLimitTop",
            type: "table",
            unit: "percent-1",
            groupId: "kubelet-pod",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_pod_memory_limit_utilization"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `topk(20, sum by (${CLUSTER}, ${NS}, ${POD}) (k8s_pod_memory_limit_utilization{\${scope:cluster},\${scope:namespace}} > 1))`,
                    legend: `{${CLUSTER}} {${NS}}/{${POD}}`,
                  },
                ],
              },
            ],
          },
          "k8s_pod_memory_limit_utilization",
        ),
        panel(
          {
            id: "k8s_ut_cpu_waste_top",
            titleKey: "infra.k8s.panel.cpuWasteTop",
            type: "table",
            unit: "percent-1",
            groupId: "kubelet-pod",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_pod_cpu_request_utilization"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `topk(20, clamp_min(1 - sum by (${CLUSTER}, ${NS}, ${POD}) (k8s_pod_cpu_request_utilization{\${scope:cluster},\${scope:namespace}} > 0), 0))`,
                    legend: `{${CLUSTER}} {${NS}}/{${POD}}`,
                  },
                ],
              },
            ],
          },
          "k8s_pod_cpu_request_utilization",
        ),
        panel(
          {
            id: "k8s_ut_mem_waste_top",
            titleKey: "infra.k8s.panel.memWasteTop",
            type: "table",
            unit: "percent-1",
            groupId: "kubelet-pod",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_pod_memory_request_utilization"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `topk(20, clamp_min(1 - sum by (${CLUSTER}, ${NS}, ${POD}) (k8s_pod_memory_request_utilization{\${scope:cluster},\${scope:namespace}} > 0), 0))`,
                    legend: `{${CLUSTER}} {${NS}}/{${POD}}`,
                  },
                ],
              },
            ],
          },
          "k8s_pod_memory_request_utilization",
        ),
        panel(
          {
            id: "k8s_ut_node_commit_top",
            titleKey: "infra.k8s.panel.nodeCommitmentTop",
            type: "table",
            unit: "percent-1",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            fleetWide: ["namespace"],
            variants: [
              {
                requiresStreams: [
                  "kube_pod_container_resource_requests",
                  "kube_node_status_allocatable",
                ],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `topk(20, sum by (${CLUSTER}, ${NODE}) (kube_pod_container_resource_requests{\${scope:cluster},resource="cpu"}) / sum by (${CLUSTER}, ${NODE}) (kube_node_status_allocatable{\${scope:cluster},resource="cpu"}))`,
                    legend: `{${CLUSTER}} {${NODE}}`,
                  },
                ],
              },
            ],
          },
          "kube_pod_container_resource_requests",
        ),
      ],
    },

    {
      id: "nodes",
      titleKey: "infra.k8s.section.nodes",
      scopedBy: ["cluster"],
      panels: [
        panel(
          {
            id: "k8s_nd_cpu",
            titleKey: "infra.k8s.panel.nodeCpu",
            type: "line",
            unit: "percent-1",
            groupId: "kubelet-node",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_node_cpu_utilization"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, avg by (${NODE}) (k8s_node_cpu_utilization\${scope:cluster}))`,
                    legend: `{${NODE}}`,
                  },
                ],
              },
              {
                requiresStreams: ["k8s_node_cpu_usage"],
                queryType: "promql",
                unit: "numbers",
                queries: [
                  {
                    query: `topk(20, avg by (${NODE}) (k8s_node_cpu_usage\${scope:cluster}))`,
                    legend: `{${NODE}}`,
                  },
                ],
              },
            ],
          },
          "k8s_node_cpu_utilization",
        ),

        panel(
          {
            id: "k8s_nd_memory",
            titleKey: "infra.k8s.panel.nodeMemory",
            type: "line",
            unit: "bytes",
            groupId: "kubelet-node",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_node_memory_usage"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, sum by (${NODE}) (k8s_node_memory_usage\${scope:cluster}))`,
                    legend: `{${NODE}}`,
                  },
                ],
              },
              {
                requiresStreams: ["k8s_node_memory_rss"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, sum by (${NODE}) (k8s_node_memory_rss\${scope:cluster}))`,
                    legend: `{${NODE}}`,
                  },
                ],
              },
            ],
          },
          "k8s_node_memory_usage",
        ),

        panel(
          {
            id: "k8s_nd_conditions",
            titleKey: "infra.k8s.panel.nodeConditions",
            type: "table",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_node_status_condition"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `topk(20, sum by (${CLUSTER}, ${NODE}, condition)(kube_node_status_condition{status="true",\${scope:cluster}} == 1))`,
                    legend: `{${CLUSTER}} {${NODE}} {condition}`,
                  },
                ],
              },
            ],
          },
          "kube_node_status_condition",
        ),

        panel(
          {
            id: "k8s_nd_network",
            titleKey: "infra.k8s.panel.nodeNetwork",
            type: "line",
            unit: "bps",
            groupId: "kubelet-node",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_node_network_io"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, sum by (${NODE}, direction)(irate(k8s_node_network_io\${scope:cluster}[5m])))`,
                    legend: `{${NODE}} {direction}`,
                  },
                ],
              },
            ],
          },
          "k8s_node_network_io",
        ),

        // The metric emits a row per condition/status pair, so without status="true"
        // the `== 0` matches the false and unknown rows — 0 BECAUSE they are false.
        panel(
          {
            id: "k8s_nd_not_ready",
            titleKey: "infra.k8s.panel.nodesNotReady",
            type: "table",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_node_status_condition"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `topk(20, sum by (${CLUSTER}, ${NODE})(kube_node_status_condition{condition="Ready",status="true",\${scope:cluster}} == 0))`,
                    legend: `{${CLUSTER}} {${NODE}}`,
                  },
                ],
              },
            ],
          },
          "kube_node_status_condition",
        ),
      ],
    },

    {
      id: "workloads",
      titleKey: "infra.k8s.section.workloads",
      scopedBy: ["cluster", "namespace", "pod"],
      panels: [
        panel(
          {
            id: "k8s_wl_pod_cpu_top",
            titleKey: "infra.k8s.panel.podCpuTop",
            type: "line",
            unit: "numbers",
            groupId: "kubelet-pod",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_pod_cpu_usage"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(10, sum by (${NS}, ${POD}) (k8s_pod_cpu_usage{\${scope:cluster},\${scope:namespace},\${scope:pod}}))`,
                    legend: `{${NS}}/{${POD}}`,
                  },
                ],
              },
              {
                requiresStreams: ["k8s_pod_cpu_utilization"],
                queryType: "promql",
                unit: "percent-1",
                queries: [
                  {
                    query: `topk(10, avg by (${NS}, ${POD}) (k8s_pod_cpu_utilization{\${scope:cluster},\${scope:namespace},\${scope:pod}}))`,
                    legend: `{${NS}}/{${POD}}`,
                  },
                ],
              },
            ],
          },
          "k8s_pod_cpu_usage",
        ),

        panel(
          {
            id: "k8s_wl_pod_mem_top",
            titleKey: "infra.k8s.panel.podMemTop",
            type: "line",
            unit: "bytes",
            groupId: "kubelet-pod",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_pod_memory_usage"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(10, sum by (${NS}, ${POD}) (k8s_pod_memory_usage{\${scope:cluster},\${scope:namespace},\${scope:pod}}))`,
                    legend: `{${NS}}/{${POD}}`,
                  },
                ],
              },
            ],
          },
          "k8s_pod_memory_usage",
        ),

        panel(
          {
            id: "k8s_wl_nonrunning_by_ns",
            // Scoped by namespace only — a per-namespace rollup: a pod filter would shrink the namespace total the title promises.
            fleetWide: ["pod"],
            titleKey: "infra.k8s.panel.nonRunningByNs",
            type: "line",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_pod_status_phase"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, sum by (${NS}) (kube_pod_status_phase{\${scope:cluster},phase=~"Pending|Failed|Unknown",\${scope:namespace}}))`,
                    legend: `{${NS}}`,
                  },
                ],
              },
            ],
          },
          "kube_pod_status_phase",
        ),

        panel(
          {
            id: "k8s_wl_cpu_requests",
            // Scoped by namespace only — a per-namespace rollup: requests are a namespace-level budget, not a per-pod reading.
            fleetWide: ["pod"],
            titleKey: "infra.k8s.panel.cpuRequestsByNs",
            type: "line",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_pod_container_resource_requests"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, sum by (${NS}) (kube_pod_container_resource_requests{\${scope:cluster},resource="cpu",\${scope:namespace}}))`,
                    legend: `{${NS}}`,
                  },
                ],
              },
            ],
          },
          "kube_pod_container_resource_requests",
        ),

        panel(
          {
            id: "k8s_wl_pod_network",
            // Scoped by namespace only — a per-namespace rollup: a pod filter would shrink the namespace total the title promises.
            fleetWide: ["pod"],
            titleKey: "infra.k8s.panel.podNetwork",
            type: "line",
            unit: "bps",
            groupId: "kubelet-pod",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_pod_network_io"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, sum by (${NS}) (irate(k8s_pod_network_io{\${scope:cluster},\${scope:namespace}}[5m])))`,
                    legend: `{${NS}}`,
                  },
                ],
              },
            ],
          },
          "k8s_pod_network_io",
        ),

        panel(
          {
            id: "k8s_wl_pod_fs",
            titleKey: "infra.k8s.panel.podFilesystem",
            type: "line",
            unit: "percent",
            groupId: "kubelet-pod",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_pod_filesystem_usage", "k8s_pod_filesystem_capacity"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(10, 100 * sum by (${NS}, ${POD}) (k8s_pod_filesystem_usage{\${scope:cluster},\${scope:namespace},\${scope:pod}}) / sum by (${NS}, ${POD}) (k8s_pod_filesystem_capacity{\${scope:cluster},\${scope:namespace},\${scope:pod}}))`,
                    legend: `{${NS}}/{${POD}}`,
                  },
                ],
              },
            ],
          },
          "k8s_pod_filesystem_usage",
        ),

        panel(
          {
            id: "k8s_wl_pod_mem_limit_pct",
            titleKey: "infra.k8s.panel.podMemLimitPct",
            type: "line",
            unit: "percent-1",
            groupId: "kubelet-pod",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_pod_memory_limit_utilization"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(10, avg by (${NS}, ${POD}) (k8s_pod_memory_limit_utilization{\${scope:cluster},\${scope:namespace},\${scope:pod}}))`,
                    legend: `{${NS}}/{${POD}}`,
                  },
                ],
              },
            ],
          },
          "k8s_pod_memory_limit_utilization",
        ),

        panel(
          {
            id: "k8s_wl_pod_restarts",
            titleKey: "infra.k8s.panel.podRestarts",
            type: "table",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_pod_container_status_restarts_total"],
                queryType: "promql",
                queryMode: "instant",
                queries: [
                  {
                    query: `topk(20, sum by (${NS}, ${POD}) (increase(kube_pod_container_status_restarts_total{\${scope:cluster},\${scope:namespace},\${scope:pod}}[1h])))`,
                    legend: `{${NS}}/{${POD}}`,
                  },
                ],
              },
            ],
          },
          "kube_pod_container_status_restarts_total",
        ),
      ],
    },
  ],
};
