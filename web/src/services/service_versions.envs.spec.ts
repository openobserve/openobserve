import { describe, expect, it } from "vitest";
import {
  envListText,
  envSet,
  inEnv,
  NO_ENV,
  otherEnvs,
  scopesInEnv,
} from "./service_versions.envs";
import { catalogMatches, chipEnv } from "@/plugins/traces/servicesCatalogVersions";
import type { Scope } from "./service_versions";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";

const scope = (env: string, envs?: string[]) => ({ env, envs });

describe("scope env set", () => {
  it("reads the set, else the one env, else nothing", () => {
    expect(envSet(scope("prod", ["prod", "staging"]))).toEqual(["prod", "staging"]);
    expect(envSet(scope("prod"))).toEqual(["prod"]);
    expect(envSet(scope("prod", []))).toEqual(["prod"]);
    expect(envSet(scope(""))).toEqual([]);
  });
  it("matches any env in the set", () => {
    expect(inEnv(scope("prod", ["prod", "staging"]), "staging")).toBe(true);
    expect(inEnv(scope("prod"), "staging")).toBe(false);
  });
  it("lists the envs other than the pinned one", () => {
    expect(otherEnvs(scope("prod", ["prod", "staging", "dev"]))).toEqual(["staging", "dev"]);
    expect(otherEnvs(scope("prod"))).toEqual([]);
  });
  it("reads the set a real producer sends on its scopes and version rows", () => {
    for (const row of [producer.two_env.services.services[0], producer.two_env.version]) {
      expect(envSet(row)).toEqual(["prod", "staging"]);
      expect(otherEnvs(row)).toEqual(["staging"]);
      expect(inEnv(row, "staging")).toBe(true);
      expect(inEnv(row, "dev")).toBe(false);
    }
  });
  it("prefers scopes pinned to the env over scopes only also seen in it", () => {
    const seen = scope("prod", ["prod", "staging"]);
    const pinned = scope("staging", ["staging"]);
    expect(scopesInEnv([seen, pinned], "staging")).toEqual([pinned]);
    expect(scopesInEnv([seen], "staging")).toEqual([seen]);
    expect(scopesInEnv([seen], "dev")).toEqual([]);
  });
});

describe("env list text", () => {
  const more = (count: number) => `${count} more`;
  const envs = (count: number) => Array.from({ length: count }, (_, index) => `env${index + 1}`);
  it("names a single env as is", () => {
    expect(envListText(envs(1), "en", more)).toBe("env1");
  });
  it("names three envs with the locale's conjunction", () => {
    expect(envListText(envs(3), "en", more)).toBe("env1, env2, and env3");
  });
  it("names three of ten envs and counts the other seven", () => {
    expect(envListText(envs(10), "en", more)).toBe("env1, env2, env3, and 7 more");
  });
  it("joins in the active locale", () => {
    expect(envListText(envs(2), "de", more)).toBe("env1 und env2");
  });
});

describe("No env membership as the backend counts it", () => {
  it("puts a scope pinned to prod but also seen without an env under No env, not under default", () => {
    const seen = { env: "prod", envs: ["prod", "default"], no_env: false };
    expect(inEnv(seen, NO_ENV)).toBe(true);
    expect(inEnv(seen, "prod")).toBe(true);
    expect(inEnv(seen, "default")).toBe(false);
    expect(inEnv({ ...seen, envs: ["prod", " Unknown "] }, NO_ENV)).toBe(true);
    expect(inEnv({ ...seen, envs: ["prod", "none"] }, NO_ENV)).toBe(true);
    expect(chipEnv({ ...seen } as Scope, NO_ENV)).toBe("prod");
    expect(catalogMatches({ versionScope: seen as Scope }, NO_ENV, "", "ready", false)).toBe(true);
  });
  it("reads the pinned env by its own flag, so an explicit default is a real env", () => {
    const explicit = { env: "default", envs: ["default"], no_env: false };
    expect(inEnv(explicit, "default")).toBe(true);
    expect(inEnv(explicit, NO_ENV)).toBe(false);
    const absent = { env: "default", envs: ["default", "prod"], no_env: true };
    expect(inEnv(absent, NO_ENV)).toBe(true);
    expect(inEnv(absent, "default")).toBe(false);
    expect(inEnv(absent, "prod")).toBe(true);
  });
  it("keeps a scope seen only in real envs out of No env", () => {
    expect(inEnv({ env: "prod", envs: ["prod", "staging"], no_env: false }, NO_ENV)).toBe(false);
    expect(inEnv({ env: "prod" }, NO_ENV)).toBe(false);
  });
});
