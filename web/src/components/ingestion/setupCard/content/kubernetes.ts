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

// Kubernetes data-source setup card. The collector ships logs, k8s events and
// cluster/pod metrics, and (via the OpenTelemetry operator) can auto-instrument
// workloads for traces with no code change — so the card has three steps:
// install → optionally annotate for traces → verify.
//
// Step 1 deliberately offers ONLY the two endpoint choices — external (reach
// OpenObserve over the network) and internal (OpenObserve runs in this same
// cluster, so traffic never leaves it) — because the one-line installer is the
// recommended path and should read as the default. The two use different flags
// (`--o2-url` vs `--internal-endpoint`), so they are distinct commands rather
// than one editable URL field. Internal is self-hosted only: on cloud there is
// no in-cluster router to talk to, so the toggle disappears entirely.
//
// The raw Helm sequence stays a secondary, collapsed path (extras.advanced),
// mirroring the "Advanced Installation" accordion it replaces.

import { raw, type TranslateFn } from "@/types/i18n";

import config from "@/aws-exports";
import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent, RichCardStepVariant } from "../types";
import { applySubs, applySubsMasked } from "../subs";

/** Pinned cert-manager release the manual sequence installs. Bump in one place. */
const CERT_MANAGER_VERSION = "1.19.0";

/**
 * In-cluster address of the OpenObserve router, used when OpenObserve runs in
 * the same cluster as the collector. Shape is
 * `http://<helm-release>-openobserve-router.<namespace>.svc.cluster.local:5080`
 * — the default below assumes release `o2` in namespace `openobserve`.
 */
const IN_CLUSTER_URL = "http://o2-openobserve-router.openobserve.svc.cluster.local:5080";

const INSTALL_SCRIPT =
  "https://raw.githubusercontent.com/openobserve/o2-datasource/main/k8s/install.sh";

// ── install commands ─────────────────────────────────────────────────────────

// {cluster} is a live step input; {org}/{token} are substituted at build time.
// `--o2-url` takes a reachable URL, `--internal-endpoint` the in-cluster one —
// they are separate flags, not two values for the same flag.
const scriptInstall = (endpointFlag: string) =>
  `curl -sSL ${INSTALL_SCRIPT} | bash -s -- \\
  --cluster-name={cluster} \\
  --org-id={org} \\
  --access-key={token} \\
  ${endpointFlag}`;

// The Helm path as ONE copy-paste block. Previously six separate copy boxes with
// a "wait 2 minutes" instruction between them; the explicit `kubectl wait` on
// the webhook makes that deterministic instead of a guess.
const helmInstall = (exporterUrl: string) =>
  `# 1 — cert-manager (the OpenTelemetry operator's webhook depends on it)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v${CERT_MANAGER_VERSION}/cert-manager.yaml
kubectl wait --for=condition=Available --timeout=300s \\
  -n cert-manager deployment/cert-manager-webhook

# 2 — Prometheus operator CRDs (required by the OpenTelemetry operator)
kubectl create -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/main/example/prometheus-operator-crd/monitoring.coreos.com_servicemonitors.yaml
kubectl create -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/main/example/prometheus-operator-crd/monitoring.coreos.com_podmonitors.yaml
kubectl create -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/refs/heads/main/example/prometheus-operator-crd/monitoring.coreos.com_scrapeconfigs.yaml
kubectl create -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/refs/heads/main/example/prometheus-operator-crd/monitoring.coreos.com_probes.yaml

# 3 — OpenTelemetry operator
kubectl apply -f https://raw.githubusercontent.com/openobserve/openobserve-helm-chart/refs/heads/main/opentelemetry-operator.yaml

# 4 — OpenObserve collector
helm repo add openobserve https://charts.openobserve.ai
helm repo update
kubectl create ns openobserve-collector
helm --namespace openobserve-collector \\
  upgrade --install o2c openobserve/openobserve-collector \\
  --set k8sCluster={cluster} \\
  --set exporters.'otlphttp/openobserve'.endpoint=${exporterUrl}/api/{org} \\
  --set exporters.'otlphttp/openobserve'.headers.Authorization='Basic {token}' \\
  --set exporters.'otlphttp/openobserve_k8s_events'.endpoint=${exporterUrl}/api/{org} \\
  --set exporters.'otlphttp/openobserve_k8s_events'.headers.Authorization='Basic {token}'`;

/** Build a variant whose code carries the org token (masked until revealed). */
const codeFor = (template: string, subs: CardSubstitutions, lang = "bash") => ({
  lang,
  raw: applySubs(template, subs),
  masked: applySubsMasked(template, subs),
});

// ── auto-instrumentation (optional step) ─────────────────────────────────────

/**
 * Annotating a namespace makes the operator inject the language's auto-
 * instrumentation into every pod in it — no application code or image change.
 * Go is the exception: its eBPF instrumentation also needs the path to the
 * compiled binary inside the container.
 */
const annotate = (key: string, extra = "") =>
  `# Every pod in the namespace is instrumented — no code or image change.
kubectl annotate namespace my-namespace \\
  instrumentation.opentelemetry.io/inject-${key}="openobserve-collector/openobserve-${key}"${extra}

# Restart so running pods pick up the injection
kubectl rollout restart deployment -n my-namespace`;

const LANGUAGES: { id: string; label: string; icon: string; extra?: string }[] = [
  { id: "java", label: "Java", icon: "images/ingestion/java.svg" },
  { id: "dotnet", label: ".NET", icon: "images/ingestion/dotnet.svg" },
  { id: "nodejs", label: "Node.js", icon: "images/ingestion/nodejs.svg" },
  { id: "python", label: "Python", icon: "images/ingestion/python.svg" },
  {
    id: "go",
    label: "Go (eBPF)",
    icon: "images/ingestion/golang.svg",
    // eBPF attaches to the binary, so the operator needs its in-container path.
    extra: ` \\
  instrumentation.opentelemetry.io/otel-go-auto-target-exe="/path/to/container/executable"`,
  },
];

const instrumentVariants = (t: TranslateFn): RichCardStepVariant[] =>
  LANGUAGES.map((l) => ({
    id: l.id,
    label: raw(l.label),
    icon: getImageURL(l.icon),
    code: { lang: "bash", raw: annotate(l.id, l.extra) },
    note:
      l.id === "go"
        ? t("ingestion.setupCard.k8sGoEbpfNote")
        : t("ingestion.setupCard.k8sAnnotatePodNote"),
  }));

// ── card ─────────────────────────────────────────────────────────────────────

export default function kubernetesCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  const isCloud = config.isCloud === "true";

  const INSTALLER_NOTE = t("ingestion.setupCard.k8sInstallerNote");

  // The manual Helm path sits in a collapsed section below the steps, which is
  // past the auto-instrument and verify steps — point at it from here, where the
  // user is actually choosing how to install. `(#advanced)` renders as a jump
  // link that opens that accordion and scrolls to it (see noteMd in
  // SetupCardRenderer), so the user never has to go looking for it.
  const ADVANCED_HINT = t("ingestion.setupCard.k8sAdvancedHint");

  const externalCode = codeFor(scriptInstall("--o2-url={url}"), subs);

  // Cloud has no in-cluster router, so there is nothing to choose between —
  // the step renders a single command with no toggle at all.
  const installVariants: RichCardStepVariant[] | undefined = isCloud
    ? undefined
    : [
        {
          id: "external",
          labelKey: "ingestion.setupCard.externalEndpointVariant",
          code: externalCode,
          note: raw(`${INSTALLER_NOTE} ${ADVANCED_HINT}`),
        },
        {
          id: "internal",
          labelKey: "ingestion.setupCard.internalEndpointVariant",
          code: codeFor(scriptInstall(`--internal-endpoint=${IN_CLUSTER_URL}`), subs),
          note: raw(
            `${t("ingestion.setupCard.k8sInternalEndpointNote")} ${INSTALLER_NOTE} ${ADVANCED_HINT}`,
          ),
        },
      ];

  return {
    provider: {
      name: raw("Kubernetes"),
      tagline: t("ingestion.setupCard.taglineKubernetes"),
      logo: getImageURL("images/common/kubernetes.svg"),
      tone: "#326ce5",
      runtime: t("ingestion.setupCard.runtimeCluster"),
      setupTime: t("ingestion.setupCard.setupTime3Min"),
      metaBadges: [t("common.logs"), t("common.metrics"), t("common.events"), t("common.traces")],
    },
    steps: [
      {
        id: "install",
        // "(Recommended)" is carried in the title, as it was on the page this
        // replaces — it is the path the overwhelming majority should take, and
        // the manual Helm sequence below must not read as an equal alternative.
        titleKey: "ingestion.setupCard.quickInstallTitle",
        descriptionKey: "ingestion.setupCard.quickInstallDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        required: true,
        completeOn: "copy",
        inputs: [
          {
            id: "cluster",
            labelKey: "ingestion.setupCard.clusterNameLabel",
            default: "cluster1",
            placeholder: raw("production"),
            helpKey: "ingestion.setupCard.clusterNameHelp",
          },
        ],
        // Cloud: one command, no toggle. Self-hosted: external / internal.
        // The note rides on each variant when there are variants, so it only
        // lives on the step itself in the cloud (no-variant) case.
        code: isCloud ? externalCode : undefined,
        note: isCloud ? raw(`${INSTALLER_NOTE} ${ADVANCED_HINT}`) : undefined,
        variants: installVariants,
      },
      {
        id: "instrument",
        titleKey: "ingestion.setupCard.autoInstrumentTracesTitle",
        descriptionKey: "ingestion.setupCard.autoInstrumentTracesDesc",
        chip: { kind: "editor", labelKey: "ingestion.setupCard.optionalLabel" },
        completeOn: "copy",
        variants: instrumentVariants(t),
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.verifyK8sDataDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipLogs" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: [
          t("ingestion.setupCard.pillContainerLogs"),
          t("ingestion.setupCard.pillKubernetesEvents"),
          t("ingestion.setupCard.pillNodeMetrics"),
          t("ingestion.setupCard.pillPodMetrics"),
          t("common.traces"),
        ],
      },
    ],
    // Collector logs carry the k8sattributes processor's resource attributes;
    // `k8s_namespace_name` is the flattened `k8s.namespace.name`, which is what
    // distinguishes cluster logs from anything else already on `default`.
    detect: {
      streamType: "logs",
      streamName: "default",
      filter: "k8s_namespace_name IS NOT NULL",
    },
    extras: {
      // The manual Helm path, kept secondary. Previously six separate copy
      // boxes with a "wait 2 minutes" instruction between them; the explicit
      // `kubectl wait` on the webhook makes that deterministic.
      advanced: {
        labelKey: "ingestion.setupCard.advancedInstallLabel",
        // Not `descriptionKey`: the self-hosted copy interpolates the in-cluster
        // URL, which key-only resolution (no params) can't express.
        description: isCloud
          ? t("ingestion.setupCard.advancedInstallDescCloud")
          : t("ingestion.setupCard.advancedInstallDescSelfHosted", { url: IN_CLUSTER_URL }),
        code: codeFor(helmInstall("{url}"), subs),
      },
      fixTitle: t("ingestion.setupCard.k8sFixTitle"),
      fixBody: t("ingestion.setupCard.k8sFixBody"),
      fixLang: "bash",
      fixSnippet: `kubectl wait --for=condition=Available --timeout=300s \\
  -n cert-manager deployment/cert-manager-webhook
kubectl get pods -n openobserve-collector`,
      troubleshooting: [
        {
          q: t("ingestion.setupCard.k8sTroubleWebhookQ"),
          a: t("ingestion.setupCard.k8sTroubleWebhookA"),
        },
        {
          q: t("ingestion.setupCard.k8sTroubleNoDataQ"),
          a: t("ingestion.setupCard.k8sTroubleNoDataA"),
        },
        {
          q: t("ingestion.setupCard.k8sTroubleEndpointQ"),
          a: t("ingestion.setupCard.k8sTroubleEndpointA"),
        },
        {
          q: t("ingestion.setupCard.k8sTroubleAnnotationQ"),
          a: t("ingestion.setupCard.k8sTroubleAnnotationA"),
        },
        {
          q: t("ingestion.setupCard.k8sTroubleExampleQ"),
          // inlineMd renders **bold** and `code` only, so both references are
          // real links in the footer (docLinks) rather than text here.
          a: t("ingestion.setupCard.k8sTroubleExampleA"),
        },
      ],
    },
    docUrl: "https://github.com/openobserve/openobserve-helm-chart",
    // Both links the page carried before the migration, restored as anchors.
    docLinks: [
      {
        label: t("ingestion.setupCard.hotCommerceExampleLink"),
        url: "https://github.com/openobserve/hotcommerce",
      },
      {
        label: raw("OpenTelemetry Operator"),
        url: "https://github.com/open-telemetry/opentelemetry-operator",
      },
    ],
  };
}
