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

import config from "@/aws-exports";
import { getImageURL } from "@/utils/zincutils";
import type {
  CardSubstitutions,
  RichCardContent,
  RichCardStepVariant,
} from "../types";
import { applySubs, applySubsMasked } from "../subs";

/** Pinned cert-manager release the manual sequence installs. Bump in one place. */
const CERT_MANAGER_VERSION = "1.19.0";

/**
 * In-cluster address of the OpenObserve router, used when OpenObserve runs in
 * the same cluster as the collector. Shape is
 * `http://<helm-release>-openobserve-router.<namespace>.svc.cluster.local:5080`
 * — the default below assumes release `o2` in namespace `openobserve`.
 */
const IN_CLUSTER_URL =
  "http://o2-openobserve-router.openobserve.svc.cluster.local:5080";

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
const codeFor = (
  template: string,
  subs: CardSubstitutions,
  lang = "bash",
) => ({
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

const LANGUAGES: { id: string; label: string; icon: string; extra?: string }[] =
  [
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

const instrumentVariants = (): RichCardStepVariant[] =>
  LANGUAGES.map((l) => ({
    id: l.id,
    label: l.label,
    icon: getImageURL(l.icon),
    code: { lang: "bash", raw: annotate(l.id, l.extra) },
    note:
      l.id === "go"
        ? "Point otel-go-auto-target-exe at the compiled binary inside the container — eBPF attaches to that executable, not to the pod."
        : "Annotate a single pod spec instead of the namespace to instrument one workload at a time.",
  }));

// ── card ─────────────────────────────────────────────────────────────────────

export default function kubernetesCard(
  subs: CardSubstitutions,
): RichCardContent {
  const isCloud = config.isCloud === "true";

  const INSTALLER_NOTE =
    "This installs cert-manager, the OpenTelemetry operator and the OpenObserve collector automatically.";

  // The manual Helm path sits in a collapsed section below the steps, which is
  // past the auto-instrument and verify steps — point at it from here, where the
  // user is actually choosing how to install. `(#advanced)` renders as a jump
  // link that opens that accordion and scrolls to it (see noteMd in
  // SetupCardRenderer), so the user never has to go looking for it.
  const ADVANCED_HINT =
    "Prefer Helm, or need to pin versions and customise chart values? Go to [Advanced Installation (Manual Steps)](#advanced).";

  const externalCode = codeFor(scriptInstall("--o2-url={url}"), subs);

  // Cloud has no in-cluster router, so there is nothing to choose between —
  // the step renders a single command with no toggle at all.
  const installVariants: RichCardStepVariant[] | undefined = isCloud
    ? undefined
    : [
        {
          id: "external",
          label: "External Endpoint",
          code: externalCode,
          note: `${INSTALLER_NOTE} ${ADVANCED_HINT}`,
        },
        {
          id: "internal",
          label: "Internal Endpoint",
          code: codeFor(
            scriptInstall(`--internal-endpoint=${IN_CLUSTER_URL}`),
            subs,
          ),
          note: `Use this when OpenObserve runs in this same cluster — traffic never leaves it. ${INSTALLER_NOTE} ${ADVANCED_HINT}`,
        },
      ];

  return {
    provider: {
      name: "Kubernetes",
      tagline:
        "Deploy the OpenObserve collector to your cluster — container logs, Kubernetes events and cluster metrics, plus zero-code traces for your workloads.",
      logo: getImageURL("images/common/kubernetes.svg"),
      tone: "#326ce5",
      runtime: "Cluster",
      setupTime: "~3 min",
      metaBadges: ["Logs", "Metrics", "Events", "Traces"],
    },
    steps: [
      {
        id: "install",
        // "(Recommended)" is carried in the title, as it was on the page this
        // replaces — it is the path the overwhelming majority should take, and
        // the manual Helm sequence below must not read as an equal alternative.
        title: "Quick Install (Recommended)",
        description:
          "Install the OpenObserve collector with a **single command** — just set your cluster name and run. The name tags every record, so you can tell clusters apart once several are reporting.",
        chip: { kind: "terminal", label: "Terminal" },
        required: true,
        completeOn: "copy",
        inputs: [
          {
            id: "cluster",
            label: "Cluster Name",
            default: "cluster1",
            placeholder: "production",
            help: "Identifies this cluster in your logs, metrics and dashboards.",
          },
        ],
        // Cloud: one command, no toggle. Self-hosted: external / internal.
        // The note rides on each variant when there are variants, so it only
        // lives on the step itself in the cloud (no-variant) case.
        code: isCloud ? externalCode : undefined,
        note: isCloud ? `${INSTALLER_NOTE} ${ADVANCED_HINT}` : undefined,
        variants: installVariants,
      },
      {
        id: "instrument",
        title: "Auto-Instrument Your Applications for Traces",
        description:
          "Optional. The OpenTelemetry operator injects instrumentation into annotated workloads, so you get **distributed traces without touching application code or rebuilding images**. Pick a language, then annotate the namespace it runs in.",
        chip: { kind: "editor", label: "Optional" },
        completeOn: "copy",
        variants: instrumentVariants(),
      },
      {
        id: "verify",
        title: "Verify Data in OpenObserve",
        description:
          "Give the collector a few seconds to start, then hit Test — cluster logs land in the `default` stream.",
        chip: { kind: "traces", label: "Logs" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: [
          "Container Logs",
          "Kubernetes Events",
          "Node Metrics",
          "Pod Metrics",
          "Traces",
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
        label: "Advanced Installation (Manual Steps)",
        description: isCloud
          ? "For custom configurations, or to pin versions and customise the chart values. Run the steps in order."
          : `For custom configurations, or to pin versions and customise the chart values. Run the steps in order. If OpenObserve runs in this same cluster, replace the exporter endpoints with \`${IN_CLUSTER_URL}\`.`,
        code: codeFor(helmInstall("{url}"), subs),
      },
      fixTitle: "Wait For The cert-manager Webhook",
      fixBody:
        "The OpenTelemetry operator fails to start until cert-manager's webhook is serving, and a collector that never starts sends nothing. Check that both are running, then test again:",
      fixLang: "bash",
      fixSnippet: `kubectl wait --for=condition=Available --timeout=300s \\
  -n cert-manager deployment/cert-manager-webhook
kubectl get pods -n openobserve-collector`,
      troubleshooting: [
        {
          q: "The install fails with an error about the admission webhook",
          a: "The OpenTelemetry operator's webhook needs cert-manager's webhook to be serving first. Run `kubectl wait --for=condition=Available --timeout=300s -n cert-manager deployment/cert-manager-webhook`, then re-run the install — it is idempotent.",
        },
        {
          q: "The collector pods are running but nothing arrives",
          a: "Check the collector's own logs with `kubectl logs -n openobserve-collector -l app.kubernetes.io/name=openobserve-collector`. A 401 means the access key is stale — re-copy the command from this page. A connection timeout usually means the cluster cannot reach the endpoint: if OpenObserve runs in this same cluster, switch to an **In-Cluster** variant above.",
        },
        {
          q: "Which endpoint should I use — external or in-cluster?",
          a: `Use **In-Cluster** only when OpenObserve itself runs in this cluster; traffic then stays inside it and never crosses the network. The URL is \`http://<helm-release>-openobserve-router.<namespace>.svc.cluster.local:5080\` — the default assumes release \`o2\` in namespace \`openobserve\`, so edit it if yours differ. Everyone else uses the external endpoint.`,
        },
        {
          q: "I annotated a namespace but no traces appear",
          a: "Injection happens at pod creation, so existing pods are unaffected until they restart — run `kubectl rollout restart deployment -n my-namespace`. Confirm the annotation landed with `kubectl get ns my-namespace -o yaml`, and check that the value matches `openobserve-collector/openobserve-<language>`. For Go, `otel-go-auto-target-exe` must be the binary's path **inside** the container.",
        },
        {
          q: "Can I see a working example?",
          // inlineMd renders **bold** and `code` only — link syntax would show
          // as literal text, so URLs are written out.
          a: "Yes — `github.com/openobserve/hotcommerce` is a sample application wired up end to end. The full annotation reference lives in the OpenTelemetry operator docs at `github.com/open-telemetry/opentelemetry-operator`.",
        },
      ],
    },
    docUrl: "https://github.com/openobserve/openobserve-helm-chart",
  };
}
