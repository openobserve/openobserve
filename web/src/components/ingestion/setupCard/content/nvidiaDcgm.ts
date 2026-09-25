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

// NVIDIA GPU card: DCGM Exporter exposes GPU telemetry on :9400 and an
// OpenTelemetry Collector ships it to OpenObserve. Settings follow the guide NVIDIA's
// README links to (https://openobserve.ai/blog/how-to-monitor-nvidia-gpu/): 30s
// scrape, keep only DCGM_* series, batch 10s/1024.
//
// Docker and Kubernetes share one "platform" toggle across the steps. On Kubernetes
// no extra collector is needed — the OpenObserve collector (Recommended → Kubernetes)
// already scrapes every pod annotated prometheus.io/scrape, so the Helm values just
// add those annotations.

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent, RichCardStepVariant } from "../types";
import { applySubs, applySubsMasked } from "../subs";
import { COLLECTOR_VERSION } from "./otelShared";

/** DCGM Exporter release the Docker command and Helm chart pin. Bump together. */
export const DCGM_EXPORTER_IMAGE = "nvcr.io/nvidia/k8s/dcgm-exporter:4.6.1-4.8.4-distroless";
export const DCGM_CHART_VERSION = "4.8.4";
export const DCGM_PORT = 9400;

const codeFor = (template: string, subs: CardSubstitutions, lang = "bash") => ({
  lang,
  raw: applySubs(template, subs),
  masked: applySubsMasked(template, subs),
});

// ── step 1: prerequisites ───────────────────────────────────────────────────

const DOCKER_PREREQ = `# Driver loaded and every GPU visible (R535+, R550+ for H200)
nvidia-smi

# Containers can reach the GPUs (NVIDIA Container Toolkit)
docker run --rm --gpus all ubuntu nvidia-smi -L`;

const K8S_PREREQ = `# GPU nodes advertise nvidia.com/gpu (NVIDIA device plugin or GPU Operator)
kubectl get nodes -o custom-columns='NODE:.metadata.name,GPUS:.status.allocatable.nvidia\\.com/gpu'

# The OpenObserve collector runs chart 0.4.3+ (the first with pod autodiscovery)
helm list -n openobserve-collector`;

// ── step 2: DCGM Exporter ───────────────────────────────────────────────────

// Host networking gives the container the node's hostname, so the Hostname label
// identifies the machine rather than a container id; the listener stays on loopback.
const DOCKER_EXPORTER = `docker run -d --name dcgm-exporter \\
  --restart unless-stopped \\
  --gpus all \\
  --cap-add SYS_ADMIN \\
  --network host \\
  -e DCGM_EXPORTER_LISTEN=127.0.0.1:${DCGM_PORT} \\
  ${DCGM_EXPORTER_IMAGE}

# DCGM takes a few seconds to start, then GPU series appear
sleep 10 && curl -s localhost:${DCGM_PORT}/metrics | grep DCGM_FI_DEV_GPU_UTIL`;

// A values file rather than --set: the annotation keys contain dots and slashes.
const K8S_EXPORTER = `cat > dcgm-values.yaml <<'EOF'
# The OpenObserve collector scrapes pods carrying these annotations
podAnnotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "${DCGM_PORT}"
# Not needed here, and fails to install without the Prometheus Operator CRDs
serviceMonitor:
  enabled: false
# GPU nodes only — on a CPU node the exporter crash-loops. Any one label matches;
# add your cluster's GPU node label if it uses another.
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions: [{ key: nvidia.com/gpu.present, operator: Exists }]
        - matchExpressions: [{ key: k8s.amazonaws.com/accelerator, operator: Exists }]
        - matchExpressions: [{ key: kubernetes.azure.com/accelerator, operator: Exists }]
# GPU pools carry provider-specific taints; this list replaces the chart's, so tolerate all
tolerations:
  - operator: Exists
# The chart default (system-node-critical) is refused outside kube-system on some clusters
priorityClassName: ""
EOF

helm repo add gpu-helm-charts https://nvidia.github.io/dcgm-exporter/helm-charts
helm repo update
helm upgrade --install dcgm-exporter gpu-helm-charts/dcgm-exporter \\
  --version ${DCGM_CHART_VERSION} \\
  --namespace gpu-monitoring --create-namespace \\
  -f dcgm-values.yaml

kubectl rollout status daemonset/dcgm-exporter -n gpu-monitoring --timeout=5m

# DESIRED should equal your GPU node count — 0 means no node carries the labels above
kubectl get daemonset dcgm-exporter -n gpu-monitoring`;

// ── step 3: ship to OpenObserve ─────────────────────────────────────────────

export const COLLECTOR_CONFIG = `receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: 'dcgm-gpu-metrics'
          scrape_interval: 30s
          static_configs:
            - targets: ['localhost:${DCGM_PORT}']
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: 'DCGM_.*'
              action: keep

processors:
  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlphttp/openobserve:
    endpoint: {url}/api/{org}
    headers:
      Authorization: Basic {token}

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [batch]
      exporters: [otlphttp/openobserve]`;

const DOCKER_COLLECTOR = `cat > otel-collector-config.yaml <<'EOF'
${COLLECTOR_CONFIG}
EOF

docker run -d --name otel-collector \\
  --restart unless-stopped \\
  --network host \\
  -v "$(pwd)/otel-collector-config.yaml:/etc/otel-collector-config.yaml" \\
  otel/opentelemetry-collector-contrib:${COLLECTOR_VERSION} \\
  --config=/etc/otel-collector-config.yaml`;

const K8S_COLLECTOR = `# Exporter pods carry the scrape annotations
kubectl get pods -n gpu-monitoring -l app.kubernetes.io/name=dcgm-exporter \\
  -o custom-columns='POD:.metadata.name,NODE:.spec.nodeName,SCRAPE:.metadata.annotations.prometheus\\.io/scrape'

# The exporter answers on :${DCGM_PORT}
kubectl port-forward -n gpu-monitoring service/dcgm-exporter ${DCGM_PORT}:${DCGM_PORT} &
sleep 2 && curl -s localhost:${DCGM_PORT}/metrics | grep DCGM_FI_DEV_GPU_UTIL
kill %1`;

// ── step 5: recommended alerts ──────────────────────────────────────────────

// Metric streams are lower-cased on ingest (DCGM_FI_DEV_GPU_TEMP → dcgm_fi_dev_gpu_temp).
// Each query goes in as-is; the alert's own threshold carries the comparison, because
// the alert form applies its threshold on top of the PromQL result.
export const ALERT_RULES = `# GPU overheating (°C) — warning when > 85, critical when > 90
max by (hostname, gpu) (dcgm_fi_dev_gpu_temp)

# GPU memory nearly full (%) — warning when > 90, critical when > 95
max by (hostname, gpu) (dcgm_fi_dev_fb_used / (dcgm_fi_dev_fb_used + dcgm_fi_dev_fb_free) * 100)

# New XID error (driver/hardware fault; check dmesg for the code) — alert when > 0
# The metric holds the last XID code, so changes() fires on a new fault and then clears.
max by (hostname, gpu) (changes(dcgm_fi_dev_xid_errors[5m]))

# Idle, paid-for GPU (%) — alert when < 20
avg by (hostname, gpu) (avg_over_time(dcgm_fi_dev_gpu_util[30m]))

# No thermal-throttling rule: DCGM_FI_DEV_THERMAL_VIOLATION isn't collected by default.`;

const UNINSTALL = `# Docker
docker rm -f otel-collector dcgm-exporter

# Kubernetes
helm uninstall dcgm-exporter -n gpu-monitoring
kubectl delete namespace gpu-monitoring`;

// ── card ────────────────────────────────────────────────────────────────────

export default function nvidiaDcgmCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  const icons = {
    docker: getImageURL("images/common/docker.svg"),
    kubernetes: getImageURL("images/common/kubernetes.svg"),
  };
  // Ids must match across every step in the "platform" group.
  const platform = (
    docker: RichCardStepVariant["code"],
    kubernetes: RichCardStepVariant["code"],
    notes: { docker?: I18nText; kubernetes?: I18nText } = {},
  ): RichCardStepVariant[] => [
    {
      id: "docker",
      labelKey: "ingestion.setupCard.gpuPlatformDocker",
      icon: icons.docker,
      code: docker,
      note: notes.docker,
    },
    {
      id: "kubernetes",
      label: raw("Kubernetes"),
      icon: icons.kubernetes,
      code: kubernetes,
      note: notes.kubernetes,
    },
  ];

  return {
    provider: {
      name: raw("NVIDIA GPU"),
      tagline: t("ingestion.setupCard.gpuTagline"),
      logo: getImageURL("images/ingestion/nvidia.svg"),
      tone: "#76B900",
      runtime: t("ingestion.setupCard.gpuRuntime"),
      setupTime: t("ingestion.setupCard.setupTime5Min"),
      metaBadges: [t("common.metrics"), t("ingestion.setupCard.gpuDashboardBadge")],
    },
    steps: [
      {
        id: "prereqs",
        titleKey: "ingestion.setupCard.gpuPrereqTitle",
        descriptionKey: "ingestion.setupCard.gpuPrereqDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        completeOn: "copy",
        variantGroup: "platform",
        variants: platform(
          { lang: "bash", raw: DOCKER_PREREQ },
          { lang: "bash", raw: K8S_PREREQ },
          {
            docker: t("ingestion.setupCard.gpuPrereqDockerNote"),
            kubernetes: t("ingestion.setupCard.gpuPrereqK8sNote"),
          },
        ),
      },
      {
        id: "exporter",
        titleKey: "ingestion.setupCard.gpuExporterTitle",
        descriptionKey: "ingestion.setupCard.gpuExporterDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        required: true,
        completeOn: "copy",
        variantGroup: "platform",
        variants: platform(
          { lang: "bash", raw: DOCKER_EXPORTER },
          { lang: "bash", raw: K8S_EXPORTER },
          {
            docker: t("ingestion.setupCard.gpuExporterDockerNote"),
            kubernetes: t("ingestion.setupCard.gpuExporterK8sNote"),
          },
        ),
      },
      {
        id: "ship",
        titleKey: "ingestion.setupCard.gpuShipTitle",
        descriptionKey: "ingestion.setupCard.gpuShipDesc",
        chip: { kind: "run", labelKey: "ingestion.setupCard.chipRun" },
        required: true,
        completeOn: "copy",
        variantGroup: "platform",
        variants: platform(
          codeFor(DOCKER_COLLECTOR, subs),
          { lang: "bash", raw: K8S_COLLECTOR },
          {
            docker: t("ingestion.setupCard.gpuShipDockerNote"),
            kubernetes: t("ingestion.setupCard.gpuShipK8sNote"),
          },
        ),
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.gpuVerifyDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipMetrics" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: [
          t("ingestion.setupCard.pillGpuUtilization"),
          t("ingestion.setupCard.pillGpuMemory"),
          t("ingestion.setupCard.pillGpuTemperature"),
          t("ingestion.setupCard.pillGpuPower"),
          t("ingestion.setupCard.pillGpuClocks"),
          t("ingestion.setupCard.pillXidErrors"),
        ],
        action: {
          id: "open-setup-dashboard",
          label: t("ingestion.setupCard.gpuOpenDashboard"),
          icon: "dashboard",
          showOnDetect: true,
        },
      },
      {
        id: "alerts",
        titleKey: "ingestion.setupCard.gpuAlertsTitle",
        descriptionKey: "ingestion.setupCard.gpuAlertsDesc",
        chip: { kind: "editor", labelKey: "ingestion.setupCard.optionalLabel" },
        completeOn: "copy",
        code: { lang: "promql", raw: ALERT_RULES, filename: "gpu-alerts.promql" },
        note: t("ingestion.setupCard.gpuAlertsNote"),
      },
    ],
    // OTLP metrics fan out one stream per metric, lower-cased (dcgm_fi_dev_gpu_util, …).
    detect: { streamType: "metrics", match: "keyword", streamName: "dcgm_fi_", filter: "" },
    extras: {
      fixTitle: t("ingestion.setupCard.gpuFixTitle"),
      fixBody: t("ingestion.setupCard.gpuFixBody"),
      fixLang: "bash",
      fixSnippet: `# Docker: the exporter sees the GPUs, then the collector's export errors
curl -s localhost:${DCGM_PORT}/metrics | grep -c '^DCGM_'
docker logs --tail 50 otel-collector

# Kubernetes: the exporter pods are up and serving
kubectl logs -n gpu-monitoring daemonset/dcgm-exporter --tail 50`,
      troubleshooting: [
        {
          q: t("ingestion.setupCard.gpuTroubleNoMetricsQ"),
          a: t("ingestion.setupCard.gpuTroubleNoMetricsA"),
        },
        {
          q: t("ingestion.setupCard.gpuTroubleExporterQ"),
          a: t("ingestion.setupCard.gpuTroubleExporterA"),
        },
        {
          q: t("ingestion.setupCard.gpuTroubleProfilingQ"),
          a: t("ingestion.setupCard.gpuTroubleProfilingA"),
        },
        {
          q: t("ingestion.setupCard.gpuTroubleOperatorQ"),
          a: t("ingestion.setupCard.gpuTroubleOperatorA"),
        },
        {
          q: t("ingestion.setupCard.gpuTroubleK8sPendingQ"),
          a: t("ingestion.setupCard.gpuTroubleK8sPendingA"),
        },
        {
          q: t("ingestion.setupCard.gpuTroubleGkeQ"),
          a: t("ingestion.setupCard.gpuTroubleGkeA"),
        },
        {
          q: t("ingestion.setupCard.gpuTroubleAuthQ"),
          a: t("ingestion.setupCard.gpuTroubleAuthA"),
        },
      ],
      uninstall: {
        labelKey: "ingestion.setupCard.gpuUninstallLabel",
        code: { lang: "bash", raw: UNINSTALL },
      },
    },
    docUrl: "https://openobserve.ai/blog/how-to-monitor-nvidia-gpu/",
    docLinks: [
      {
        label: t("ingestion.setupCard.gpuDashboardLink"),
        url: "https://github.com/openobserve/dashboards/tree/main/NVIDIA%20GPU%20Monitoring",
      },
      { label: raw("DCGM Exporter"), url: "https://github.com/NVIDIA/dcgm-exporter" },
      {
        label: t("ingestion.setupCard.gpuMetricsReferenceLink"),
        url: "https://docs.nvidia.com/datacenter/dcgm/latest/reference/dcgm-exporter-metrics.html",
      },
    ],
  };
}
