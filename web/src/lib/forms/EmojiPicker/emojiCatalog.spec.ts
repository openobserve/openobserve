// Copyright 2026 OpenObserve Inc.
//
// Structural guards for the catalog. Both rules below fail silently in the UI —
// a repeated emoji just looks like a rendering glitch, and a shared keyword
// resolves to whichever group sorts first — so they are asserted here rather
// than left to review.

import { describe, it, expect } from "vitest";
import { EMOJI_GROUPS, ALL_EMOJIS } from "./emojiCatalog";
import { GLYPH_REGISTRY, GLYPH_TOKEN_PREFIX, resolveGlyph } from "./glyphRegistry";

describe("emojiCatalog", () => {
  it("should never repeat an emoji, which would render a duplicate grid cell", () => {
    const seen = new Map<string, string[]>();
    for (const group of EMOJI_GROUPS) {
      for (const option of group.emojis) {
        seen.set(option.token, [...(seen.get(option.token) ?? []), group.id]);
      }
    }
    const repeated = [...seen.entries()].filter(([, groups]) => groups.length > 1);
    expect(repeated).toEqual([]);
  });

  it("should give every keyword exactly one owner, so suggestions never depend on order", () => {
    const owners = new Map<string, string[]>();
    for (const option of ALL_EMOJIS) {
      for (const keyword of option.keywords) {
        owners.set(keyword, [...(owners.get(keyword) ?? []), option.token]);
      }
    }
    const shared = [...owners.entries()].filter(([, emojis]) => emojis.length > 1);
    expect(shared).toEqual([]);
  });

  it("should use lowercase keywords with no whitespace, as the matcher assumes", () => {
    for (const option of ALL_EMOJIS) {
      for (const keyword of option.keywords) {
        expect(keyword).toBe(keyword.toLowerCase());
        expect(keyword).not.toMatch(/\s/);
        expect(keyword.length).toBeGreaterThan(0);
      }
    }
  });

  it("should give every group a unique id and at least one emoji", () => {
    const ids = EMOJI_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of EMOJI_GROUPS) {
      expect(group.emojis.length).toBeGreaterThan(0);
    }
  });

  it("should not reuse the reserved 'results' id, which the search view injects", () => {
    expect(EMOJI_GROUPS.map((group) => group.id)).not.toContain("results");
  });

  // The registry and the catalog are edited separately, so they drift silently:
  // a glyph with no catalog entry ships bytes nobody can pick, and a catalog
  // token with no glyph renders as a blank cell. Both directions are checked.
  it("should offer every registered glyph in the picker", () => {
    const offered = new Set(ALL_EMOJIS.map((option) => option.token));
    const unreachable = Object.keys(GLYPH_REGISTRY).filter(
      (name) => !offered.has(`${GLYPH_TOKEN_PREFIX}${name}`),
    );
    expect(unreachable).toEqual([]);
  });

  it("should resolve every glyph token the catalog offers", () => {
    const broken = ALL_EMOJIS.map((option) => option.token)
      .filter((token) => token.startsWith(GLYPH_TOKEN_PREFIX))
      .filter((token) => resolveGlyph(token) === null);
    expect(broken).toEqual([]);
  });

  // Every data source the Ingestion pages list should be pickable as a folder
  // icon, so a "Postgres" folder can carry the same logo the integration tile
  // shows. Adding a source to those pages without one fails here.
  it("should cover every service on the integrations pages", () => {
    const INGESTION_SERVICES = [
      "sqlserver",
      "postgresql",
      "mongodb",
      "redis",
      "mysql",
      "oracle",
      "snowflake",
      "zookeeper",
      "cassandra",
      "aerospike",
      "dynamodb",
      "databricks",
      "couchdb",
      "elasticsearch",
      "kafka",
      "rabbitmq",
      "nats",
      "nginx",
      "apache",
      "iis",
      "kubernetes",
      "linux",
      "githubactions",
      "jenkins",
      "ansible",
      "terraform",
      "vercel",
      "heroku",
      "airflow",
      "airbyte",
      "prometheus",
      "opentelemetry",
      "fluentd",
      "fluentbit",
      "telegraf",
      "vector",
      "syslog",
      "netflow",
      "okta",
      "falco",
      "osquery",
      "jumpcloud",
      "openvpn",
      "office365",
      "googleworkspace",
      "cribl",
      "java",
      "python",
      "rust",
      "go",
      "nodejs",
      "dotnet",
      "fastapi",
      "saphana",
      "aws",
      "azure",
      "gcp",
      "cloudwatch",
      "kinesis",
    ];
    const missing = INGESTION_SERVICES.filter(
      (name) => resolveGlyph(`${GLYPH_TOKEN_PREFIX}${name}`) === null,
    );
    expect(missing).toEqual([]);
  });
});
