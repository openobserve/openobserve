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

// The database cards' Docker and Kubernetes setup modes: the upstream collector image running each card's own config.

import { raw, type I18nKey, type TranslateFn } from "@/types/i18n";

import type {
  CardSubstitutions,
  RichCardInput,
  RichCardStep,
  RichCardStepVariant,
  RichCardUninstall,
} from "../types";
import { applySubs, applySubsMasked } from "../subs";
import { DBM_CONTRIB_VERSION } from "./dbmShared";
import type { InstallerDb } from "./dbInstaller";

export const COLLECTOR_IMAGE = `otel/opentelemetry-collector-contrib:${DBM_CONTRIB_VERSION}`;

/** Where the image reads its config; the mount replaces the image's default config.yaml. */
const CONFIG_DIR = "/etc/otelcol-contrib";

/** Per-mode host ids: the database is `localhost` to a host process but not to a container. */
export const DOCKER_HOST_INPUT = "dockerHost";
export const K8S_HOST_INPUT = "k8sHost";
const NAMESPACE_INPUT = "namespace";

export interface DbContainerOptions {
  db: InstallerDb;
  hostLabelKey: I18nKey;
  defaultPort: string;
  /** The in-cluster DNS name the Kubernetes host field starts with. */
  k8sHost: string;
  /** The card's metrics config, exactly as its manual configure step writes it. */
  configYaml: string;
  /** Environment the metrics config reads, with the card's placeholder values. */
  env: Record<string, string>;
  /** Shared with the manual steps; `scope: "dbm"` shows the field only with Database Monitoring. */
  database?: { default: string; scope: "all" | "dbm" };
  dbm?: {
    configYaml: string;
    /** Environment the DBM config adds on top of `env`. */
    env: Record<string, string>;
    /** The database log the DBM config tails; Docker mounts its directory. */
    logPath?: { default: string; labelKey: I18nKey; helpKey: I18nKey };
  };
}

/** Indents every non-empty line, for embedding a block under a YAML key. */
export const indent = (text: string, spaces: number): string =>
  text
    .split("\n")
    .map((line) => (line ? " ".repeat(spaces) + line : line))
    .join("\n");

/** Points a config's host placeholders at a mode's own host field. */
const retarget = (yaml: string, hostId: string) =>
  yaml.replaceAll("{host}", `{${hostId}}`).replaceAll("{server}", `{${hostId}}`);

export const containerName = (db: InstallerDb) => `o2-${db}-collector`;

const codeFor = (template: string, subs: CardSubstitutions) => ({
  lang: "bash",
  raw: applySubs(template, subs),
  masked: applySubsMasked(template, subs),
});

const shellEnv = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const envFor = (opts: DbContainerOptions, withDbm: boolean) => ({
  ...opts.env,
  ...(withDbm ? opts.dbm?.env : {}),
});

const configFiles = (opts: DbContainerOptions, withDbm: boolean, hostId: string) => [
  { name: "config.yaml", yaml: retarget(opts.configYaml, hostId) },
  ...(withDbm && opts.dbm
    ? [{ name: "dbm-config.yaml", yaml: retarget(opts.dbm.configYaml, hostId) }]
    : []),
];

const configArgs = (opts: DbContainerOptions, withDbm: boolean) =>
  configFiles(opts, withDbm, "").map((f) => `--config=${CONFIG_DIR}/${f.name}`);

// Quoted heredocs keep `${env:...}` literal for the collector to resolve.
const dockerCommand = (opts: DbContainerOptions, withDbm: boolean) => {
  const dir = containerName(opts.db);
  const writes = configFiles(opts, withDbm, DOCKER_HOST_INPUT)
    .map((f) => `cat > ${dir}/${f.name} <<'EOF'\n${f.yaml}\nEOF`)
    .join("\n");
  const mountLogs = withDbm && opts.dbm?.logPath !== undefined;
  const runLines = [
    `docker run -d --name ${dir} --restart unless-stopped`,
    "--add-host=host.docker.internal:host-gateway",
    ...Object.entries(envFor(opts, withDbm)).map(([k, v]) => `-e ${k}=${shellEnv(v)}`),
    `-v "$PWD/${dir}:${CONFIG_DIR}:ro"`,
    ...(mountLogs ? ['-v "$LOG_DIR:$LOG_DIR:ro"'] : []),
    COLLECTOR_IMAGE,
    ...configArgs(opts, withDbm),
  ];
  return [
    `mkdir -p ${dir}`,
    writes,
    ...(mountLogs
      ? [
          "# Deadlock capture tails the database log, so mount its directory read-only at the same path.",
          `LOG_DIR="$(dirname '{logpath}')"`,
        ]
      : []),
    // Replaces an earlier run, so switching variants is one paste.
    `docker rm -f ${dir} 2>/dev/null || true`,
    runLines.join(" \\\n  "),
  ].join("\n");
};

const k8sManifest = (opts: DbContainerOptions, withDbm: boolean) => {
  const name = containerName(opts.db);
  const ns = `{${NAMESPACE_INPUT}}`;
  const meta = `metadata:\n  name: ${name}\n  namespace: ${ns}\n  labels:\n    app: ${name}`;
  const env = Object.entries(envFor(opts, withDbm));
  const secret = env.length
    ? `---
apiVersion: v1
kind: Secret
${meta}
type: Opaque
stringData:
${env.map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join("\n")}
`
    : "";
  const files = configFiles(opts, withDbm, K8S_HOST_INPUT)
    .map((f) => `  ${f.name}: |\n${indent(f.yaml, 4)}`)
    .join("\n");
  // The DBM config's memory_limiter allows 768 MiB, so the pod limit sits above it.
  const memoryLimit = withDbm ? "1Gi" : "512Mi";
  const envFrom = env.length
    ? `
          envFrom:
            - secretRef:
                name: ${name}`
    : "";
  return `kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Namespace
metadata:
  name: ${ns}
${secret}---
apiVersion: v1
kind: ConfigMap
${meta}
data:
${files}
---
apiVersion: apps/v1
kind: Deployment
${meta}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}
    spec:
      containers:
        - name: otelcol
          image: ${COLLECTOR_IMAGE}
          args:
${configArgs(opts, withDbm)
  .map((a) => `            - ${a}`)
  .join("\n")}${envFrom}
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: ${memoryLimit}
          volumeMounts:
            - name: config
              mountPath: ${CONFIG_DIR}
              readOnly: true
      volumes:
        - name: config
          configMap:
            name: ${name}
EOF
# A changed ConfigMap reaches a running pod only through a restart.
kubectl rollout restart deployment/${name} -n ${ns}`;
};

const portInput = (opts: DbContainerOptions): RichCardInput => ({
  id: "port",
  labelKey: "ingestion.setupCard.portLabel",
  default: opts.defaultPort,
  placeholder: raw(opts.defaultPort),
  width: "sm",
});

const databaseInput = (opts: DbContainerOptions): RichCardInput[] =>
  opts.database
    ? [
        {
          id: "database",
          labelKey: "ingestion.setupCard.dbmDatabaseLabel",
          default: opts.database.default,
          placeholder: raw(opts.database.default),
        },
      ]
    : [];

const logPathInput = (opts: DbContainerOptions): RichCardInput[] =>
  opts.dbm?.logPath
    ? [
        {
          id: "logpath",
          labelKey: opts.dbm.logPath.labelKey,
          default: opts.dbm.logPath.default,
          placeholder: raw(opts.dbm.logPath.default),
          helpKey: opts.dbm.logPath.helpKey,
        },
      ]
    : [];

/** Metrics / Metrics + Database Monitoring variants, or one command for a card without DBM. */
const containerCode = (
  t: TranslateFn,
  subs: CardSubstitutions,
  opts: DbContainerOptions,
  build: (opts: DbContainerOptions, withDbm: boolean) => string,
  note: string,
  dbmInputs: RichCardInput[],
): Pick<RichCardStep, "code" | "note" | "variants"> => {
  if (!opts.dbm) return { code: codeFor(build(opts, false), subs), note: raw(note) };
  const dbmDatabase = opts.database?.scope === "dbm" ? databaseInput(opts) : [];
  const variants: RichCardStepVariant[] = [
    {
      id: "metrics",
      labelKey: "common.metrics",
      code: codeFor(build(opts, false), subs),
      note: raw(note),
    },
    {
      id: "metrics-dbm",
      labelKey: "ingestion.setupCard.dbInstallerDbmVariant",
      code: codeFor(build(opts, true), subs),
      inputs: [...dbmDatabase, ...dbmInputs].length ? [...dbmDatabase, ...dbmInputs] : undefined,
      note: raw(`${t("ingestion.setupCard.dbContainerDbmNote")} ${note}`),
    },
  ];
  return { variants };
};

const stepDatabase = (opts: DbContainerOptions) =>
  opts.database?.scope === "all" ? databaseInput(opts) : [];

/** The Docker-mode step: write the config next to a `docker run` of the upstream image. */
export function dbDockerStep(
  t: TranslateFn,
  subs: CardSubstitutions,
  opts: DbContainerOptions,
): RichCardStep {
  const note = [
    t("ingestion.setupCard.dbDockerNote", { image: COLLECTOR_IMAGE }),
    ...(opts.dbm?.logPath ? [t("ingestion.setupCard.dbDockerLogNote")] : []),
  ].join(" ");
  return {
    id: "docker-run",
    mode: "docker",
    titleKey: "ingestion.setupCard.dbDockerTitle",
    descriptionKey: "ingestion.setupCard.dbDockerDesc",
    chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
    required: true,
    completeOn: "copy",
    inputs: [
      {
        id: DOCKER_HOST_INPUT,
        labelKey: opts.hostLabelKey,
        default: "host.docker.internal",
        placeholder: raw("host.docker.internal"),
        helpKey: "ingestion.setupCard.dbDockerHostHelp",
      },
      portInput(opts),
      ...stepDatabase(opts),
    ],
    ...containerCode(t, subs, opts, dockerCommand, note, logPathInput(opts)),
  };
}

/** The Kubernetes-mode step: one Deployment of the upstream image, its config in a ConfigMap. */
export function dbKubernetesStep(
  t: TranslateFn,
  subs: CardSubstitutions,
  opts: DbContainerOptions,
): RichCardStep {
  const note = [
    t("ingestion.setupCard.dbK8sNote", { image: COLLECTOR_IMAGE }),
    ...(opts.dbm?.logPath ? [t("ingestion.setupCard.dbK8sLogNote")] : []),
  ].join(" ");
  return {
    id: "k8s-deploy",
    mode: "kubernetes",
    titleKey: "ingestion.setupCard.dbK8sTitle",
    descriptionKey: "ingestion.setupCard.dbK8sDesc",
    chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
    required: true,
    completeOn: "copy",
    inputs: [
      {
        id: NAMESPACE_INPUT,
        labelKey: "ingestion.setupCard.dbK8sNamespaceLabel",
        default: "openobserve-collector",
        placeholder: raw("openobserve-collector"),
      },
      {
        id: K8S_HOST_INPUT,
        labelKey: opts.hostLabelKey,
        default: opts.k8sHost,
        placeholder: raw(opts.k8sHost),
        helpKey: "ingestion.setupCard.dbK8sHostHelp",
      },
      portInput(opts),
      ...stepDatabase(opts),
    ],
    ...containerCode(t, subs, opts, k8sManifest, note, []),
  };
}

/** Removal for each container mode, shown in place of the script's uninstall. */
export function dbContainerUninstalls(db: InstallerDb): RichCardUninstall[] {
  const name = containerName(db);
  return [
    {
      mode: "docker",
      labelKey: "ingestion.setupCard.dbUninstallLabel",
      descriptionKey: "ingestion.setupCard.dbDockerUninstallDesc",
      code: { lang: "bash", raw: `docker rm -f ${name}\nrm -rf ${name}` },
    },
    {
      mode: "kubernetes",
      labelKey: "ingestion.setupCard.dbUninstallLabel",
      descriptionKey: "ingestion.setupCard.dbK8sUninstallDesc",
      code: {
        lang: "bash",
        raw: `kubectl delete deployment,configmap,secret -n {${NAMESPACE_INPUT}} -l app=${name}`,
      },
    },
  ];
}
