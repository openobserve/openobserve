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

// Cloud onboarding data model. This file alone decides which setup guide each
// option opens. Row and segment ids are fixed English slugs: they appear in URLs
// and must never be derived from translated text.

import { getAICardRaw } from "@/components/ingestion/ai/content";
import { aiCategories } from "@/components/ingestion/ai/data";
import { LANGUAGES as K8S_TRACE_LANGUAGES } from "@/components/ingestion/setupCard/content/kubernetes";
import type { SetupCardPresets } from "@/components/ingestion/setupCard/types";
import type { FirstSourceId } from "@/components/login/firstSourceOptions";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

import type { OnboardingExampleKind } from "./examples/onboardingExamples";

export type OnboardingChoiceId = "infrastructure" | "backend" | "frontend" | "logs" | "llm";

/** What a choice collects, as chips on the brand panel. The label is `onboarding.signals.<id>`. */
export const SIGNAL_ICONS = {
  metrics: "bar-chart",
  logs: "article",
  traces: "account-tree",
  profiles: "memory",
  sessions: "person",
  errors: "error-outline",
  webVitals: "speed",
  replays: "play-circle",
  tokens: "data-usage",
  cost: "paid",
  latency: "timer",
  uptime: "monitor-heart",
  certificates: "lock",
} as const satisfies Record<string, IconName>;

export type OnboardingSignal = keyof typeof SIGNAL_ICONS;

export interface OnboardingGuide {
  id: string;
  name: I18nText;
  route: string;
  firstSource?: FirstSourceId;
  /** Setup card slug (setupCard/registry.ts) the guide's own page renders; the guide then opens inside onboarding. */
  cardSlug?: string;
  /** One short line under the guide's tile. */
  about?: I18nText;
  /** A logo URL the catalog already resolved (AI integrations); others use `guideLogo`. */
  logo?: string;
  /** A language tile: its opentelemetry.io getting-started page (`docs/languages/<slug>/`) and the language it covers. */
  otelDocs?: { slug: string; language: I18nText };
}

export interface OnboardingGroup {
  heading?: I18nText;
  guides: OnboardingGuide[];
}

/** One answer on a row's traces step, with what the brand panel shows for it. */
export interface OnboardingTraceOption {
  id: "off" | "ebpf" | "library";
  name: I18nText;
  description: I18nText;
  icon: IconName;
  /** The panel text while the answer is under the pointer or focus. */
  about: I18nText;
  example: OnboardingExampleKind;
  signals: OnboardingSignal[];
}

/** The traces step a row asks before its guide; the guide then shows only the chosen tracing. */
export interface OnboardingTraces {
  question: I18nText;
  options: OnboardingTraceOption[];
  /** The setup card's library languages, by the card's ids. */
  languages: { id: string; name: I18nText }[];
}

export interface OnboardingRow {
  id: string;
  name: I18nText;
  description: I18nText;
  about: I18nText;
  icon: IconName;
  /** A row that opens one guide. */
  route?: string;
  firstSource?: FirstSourceId;
  cardSlug?: string;
  /** A row that opens the "which one?" page. */
  question?: I18nText;
  groups?: OnboardingGroup[];
  /** The "Something else" row. */
  more?: boolean;
  /** Offers the coding agent page as another way to set up this row. */
  agent?: boolean;
  /** Asks whether and how to trace on a step of its own before the row's guide. */
  traces?: OnboardingTraces;
}

export interface OnboardingChoice {
  id: OnboardingChoiceId;
  name: I18nText;
  description: I18nText;
  icon: IconName;
  /** One sentence on what the choice gives, under its name on the brand panel. */
  gets: I18nText;
  signals: OnboardingSignal[];
  question: I18nText;
  rows: OnboardingRow[];
}

export type ResolvedStep =
  | { step: "choose" }
  | { step: "rows"; choice: OnboardingChoice }
  | { step: "which"; choice: OnboardingChoice; row: OnboardingRow }
  | { step: "traces"; choice: OnboardingChoice; row: OnboardingRow; traces: OnboardingTraces }
  | { step: "guide"; choice: OnboardingChoice; row: OnboardingRow; guide: OnboardingGuide }
  | { step: "agent" }
  | { step: "redirect"; path: string[] };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const camel = (s: string) => s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

/** A guide for a product: the English name is not translated. */
const guide = (
  name: string,
  route: string,
  firstSource?: FirstSourceId,
  cardSlug?: string,
): OnboardingGuide => ({
  id: slug(name),
  name: raw(name),
  route,
  firstSource,
  cardSlug,
});

const one = (...guides: OnboardingGuide[]): OnboardingGroup[] => [{ guides }];

/**
 * A language tile. Its app route holds only an HTTP logs snippet, so it opens the OTLP traces card,
 * whose SDK tab works for any language, and links the language's OpenTelemetry guide.
 */
const language = (name: string, route: string, slug: string, docsLanguage = name) => ({
  ...guide(name, route, undefined, "otlpTraces"),
  otelDocs: { slug, language: raw(docsLanguage) },
});

// Each guide's logo, as the Data sources page shows it, by app route; language tiles by their id.
const LOGOS_BY_ROUTE: Record<string, string> = {
  aerospike: "images/ingestion/aerospike.svg",
  airbyte: "images/ingestion/airbyte.svg",
  airflow: "images/ingestion/airflow.svg",
  ansible: "images/ingestion/ansible.svg",
  apache: "images/ingestion/apache.svg",
  AWSConfig: "images/ingestion/aws.svg",
  AzureConfig: "images/ingestion/azure.png",
  cassandra: "images/ingestion/cassandra.png",
  cloudwatchMetrics: "images/ingestion/cloud_watch.svg",
  couchdb: "images/ingestion/couchdb.svg",
  cribl: "images/ingestion/cribl.webp",
  databricks: "images/ingestion/databricks.svg",
  dynamodb: "images/ingestion/dynamodb.png",
  elasticsearch: "images/ingestion/elasticsearch.svg",
  falco: "images/ingestion/falco.png",
  filebeat: "images/ingestion/filebeat.png",
  fluentbit: "images/ingestion/fluentbit_icon.png",
  fluentd: "images/ingestion/fluentd_icon.svg",
  frontendMonitoring: "images/common/monitoring.svg",
  GCPConfig: "images/ingestion/gcp.svg",
  gcpLogs: "images/ingestion/gcp.svg",
  "github-actions": "images/ingestion/github-actions.svg",
  "google-workspace": "images/ingestion/google-workspace.png",
  heroku: "images/ingestion/heroku.svg",
  iis: "images/ingestion/microsoft-iis.svg",
  ingestFromGpu: "images/ingestion/nvidia.svg",
  ingestFromKubernetes: "images/common/kubernetes.svg",
  ingestFromLinux: "images/common/linux.svg",
  ingestFromMacOS: "images/common/macos.png",
  ingestFromWindows: "images/common/windows.svg",
  ingestLogsFromOtel: "images/ingestion/otlp.svg",
  jenkins: "images/ingestion/jenkins.svg",
  jumpcloud: "images/ingestion/jumpcloud.svg",
  kafka: "images/ingestion/kafka.svg",
  kinesisfirehose: "images/ingestion/kinesis_firehose.svg",
  logstash: "images/ingestion/logstash.svg",
  loongcollector: "images/ingestion/loongcollector.svg",
  mariadb: "images/ingestion/mysql.svg",
  mongodb: "images/ingestion/mongodb.svg",
  mysql: "images/ingestion/mysql.svg",
  nats: "images/ingestion/nats.svg",
  netflow: "images/ingestion/netflow.svg",
  nginx: "images/ingestion/nginx.svg",
  office365: "images/ingestion/office-365.png",
  okta: "images/ingestion/okta.png",
  openvpn: "images/ingestion/openvpn.png",
  oracle: "images/ingestion/oracle.svg",
  osquery: "images/ingestion/os-query.png",
  otelCollector: "images/ingestion/otlp.svg",
  postgres: "images/ingestion/postgres.png",
  profilesOtelCollector: "images/ingestion/otlp.svg",
  prometheus: "images/ingestion/prometheus.svg",
  rabbitmq: "images/ingestion/rabbitmq.svg",
  redis: "images/ingestion/redis.svg",
  saphana: "images/ingestion/saphana.png",
  snowflake: "images/ingestion/snowflake.svg",
  splunkHec: "images/ingestion/splunk.webp",
  sqlserver: "images/ingestion/sqlserver.png",
  syslogNg: "images/ingestion/syslog.svg",
  telegraf: "images/ingestion/telegraf.png",
  terraform: "images/ingestion/terraform.svg",
  tracesOTLP: "images/ingestion/otlp.svg",
  vector: "images/ingestion/vector_icon.png",
  vercel: "images/ingestion/vercel.svg",
  zookeeper: "images/ingestion/zookeeper.png",
};
const LOGOS_BY_ID: Record<string, string> = {
  java: "images/ingestion/java.svg",
  "node-js": "images/ingestion/nodejs.svg",
  python: "images/ingestion/python.svg",
  go: "images/ingestion/golang.svg",
  net: "images/ingestion/dotnet.svg",
  rust: "images/ingestion/rust.svg",
  fastapi: "images/ingestion/fastapi.svg",
};

/** A guide's logo path under `assets/`, when the Data sources page has one. */
export const guideLogo = (g: OnboardingGuide): string | undefined =>
  g.logo ?? LOGOS_BY_ID[g.id] ?? LOGOS_BY_ROUTE[g.route];

/** The coding agents onboarding names, as {claudeCode}, {cursor} and {codex} placeholders. */
export const CODING_AGENTS = {
  claudeCode: raw("Claude Code"),
  cursor: raw("Cursor"),
  codex: raw("Codex"),
};

// Product names fill the {placeholders} of the onboarding strings, so the sentences hold no brand.
const NAMES = {
  product: raw("OpenObserve"),
  sdk: raw("OpenObserve RUM SDK"),
  otel: raw("OpenTelemetry"),
  otelCollector: raw("OpenTelemetry Collector"),
  otelLibrary: raw("OpenTelemetry library"),
  otelOperator: raw("OpenTelemetry operator"),
  otelSdk: raw("OpenTelemetry SDK"),
  productAgent: raw("OpenObserve agent"),
  productCollector: raw("OpenObserve collector"),
  openaiSdk: raw("OpenAI SDK"),
  assistantsApi: raw("Assistants API"),
  anthropicSdk: raw("Anthropic SDK"),
  claudeAgentSdk: raw("Claude Agent SDK"),
  k8s: raw("Kubernetes"),
  linux: raw("Linux"),
  windows: raw("Windows"),
  macos: raw("macOS"),
  aws: raw("AWS"),
  gcp: raw("Google Cloud"),
  azure: raw("Azure"),
  prometheus: raw("Prometheus"),
  nodejs: raw("Node.js"),
  python: raw("Python"),
  java: raw("Java"),
  go: raw("Go"),
  dotnet: raw(".NET"),
  rust: raw("Rust"),
  fastapi: raw("FastAPI"),
  splunk: raw("Splunk"),
  cribl: raw("Cribl"),
  curl: raw("curl"),
  android: raw("Android"),
  ios: raw("iOS"),
  openai: raw("OpenAI"),
  anthropic: raw("Anthropic"),
  claude: raw("Claude"),
  langchain: raw("LangChain"),
  fluentBit: raw("Fluent Bit"),
  pubSub: raw("Pub/Sub"),
  eventHub: raw("Event Hub"),
  kinesisFirehose: raw("Kinesis Firehose"),
  nvidia: raw("NVIDIA"),
};

/** `profiling`: the server's `profiling_enabled`; without it the Profiles page does not open. */
export function buildChoices(
  translate: TranslateFn,
  { profiling = false }: { profiling?: boolean } = {},
): OnboardingChoice[] {
  const t = (key: string, named: Record<string, unknown> = {}) =>
    translate(key, { ...NAMES, ...named });
  // Row ids are fixed slugs; the i18n key is the camelCase of the id.
  const choice = (
    id: OnboardingChoiceId,
    icon: IconName,
    signals: OnboardingSignal[],
    rows: (row: RowFactory) => OnboardingRow[],
  ): OnboardingChoice => ({
    id,
    icon,
    name: t(`onboarding.${id}.name`),
    description: t(`onboarding.${id}.description`),
    gets: t(`onboarding.${id}.gets`),
    signals,
    question: t(`onboarding.${id}.question`),
    rows: rows((rowId, icon, rest = {}) => {
      const k = `onboarding.${id}.rows.${camel(rowId)}`;
      const { name: _name, examples, params: given, ...more } = rest;
      // "{examples} and {count} more" follows the guide list, so it cannot drift.
      const listed = more.groups?.flatMap((g) => g.guides) ?? [];
      const params = {
        ...(examples
          ? {
              examples: raw(
                listed
                  .slice(0, examples)
                  .map((g) => g.name)
                  .join(", "),
              ),
              count: listed.length - examples,
            }
          : {}),
        ...given,
      };
      return {
        id: rowId,
        name: rest.name ?? t(`${k}.name`, params),
        description: t(`${k}.description`, params),
        about: t(`${k}.about`, params),
        icon,
        ...(more.groups && !more.question ? { question: t(`${k}.question`, params) } : {}),
        ...more,
      };
    }).filter((r) => !r.groups || r.groups.some((g) => g.guides.length > 0)),
  });
  const heading = (key: string) => t(`onboarding.groups.${key}`);

  const aiBySlug = (slugs: string[]): OnboardingGuide[] =>
    slugs.flatMap((s): OnboardingGuide[] => {
      const hit = aiCategories.flatMap((c) => c.integrations).find((i) => i.slug === s);
      // The catalog comes from a fetched manifest; a renamed slug must not break onboarding.
      if (!hit) {
        console.warn(`onboarding: unknown AI integration "${s}"`);
        return [];
      }
      return [{ id: hit.slug, name: raw(hit.name), route: hit.routeName, firstSource: "llm" }];
    });

  const rum = { route: "frontendMonitoring", firstSource: "rum" as const };

  // A row's traces step; its text is under `onboarding.collect.<key>`. `signals` is what the
  // install always sends.
  const traces = (
    key: string,
    signals: OnboardingSignal[],
    languages: { id: string; label: string }[],
  ): OnboardingTraces => {
    const k = `onboarding.collect.${key}`;
    const option = (
      id: OnboardingTraceOption["id"],
      icon: IconName,
      example: OnboardingExampleKind,
    ): OnboardingTraceOption => ({
      id,
      name: t(`${k}.${id}.name`),
      description: t(`${k}.${id}.description`),
      icon,
      about: t(`${k}.${id}.about`),
      example,
      signals: id === "off" ? signals : [...signals, "traces"],
    });
    return {
      question: t(`${k}.question`),
      options: [
        option("off", "dns", "infrastructure"),
        option("ebpf", "memory", "backend"),
        option("library", "code", "backend"),
      ],
      languages: languages.map((l) => ({ id: l.id, name: raw(l.label) })),
    };
  };

  const backendSignals: OnboardingSignal[] = profiling
    ? ["traces", "logs", "profiles"]
    : ["traces", "logs"];

  const choices: OnboardingChoice[] = [
    choice("infrastructure", "dns", ["metrics", "logs", "traces"], (row) => [
      row("kubernetes-cluster", "view-in-ar", {
        route: "ingestFromKubernetes",
        firstSource: "kubernetes",
        cardSlug: "kubernetes",
        traces: traces("kubernetesCluster", ["logs", "metrics"], K8S_TRACE_LANGUAGES),
      }),
      row("linux-windows-or-macos-host", "computer", {
        groups: one(
          guide("Linux", "ingestFromLinux", "linux", "linux"),
          guide("Windows", "ingestFromWindows", "windows", "windows"),
          guide("macOS", "ingestFromMacOS", undefined, "macos"),
        ),
      }),
      row("cloud-account", "cloud", {
        groups: one(
          guide("AWS", "AWSConfig", "cloud"),
          guide("Google Cloud", "GCPConfig", "cloud", "gcp"),
          guide("Azure", "AzureConfig", "cloud"),
        ),
      }),
      row("databases", "database", {
        examples: 4,
        groups: one(
          guide("PostgreSQL", "postgres", undefined, "postgres"),
          guide("MySQL", "mysql", undefined, "mySQL"),
          guide("MongoDB", "mongodb", undefined, "mongoDB"),
          guide("Redis", "redis", undefined, "redis"),
          guide("SQL Server", "sqlserver", undefined, "sqlServer"),
          guide("Oracle", "oracle", undefined, "oracle"),
          guide("MariaDB", "mariadb", undefined, "mariaDB"),
          guide("Elasticsearch", "elasticsearch"),
          guide("Cassandra", "cassandra", undefined, "cassandra"),
          guide("DynamoDB", "dynamodb", undefined, "dynamoDB"),
          guide("Snowflake", "snowflake", undefined, "snowflake"),
          guide("Databricks", "databricks", undefined, "databricks"),
          guide("CouchDB", "couchdb"),
          guide("Aerospike", "aerospike", undefined, "aerospike"),
          guide("SAP HANA", "saphana"),
          guide("Zookeeper", "zookeeper", undefined, "zookeeper"),
        ),
      }),
      row("something-else", "extension", {
        more: true,
        groups: [
          {
            heading: heading("webServers"),
            guides: [
              guide("Nginx", "nginx", "webserver"),
              guide("Apache", "apache"),
              guide("IIS", "iis"),
            ],
          },
          {
            heading: heading("messageQueues"),
            guides: [guide("Kafka", "kafka"), guide("RabbitMQ", "rabbitmq"), guide("NATS", "nats")],
          },
          {
            heading: heading("metricsYouCollect"),
            guides: [
              guide("Prometheus", "prometheus"),
              guide("Telegraf", "telegraf"),
              guide("OpenTelemetry Collector", "otelCollector", "otel"),
              guide("CloudWatch", "cloudwatchMetrics"),
            ],
          },
          {
            heading: heading("gpuAndNetwork"),
            guides: [guide("GPU", "ingestFromGpu"), guide("Network flows", "netflow")],
          },
        ],
      }),
    ]),

    choice("backend", "code", backendSignals, (row) => [
      row("add-a-library-to-your-code", "code", {
        agent: true,
        groups: one(
          language("Node.js", "nodejs", "js"),
          language("Python", "python", "python"),
          language("Java", "java", "java"),
          language("Go", "go", "go"),
          language(".NET", "dotnettracing", "dotnet"),
          language("Rust", "rust", "rust"),
          language("FastAPI", "fastapi", "python", "Python"),
        ),
      }),
      row("kubernetes-workloads-no-code-changes", "view-in-ar", {
        route: "ingestFromKubernetes",
        cardSlug: "kubernetes",
      }),
      row("any-language-with-opentelemetry", "send", {
        route: "tracesOTLP",
        firstSource: "otel",
        cardSlug: "otlpTraces",
        agent: true,
      }),
      ...(profiling
        ? [row("continuous-profiling", "speed", { route: "profilesOtelCollector" })]
        : []),
    ]),

    // All four open the same guide for now; phase 2 can preselect the platform tab.
    choice("frontend", "devices", ["sessions", "errors", "webVitals", "replays"], (row) => [
      row("browser", "web", rum),
      row("react-native", "devices", {
        ...rum,
        name: raw("React Native"),
        params: { platform: raw("React Native") },
      }),
      row("android", "android", {
        ...rum,
        name: raw("Android"),
        params: { platform: NAMES.android },
      }),
      row("ios", "phone-iphone", { ...rum, name: raw("iOS"), params: { platform: NAMES.ios } }),
    ]),

    choice("logs", "article", ["logs"], (row) => [
      row("from-a-log-shipper-you-run", "extension", {
        examples: 4,
        groups: one(
          guide("Fluent Bit", "fluentbit"),
          guide("Fluentd", "fluentd"),
          guide("Vector", "vector"),
          guide("Filebeat", "filebeat"),
          guide("Logstash", "logstash"),
          guide("syslog-ng", "syslogNg"),
          guide("LoongCollector", "loongcollector"),
        ),
      }),
      row("over-http-with-curl", "send", { route: "curl", firstSource: "http" }),
      row("from-opentelemetry", "code", { route: "ingestLogsFromOtel" }),
      row("something-else", "swap-horiz", {
        more: true,
        groups: [
          {
            heading: heading("movingFromAnotherTool"),
            guides: [guide("Splunk HEC", "splunkHec"), guide("Cribl", "cribl")],
          },
          {
            heading: heading("cloudLogs"),
            guides: [
              guide("Kinesis Firehose", "kinesisfirehose"),
              guide("Google Cloud logs", "gcpLogs"),
            ],
          },
          {
            heading: heading("securityTools"),
            guides: [
              guide("Okta", "okta"),
              guide("Office 365", "office365"),
              guide("Google Workspace", "google-workspace"),
              guide("Falco", "falco"),
              guide("osquery", "osquery"),
              guide("JumpCloud", "jumpcloud"),
              guide("OpenVPN", "openvpn"),
            ],
          },
          {
            heading: heading("cicdAndPlatforms"),
            guides: [
              guide("GitHub Actions", "github-actions"),
              guide("Jenkins", "jenkins"),
              guide("Terraform", "terraform"),
              guide("Ansible", "ansible"),
              guide("Vercel", "vercel"),
              guide("Heroku", "heroku"),
              guide("Airflow", "airflow"),
              guide("Airbyte", "airbyte"),
            ],
          },
        ],
      }),
    ]),

    choice("llm", "smart-toy", ["traces", "tokens", "cost", "latency"], (row) => [
      row("openai", "smart-toy", {
        name: raw("OpenAI"),
        groups: one(...aiBySlug(["openai", "openai-jsts", "openai-agents", "openai-assistants"])),
      }),
      row("anthropic", "smart-toy", {
        name: raw("Anthropic"),
        groups: one(...aiBySlug(["anthropic", "anthropic-jsts", "claude-agent-sdk"])),
      }),
      row("langchain-or-langgraph", "smart-toy", {
        name: raw("LangChain or LangGraph"),
        groups: one(...aiBySlug(["langchain", "langgraph", "deepagents", "langserve"])),
      }),
      row("something-else", "extension", {
        more: true,
        // One group per catalog category, so the list can never drift from the catalog.
        groups: aiCategories.map((c) => ({
          heading: raw(c.name),
          guides: c.integrations.map((i): OnboardingGuide => ({
            id: i.slug,
            name: raw(i.name),
            route: i.routeName,
            firstSource: "llm",
            logo: i.logo,
          })),
        })),
      }),
    ]),
  ];

  // A short line under each guide tile. Language tiles share one, as do AI integrations.
  for (const g of choices.flatMap((c) =>
    c.rows.flatMap((r) => r.groups ?? []).flatMap((gr) => gr.guides),
  )) {
    const key = g.otelDocs
      ? "onboarding.guideAbout.languageTile"
      : g.firstSource === "llm"
        ? "onboarding.guideAbout.aiIntegration"
        : `onboarding.guideAbout.${camel(g.id)}`;
    const text = t(key, { otel: raw("OpenTelemetry") });
    if (text !== key) g.about = text;
  }
  return choices;
}

type RowFactory = (
  id: string,
  icon: IconName,
  rest?: Partial<
    Pick<
      OnboardingRow,
      "route" | "firstSource" | "cardSlug" | "groups" | "more" | "question" | "agent" | "traces"
    >
  > & {
    name?: I18nText;
    /** Names of the first guides to list in the description; the rest become a count. */
    examples?: number;
    params?: Record<string, I18nText>;
  },
) => OnboardingRow;

const rowGuides = (row: OnboardingRow): OnboardingGuide[] =>
  row.route
    ? [
        {
          id: row.id,
          name: row.name,
          route: row.route,
          firstSource: row.firstSource,
          cardSlug: row.cardSlug,
        },
      ]
    : (row.groups ?? []).flatMap((g) => g.guides);

/**
 * Maps URL segments `[choice, row, guide]`, or `["agent"]`, to a screen. A bad segment redirects
 * to the longest valid prefix, so a mistyped URL lands one level up, not on an error.
 */
export function resolvePath(choices: OnboardingChoice[], segments: string[]): ResolvedStep {
  const [choiceId, rowId, guideId, ...extra] = segments;
  if (choiceId === undefined) return { step: "choose" };
  if (choiceId === "agent") {
    return rowId === undefined ? { step: "agent" } : { step: "redirect", path: ["agent"] };
  }
  const choice = choices.find((c) => c.id === choiceId);
  if (!choice) return { step: "redirect", path: [] };
  if (rowId === undefined) return { step: "rows", choice };
  const row = choice.rows.find((r) => r.id === rowId);
  if (!row) return { step: "redirect", path: [choice.id] };
  if (row.route) {
    if (guideId === undefined) return { step: "guide", choice, row, guide: rowGuides(row)[0] };
    if (guideId === "traces" && row.traces && !extra.length) {
      return { step: "traces", choice, row, traces: row.traces };
    }
    return { step: "redirect", path: [choice.id, row.id] };
  }
  if (guideId === undefined) return { step: "which", choice, row };
  const hit = rowGuides(row).find((g) => g.id === guideId);
  if (!hit || extra.length) return { step: "redirect", path: [choice.id, row.id] };
  return { step: "guide", choice, row, guide: hit };
}

/**
 * Finds guides by name across all choices, for "did you mean" hints.
 * `skipRowId` is `"<choice id>/<row id>"` (row ids repeat across choices) and
 * leaves that row out, so the row the user is already on does not echo back.
 */
export function findGuides(choices: OnboardingChoice[], query: string, skipRowId?: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set<string>();
  const hits: { guide: OnboardingGuide; choice: OnboardingChoice; row: OnboardingRow }[] = [];
  for (const choice of choices) {
    for (const row of choice.rows) {
      if (`${choice.id}/${row.id}` === skipRowId) continue;
      for (const guide of rowGuides(row)) {
        if (!guide.name.toLowerCase().includes(q) || seen.has(guide.id)) continue;
        seen.add(guide.id);
        hits.push({ guide, choice, row });
      }
    }
  }
  return hits;
}

/**
 * The tracing answer in a URL query: `traces=off`, `traces=ebpf`, or
 * `traces=library&langs=java,nodejs`. With no answer, `traces` is undefined.
 */
export function readTraces(query: Record<string, unknown>): SetupCardPresets {
  const { traces, langs } = query;
  const answer = traces === "off" || traces === "ebpf" || traces === "library" ? traces : undefined;
  const languages = answer === "library" && typeof langs === "string" ? langs.split(",") : [];
  return { traces: answer, languages: languages.filter(Boolean) };
}

/** The query `readTraces` reads back. */
export function tracesQuery({ traces, languages }: SetupCardPresets): Record<string, string> {
  if (!traces) return {};
  return traces === "library" ? { traces, langs: languages.join(",") } : { traces };
}

/** The onboarding URL segments of a guide; a row that opens one guide has no guide segment. */
export function guidePath(
  choiceId: OnboardingChoiceId,
  row: OnboardingRow,
  guide?: OnboardingGuide,
): string[] {
  return row.route || !guide ? [choiceId, row.id] : [choiceId, row.id, guide.id];
}

// Data sources pages that always open with a title of their own.
const PAGES_WITH_TITLE = new Set(["AWSConfig", "AzureConfig"]);
// Data sources pages built on a setup card, whose hero is the title.
const SETUP_CARD_PAGES = new Set(["ingestFromGpu", "gcpLogs"]);

/** What the guides whose own title comes and goes depend on. */
export interface GuideTitleState {
  rumToken: boolean;
  passcodeForbidden: boolean;
}

/**
 * Whether a guide shows a title of its own: its setup card's hero, or its Data sources page's
 * title. Onboarding titles every other guide; onboardingGuideTitles.spec.ts holds each to one.
 */
export function guideHasTitle(
  guide: Pick<OnboardingGuide, "route" | "cardSlug">,
  org: GuideTitleState,
): boolean {
  // A forbidden passcode shows a banner in place of the setup card.
  if (guide.cardSlug || SETUP_CARD_PAGES.has(guide.route)) return !org.passcodeForbidden;
  // The RUM card needs no passcode, but shows only once the org has a RUM token.
  if (guide.route === "frontendMonitoring") return org.rumToken;
  if (PAGES_WITH_TITLE.has(guide.route)) return true;
  // An AI integration page shows its setup card only with card content and a readable passcode.
  const ai = aiCategories.flatMap((c) => c.integrations).find((i) => i.routeName === guide.route);
  return !!ai && !org.passcodeForbidden && !!getAICardRaw(ai.contentSlug ?? ai.slug);
}

/** The onboarding URL segments of the first guide for `route` that has a setup card. */
export function cardGuidePath(choices: OnboardingChoice[], route: string): string[] | undefined {
  for (const choice of choices) {
    for (const row of choice.rows) {
      const hit = rowGuides(row).find((g) => g.route === route && g.cardSlug);
      if (hit) return guidePath(choice.id, row, hit);
    }
  }
  return undefined;
}
