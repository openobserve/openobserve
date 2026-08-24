// ─────────────────────────────────────────────────────────────────────────────
// APPROVED SERVICE GLYPH REGISTRY
//
// The non-Unicode half of the icon picker: FULL-COLOUR product marks for the
// services OpenObserve integrates with, so a folder icon matches the logo shown
// on the Ingestion pages. Same contract as lib/core/Icon/OIcon.icons.ts — every
// glyph is listed explicitly and resolved at BUILD TIME, so there are no runtime
// fetches and the app stays usable in air-gapped environments.
//
// TWO SOURCES, one map:
//   • `@iconify-json/logos` — the canonical colour brand set, compiled by
//     unplugin-icons into inline SVG components.
//   • `@/assets/images/ingestion/*` — the repo's own logos, used for the
//     services `logos` has no entry for (Fluentd, Telegraf, Databricks, IIS…).
//     These are the exact files the Ingestion pages render, so the picker and
//     the integrations list can never drift apart. Vite fingerprints them and
//     they resolve to a URL, hence the `string` half of the value union.
//
// Deliberately NOT the monochrome `simple-icons` set — these are meant to read
// as the real product logos, in colour.
//
// The list IS the bundle cost: unplugin-icons only emits what is imported, so
// adding all ~2,100 upstream logos would ship all ~2,100. Keep it curated.
//
// To add a glyph:
//   1. Prefer ~icons/logos/{name}; fall back to an asset under
//      @/assets/images/ingestion if the collection has no entry
//   2. Add a `<ourShortName>: Value` pair to GLYPH_REGISTRY
//   3. Give it keywords in emojiCatalog.ts (one owner per keyword)
//
// The stored icon value is the KEY prefixed with `o2:` (e.g. "o2:redis"), which
// is what distinguishes a service glyph from a Unicode emoji in the same field.
// ─────────────────────────────────────────────────────────────────────────────

import type { Component } from "vue";

// ── Databases & storage ──────────────────────────────────────────────────────
import Postgresql from "~icons/logos/postgresql";
import Mysql from "~icons/logos/mysql-icon";
import MariaDb from "~icons/logos/mariadb-icon";
import Mongodb from "~icons/logos/mongodb-icon";
import Redis from "~icons/logos/redis";
import Snowflake from "~icons/logos/snowflake-icon";
import Cassandra from "~icons/logos/cassandra";
import DynamoDb from "~icons/logos/aws-dynamodb";
import Aerospike from "~icons/logos/aerospike-icon";
import CouchDb from "~icons/logos/couchdb-icon";
import Sqlite from "~icons/logos/sqlite";
import Sap from "~icons/logos/sap";

// ── Message queues & streaming ───────────────────────────────────────────────
import Kafka from "~icons/logos/kafka-icon";
import RabbitMq from "~icons/logos/rabbitmq-icon";
import Nats from "~icons/logos/nats-icon";
import Spark from "~icons/logos/spark";

// ── Servers & networking ─────────────────────────────────────────────────────
import Nginx from "~icons/logos/nginx";
import ApacheHttp from "~icons/logos/apache-http";
import Cloudflare from "~icons/logos/cloudflare-icon";

// ── Orchestration & DevOps ───────────────────────────────────────────────────
import Kubernetes from "~icons/logos/kubernetes";
import Docker from "~icons/logos/docker-icon";
import Helm from "~icons/logos/helm";
import Argo from "~icons/logos/argo-icon";
import Terraform from "~icons/logos/terraform-icon";
import Ansible from "~icons/logos/ansible";
import Jenkins from "~icons/logos/jenkins";
import GitHubActions from "~icons/logos/github-actions";
import Vercel from "~icons/logos/vercel-icon";
import Heroku from "~icons/logos/heroku-icon";
import Airflow from "~icons/logos/airflow-icon";
import Vault from "~icons/logos/vault-icon";
import Consul from "~icons/logos/consul";
import Linux from "~icons/logos/linux-tux";

// ── Cloud providers ──────────────────────────────────────────────────────────
import Aws from "~icons/logos/aws";
import Azure from "~icons/logos/microsoft-azure";
import Gcp from "~icons/logos/google-cloud";

// ── Observability ────────────────────────────────────────────────────────────
import Prometheus from "~icons/logos/prometheus";
import Grafana from "~icons/logos/grafana";
import OpenTelemetry from "~icons/logos/opentelemetry-icon";
import Elasticsearch from "~icons/logos/elasticsearch";
import Logstash from "~icons/logos/logstash";
import Kibana from "~icons/logos/kibana";
import OpenSearch from "~icons/logos/opensearch-icon";
import InfluxDb from "~icons/logos/influxdb-icon";
import VectorDev from "~icons/logos/vector";
import Datadog from "~icons/logos/datadog-icon";
import Sentry from "~icons/logos/sentry-icon";

// ── Languages & frameworks ───────────────────────────────────────────────────
import Java from "~icons/logos/java";
import Python from "~icons/logos/python";
import Rust from "~icons/logos/rust";
import Go from "~icons/logos/gopher";
import NodeJs from "~icons/logos/nodejs-icon";
import DotNet from "~icons/logos/dotnet";
import FastApi from "~icons/logos/fastapi-icon";
import TypeScript from "~icons/logos/typescript-icon";
import React from "~icons/logos/react";
import VueJs from "~icons/logos/vue";
import GraphQl from "~icons/logos/graphql";

// ── Delivery, identity & process ─────────────────────────────────────────────
import GitHub from "~icons/logos/github-icon";
import GitLab from "~icons/logos/gitlab-icon";
import Jira from "~icons/logos/jira";
import Slack from "~icons/logos/slack-icon";
import PagerDuty from "~icons/logos/pagerduty-icon";
import Opsgenie from "~icons/logos/opsgenie";
import Okta from "~icons/logos/okta-icon";
import OsQuery from "~icons/logos/osquery";
import GoogleWorkspace from "~icons/logos/google-icon";

// ── Operating systems ────────────────────────────────────────────────────────
import MacOs from "~icons/logos/apple";
import Windows from "~icons/logos/microsoft-windows-icon";
import Curl from "~icons/logos/curl";

// ── Repo assets: services `logos` has no entry for ───────────────────────────
// These are the same files the Ingestion pages render.
import oracleUrl from "@/assets/images/ingestion/oracle.svg";
import sqlserverUrl from "@/assets/images/ingestion/sqlserver.png";
import zookeeperUrl from "@/assets/images/ingestion/zookeeper.png";
import databricksUrl from "@/assets/images/ingestion/databricks.svg";
import iisUrl from "@/assets/images/ingestion/microsoft-iis.svg";
import airbyteUrl from "@/assets/images/ingestion/airbyte.svg";
import fluentdUrl from "@/assets/images/ingestion/fluentd_icon.svg";
import fluentbitUrl from "@/assets/images/ingestion/fluentbit_icon.png";
import telegrafUrl from "@/assets/images/ingestion/telegraf.png";
import falcoUrl from "@/assets/images/ingestion/falco.png";
import jumpcloudUrl from "@/assets/images/ingestion/jumpcloud.svg";
import openvpnUrl from "@/assets/images/ingestion/openvpn.png";
import office365Url from "@/assets/images/ingestion/office-365.png";
import criblUrl from "@/assets/images/ingestion/cribl.webp";
import syslogUrl from "@/assets/images/ingestion/syslog.svg";
import netflowUrl from "@/assets/images/ingestion/netflow.svg";
import kinesisUrl from "@/assets/images/ingestion/kinesis_firehose.svg";
import cloudwatchUrl from "@/assets/images/ingestion/cloud_watch.svg";
import filebeatUrl from "@/assets/images/ingestion/filebeat.png";
import loongcollectorUrl from "@/assets/images/ingestion/loongcollector.svg";
import categrafUrl from "@/assets/images/ingestion/categraf.png";
import nightingaleUrl from "@/assets/images/ingestion/nightingale.svg";
import vmagentUrl from "@/assets/images/ingestion/vmagent.svg";

/** Prefix marking a stored icon value as a registry glyph rather than an emoji. */
export const GLYPH_TOKEN_PREFIX = "o2:";

/** An inline SVG component, or a URL to an image asset. */
export type GlyphValue = Component | string;

export const GLYPH_REGISTRY = {
  // Databases & storage
  postgresql: Postgresql,
  mysql: Mysql,
  mariadb: MariaDb,
  mongodb: Mongodb,
  redis: Redis,
  oracle: oracleUrl,
  snowflake: Snowflake,
  cassandra: Cassandra,
  dynamodb: DynamoDb,
  aerospike: Aerospike,
  couchdb: CouchDb,
  sqlite: Sqlite,
  saphana: Sap,
  sqlserver: sqlserverUrl,
  zookeeper: zookeeperUrl,
  databricks: databricksUrl,

  // Message queues & streaming
  kafka: Kafka,
  rabbitmq: RabbitMq,
  nats: Nats,
  spark: Spark,

  // Servers & networking
  nginx: Nginx,
  apache: ApacheHttp,
  cloudflare: Cloudflare,
  iis: iisUrl,
  syslog: syslogUrl,
  netflow: netflowUrl,
  openvpn: openvpnUrl,

  // Orchestration & DevOps
  kubernetes: Kubernetes,
  docker: Docker,
  helm: Helm,
  argo: Argo,
  terraform: Terraform,
  ansible: Ansible,
  jenkins: Jenkins,
  githubactions: GitHubActions,
  vercel: Vercel,
  heroku: Heroku,
  airflow: Airflow,
  airbyte: airbyteUrl,
  vault: Vault,
  consul: Consul,
  linux: Linux,

  // Cloud providers
  aws: Aws,
  azure: Azure,
  gcp: Gcp,
  cloudwatch: cloudwatchUrl,
  kinesis: kinesisUrl,

  // Observability
  prometheus: Prometheus,
  grafana: Grafana,
  opentelemetry: OpenTelemetry,
  elasticsearch: Elasticsearch,
  logstash: Logstash,
  kibana: Kibana,
  opensearch: OpenSearch,
  influxdb: InfluxDb,
  vector: VectorDev,
  datadog: Datadog,
  sentry: Sentry,
  fluentd: fluentdUrl,
  fluentbit: fluentbitUrl,
  telegraf: telegrafUrl,
  cribl: criblUrl,
  filebeat: filebeatUrl,
  loongcollector: loongcollectorUrl,
  categraf: categrafUrl,
  nightingale: nightingaleUrl,
  vmagent: vmagentUrl,

  // Languages & frameworks
  java: Java,
  python: Python,
  rust: Rust,
  go: Go,
  nodejs: NodeJs,
  dotnet: DotNet,
  fastapi: FastApi,
  typescript: TypeScript,
  react: React,
  vue: VueJs,
  graphql: GraphQl,

  // Delivery, identity & process
  github: GitHub,
  gitlab: GitLab,
  jira: Jira,
  slack: Slack,
  pagerduty: PagerDuty,
  opsgenie: Opsgenie,
  okta: Okta,
  osquery: OsQuery,
  falco: falcoUrl,
  jumpcloud: jumpcloudUrl,
  googleworkspace: GoogleWorkspace,
  office365: office365Url,

  // Operating systems & transports (linux sits under Orchestration above)
  macos: MacOs,
  windows: Windows,
  curl: Curl,
} as const satisfies Record<string, GlyphValue>;

// ─────────────────────────────────────────────────────────────────────────────
// AI INTEGRATION LOGOS — from the AI Integrations pages' own assets
// (generated/<slug>/logo.*, synced from o2-datasource), so no extra bundle cost.
// Kept out of GLYPH_REGISTRY because that sync regenerates the slugs (named
// imports would break on a rename) and "databricks" exists in both spaces.
// ─────────────────────────────────────────────────────────────────────────────

/** Prefix distinguishing an AI-integration logo from a curated service glyph. */
export const AI_GLYPH_PREFIX = "o2:ai-";

// Only `logo.*` — the `logo_dark` variants are handled by --color-glyph-plate.
const aiLogoModules = import.meta.glob(
  "@/assets/ai-datasource-content/generated/*/logo.{svg,png,webp,jpg,jpeg}",
  { query: "?url", import: "default", eager: true },
) as Record<string, string>;

const AI_LOGO_URLS: Record<string, string> = {};
for (const [path, url] of Object.entries(aiLogoModules)) {
  // .../generated/<slug>/logo.svg -> the second-to-last segment is the slug.
  const slug = path.split("/").at(-2);
  if (slug) AI_LOGO_URLS[slug] = url;
}

/**
 * One entry per BRAND, not per SDK (anthropic-jsts folds into `anthropic`).
 * Measure new logos by hand — OGlyph.spec's wordmark guard reads a viewBox, so
 * it can't see these <img> glyphs; `restate` (3.25:1) was cut for smearing.
 */
export const AI_GLYPH_SLUGS = [
  "agno",
  "amazon-bedrock",
  "anannas",
  "anthropic",
  "autogen",
  "beeai",
  "byteplus",
  "cerebras",
  "claude-code",
  "codename-goose",
  "codex",
  "cognee",
  "cohere",
  "cometapi",
  "crewai",
  "cursor",
  "deepagents",
  "deepseek",
  "dspy",
  "exa",
  "firecrawl",
  "fireworks",
  "flowise",
  "gemini",
  "github-copilot",
  "google-adk",
  "gradio",
  "groq",
  "haystack",
  "huggingface",
  "instructor",
  "kong-gateway",
  "koog",
  "langchain",
  "langflow",
  "langgraph",
  "langserve",
  "librechat",
  "litellm",
  "livekit",
  "llamaindex",
  "lobechat",
  "mastra",
  "mcp-use",
  "microsoft-agent-framework",
  "milvus",
  "mirascope",
  "mistral",
  "mixpanel",
  "n8n",
  "novita",
  "ollama",
  "openai",
  "opencode",
  "openrouter",
  "openwebui",
  "parallel",
  "pipecat",
  "portkey",
  "posthog",
  "promptfoo",
  "pydantic-ai",
  "quarkus-langchain4j",
  "ragas",
  "semantic-kernel",
  "smolagents",
  "spring-ai",
  "strands-agents",
  "swiftide",
  "temporal",
  "together-ai",
  "trubrics",
  "vapi",
  "vercel-ai-sdk",
  "vllm",
  "voltagent",
  "xai-grok",
  "zapier",
] as const;

/** Build the stored token for an AI logo, e.g. "o2:ai-anthropic". */
export function aiGlyphToken(slug: (typeof AI_GLYPH_SLUGS)[number]): string {
  return `${AI_GLYPH_PREFIX}${slug}`;
}

/** True when the token names an AI-integration logo. */
export function isAiGlyphToken(token: string | null | undefined): boolean {
  return !!token?.startsWith(AI_GLYPH_PREFIX);
}

/** Closed union of registered glyph names — an unknown name is a type error. */
export type GlyphName = keyof typeof GLYPH_REGISTRY;

/** Build the stored token for a glyph, e.g. `glyphToken("redis") === "o2:redis"`. */
export function glyphToken(name: GlyphName): string {
  return `${GLYPH_TOKEN_PREFIX}${name}`;
}

/** The glyph for an icon token, or null when it isn't a known glyph. */
export function resolveGlyph(token: string | null | undefined): GlyphValue | null {
  // Checked before the curated set: "o2:ai-anthropic" also starts with "o2:",
  // and the two namespaces share slugs (databricks).
  if (isAiGlyphToken(token)) {
    return AI_LOGO_URLS[token!.slice(AI_GLYPH_PREFIX.length)] ?? null;
  }
  if (!token?.startsWith(GLYPH_TOKEN_PREFIX)) return null;
  const name = token.slice(GLYPH_TOKEN_PREFIX.length);
  return (GLYPH_REGISTRY as Record<string, GlyphValue>)[name] ?? null;
}

/** True when the token names a registry glyph (known or not) rather than an emoji. */
export function isGlyphToken(token: string | null | undefined): boolean {
  return !!token?.startsWith(GLYPH_TOKEN_PREFIX);
}

/** True when a resolved glyph is an image URL rather than an inline component. */
export function isImageGlyph(glyph: GlyphValue | null): glyph is string {
  return typeof glyph === "string";
}
