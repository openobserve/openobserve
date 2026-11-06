// Copyright 2026 OpenObserve Inc.

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { iconRegistry } from "@/lib/core/Icon/OIcon.icons";
import type { EmojiGroup, EmojiOption } from "./OEmojiPicker.types";
import { ALL_EMOJIS } from "./emojiCatalog";
import { GLYPH_TOKEN_PREFIX } from "./glyphRegistry";
import {
  MONO_LOGO_REGISTRY,
  isMonoLogoToken,
  monoLogoToken,
  resolveMonoLogo,
  type MonoLogoName,
} from "./monoLogoRegistry";

/** Prefix marking a stored icon value as a flat OIcon registry icon. */
export const FLAT_ICON_PREFIX = "icon:";

/** Curated OIcon names offered as flat folder icons, with search keywords (unique within this list). */
export const FLAT_ICONS: readonly { name: IconName; keywords: readonly string[] }[] = [
  { name: "folder-outline", keywords: ["folder", "folders", "directory", "general"] },
  { name: "dashboard", keywords: ["dashboard", "dashboards", "board", "overview"] },
  { name: "bar-chart", keywords: ["chart", "charts", "bar", "report"] },
  { name: "show-chart", keywords: ["line", "graph", "timeseries", "trend"] },
  { name: "analytics", keywords: ["analytics", "stats", "statistics"] },
  { name: "insights", keywords: ["insights", "sparkle", "findings"] },
  { name: "query-stats", keywords: ["query", "queries", "search", "explore"] },
  { name: "monitor-heart", keywords: ["health", "healthcheck", "uptime", "heartbeat"] },
  { name: "speed", keywords: ["performance", "perf", "speed", "latency"] },
  { name: "timeline", keywords: ["timeline", "traces", "trace", "spans"] },
  { name: "trending-up", keywords: ["growth", "increase", "trending", "kpi"] },
  { name: "data-usage", keywords: ["usage", "quota", "capacity", "utilization"] },
  { name: "database", keywords: ["database", "db", "sql", "postgres", "mysql"] },
  { name: "storage", keywords: ["storage", "disk", "volume", "s3"] },
  { name: "dataset", keywords: ["dataset", "datasets", "table", "tables"] },
  { name: "dns", keywords: ["server", "servers", "host", "hosts", "rack", "dns"] },
  { name: "memory", keywords: ["memory", "cpu", "hardware", "chip", "gpu"] },
  { name: "cloud", keywords: ["cloud", "saas", "hosted"] },
  { name: "cloud-sync", keywords: ["sync", "replication", "mirror"] },
  { name: "backup", keywords: ["backup", "backups", "snapshot", "restore"] },
  { name: "lan", keywords: ["network", "networking", "lan", "topology"] },
  { name: "router", keywords: ["router", "gateway", "edge", "ingress"] },
  { name: "hub", keywords: ["hub", "mesh", "microservices", "services"] },
  { name: "public", keywords: ["globe", "global", "world", "region", "regions", "internet"] },
  { name: "language", keywords: ["web", "website", "http", "domain"] },
  { name: "api", keywords: ["api", "apis", "rest", "endpoint", "endpoints"] },
  { name: "webhook", keywords: ["webhook", "webhooks", "callback"] },
  { name: "code", keywords: ["code", "dev", "development", "engineering"] },
  { name: "data-object", keywords: ["json", "object", "schema", "payload"] },
  { name: "terminal", keywords: ["terminal", "shell", "cli", "console", "bash"] },
  { name: "deployed-code", keywords: ["container", "containers", "kubernetes", "pod", "k8s"] },
  { name: "bug-report", keywords: ["bug", "bugs", "debug", "defect", "issue"] },
  { name: "science", keywords: ["test", "tests", "testing", "experiment", "lab", "qa"] },
  { name: "build", keywords: ["build", "tools", "tooling", "maintenance", "wrench"] },
  { name: "settings", keywords: ["settings", "config", "configuration", "system"] },
  { name: "tune", keywords: ["tune", "tuning", "controls", "adjust"] },
  { name: "security", keywords: ["security", "secure", "protection", "siem"] },
  { name: "shield", keywords: ["shield", "guard", "firewall", "waf", "defense"] },
  { name: "verified-user", keywords: ["compliance", "verified", "audit", "trust"] },
  { name: "lock", keywords: ["lock", "locked", "private", "secret", "secrets"] },
  { name: "key", keywords: ["key", "keys", "credentials", "token", "tokens", "iam"] },
  { name: "admin-panel-settings", keywords: ["admin", "administration", "rbac", "roles"] },
  { name: "groups", keywords: ["team", "teams", "people", "squad"] },
  { name: "group", keywords: ["group", "users", "members"] },
  { name: "person", keywords: ["person", "personal", "user", "mine", "profile"] },
  { name: "support-agent", keywords: ["support", "helpdesk", "customer", "tickets"] },
  { name: "business", keywords: ["business", "company", "office"] },
  { name: "corporate-fare", keywords: ["org", "organization", "enterprise", "corporate"] },
  { name: "home", keywords: ["home", "main", "start"] },
  { name: "star", keywords: ["star", "starred", "favorite", "favorites", "important"] },
  { name: "favorite", keywords: ["heart", "love", "liked"] },
  { name: "bookmark", keywords: ["bookmark", "saved", "pinned"] },
  { name: "flag", keywords: ["flag", "flags", "milestone", "goal"] },
  { name: "label", keywords: ["label", "labels", "tag", "tags"] },
  { name: "bolt", keywords: ["bolt", "fast", "realtime", "power", "energy"] },
  {
    name: "rocket-launch",
    keywords: ["rocket", "launch", "prod", "production", "release", "deploy"],
  },
  { name: "local-fire-department", keywords: ["fire", "flame", "hot", "incident", "incidents"] },
  { name: "notifications", keywords: ["alert", "alerts", "bell", "notification", "notifications"] },
  { name: "warning", keywords: ["warning", "warn", "caution", "risk"] },
  { name: "error", keywords: ["error", "errors", "fail", "failure", "exception"] },
  { name: "emergency", keywords: ["emergency", "critical", "sev1", "urgent"] },
  { name: "schedule", keywords: ["schedule", "scheduled", "clock", "time", "cron"] },
  { name: "calendar-month", keywords: ["calendar", "daily", "weekly", "monthly"] },
  { name: "timer", keywords: ["timer", "duration", "sla", "timeout"] },
  { name: "history", keywords: ["history", "archive", "past", "versions"] },
  { name: "mail", keywords: ["mail", "email", "inbox", "smtp"] },
  { name: "chat", keywords: ["chat", "messages", "conversation"] },
  { name: "campaign", keywords: ["campaign", "marketing", "announcements"] },
  { name: "payments", keywords: ["payments", "payment", "billing", "card"] },
  { name: "attach-money", keywords: ["money", "cost", "costs", "finance", "revenue"] },
  { name: "receipt-long", keywords: ["receipt", "invoice", "invoices", "orders"] },
  { name: "shopping-cart", keywords: ["shopping", "cart", "checkout", "ecommerce", "store"] },
  { name: "inventory-2", keywords: ["inventory", "package", "packages", "warehouse"] },
  { name: "category", keywords: ["category", "categories", "misc", "other"] },
  {
    name: "extension",
    keywords: ["extension", "plugin", "plugins", "integration", "integrations"],
  },
  { name: "widgets", keywords: ["widgets", "components", "modules"] },
  { name: "layers", keywords: ["layers", "stack", "tiers", "platform"] },
  { name: "account-tree", keywords: ["tree", "hierarchy", "pipeline", "pipelines", "workflow"] },
  { name: "schema", keywords: ["diagram", "architecture", "flowchart"] },
  { name: "smart-toy", keywords: ["bot", "bots", "robot", "agent", "agents"] },
  { name: "psychology", keywords: ["ai", "ml", "llm", "model", "models", "brain"] },
  { name: "auto-awesome", keywords: ["magic", "auto", "automation", "generated"] },
  { name: "lightbulb", keywords: ["idea", "ideas", "tips", "proposal"] },
  { name: "menu-book", keywords: ["docs", "documentation", "runbook", "runbooks", "guide"] },
  { name: "description", keywords: ["document", "file", "files", "notes"] },
  { name: "article", keywords: ["logs", "log", "article", "text"] },
  { name: "checklist", keywords: ["checklist", "tasks", "todo"] },
  { name: "task-alt", keywords: ["done", "ok", "success", "complete", "passing"] },
  { name: "devices", keywords: ["devices", "device", "fleet"] },
  { name: "smartphone", keywords: ["mobile", "phone", "ios", "app", "apps"] },
  { name: "computer", keywords: ["computer", "desktop", "laptop", "workstation"] },
  { name: "palette", keywords: ["design", "ui", "ux", "theme", "frontend"] },
  { name: "target", keywords: ["target", "slo", "sli", "okr", "objectives"] },
  { name: "radar", keywords: ["radar", "monitoring", "monitor", "watch", "synthetics"] },
  { name: "troubleshoot", keywords: ["troubleshoot", "investigate", "rca", "diagnostics"] },
  { name: "pets", keywords: ["pets", "paw", "fun", "sandbox"] },
] as const;

/** Build the stored token for a flat icon, e.g. "icon:dashboard". */
export function flatIconToken(name: IconName): string {
  return `${FLAT_ICON_PREFIX}${name}`;
}

/** True when the token names a flat OIcon icon (known or not). */
export function isFlatIconToken(token: string | null | undefined): boolean {
  return !!token?.startsWith(FLAT_ICON_PREFIX);
}

/** The OIcon name for a flat token, or null when the registry has no such icon. */
export function resolveFlatIcon(token: string | null | undefined): IconName | null {
  if (!isFlatIconToken(token)) return null;
  const name = token!.slice(FLAT_ICON_PREFIX.length);
  return Object.hasOwn(iconRegistry, name) ? (name as IconName) : null;
}

/** True for an `icon:`/`mono:` token whose name no longer resolves, so callers can fall back. */
export function isUnresolvedFlatToken(token: string | null | undefined): boolean {
  if (isFlatIconToken(token)) return resolveFlatIcon(token) === null;
  if (isMonoLogoToken(token)) return resolveMonoLogo(token) === null;
  return false;
}

/** Mono logos reuse their colour glyph's keywords so both marks surface for the same search. */
function monoLogoOptions(): EmojiOption[] {
  return (Object.keys(MONO_LOGO_REGISTRY) as MonoLogoName[]).map((name) => {
    const colour = ALL_EMOJIS.find((option) => option.token === `${GLYPH_TOKEN_PREFIX}${name}`);
    return { token: monoLogoToken(name), keywords: colour?.keywords ?? [name] };
  });
}

/** The flat sections the picker shows ahead of the emoji catalog. */
export const FLAT_ICON_GROUPS: readonly EmojiGroup[] = [
  {
    id: "icons",
    labelKey: "components.emojiPicker.groups.icons",
    emojis: FLAT_ICONS.map(({ name, keywords }) => ({ token: flatIconToken(name), keywords })),
  },
  {
    id: "monoLogos",
    labelKey: "components.emojiPicker.groups.monoLogos",
    emojis: monoLogoOptions(),
  },
];
