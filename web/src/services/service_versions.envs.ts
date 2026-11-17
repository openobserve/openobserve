import type { Environment } from "@/services/service_versions";

type EnvSet = Pick<Environment, "env" | "envs" | "no_env">;

// The Env filter's No env pick; the colon cannot appear in an env label, so no real env collides with it.
export const NO_ENV = ":no_env";

const INFERRED_SOURCES = ["namespace", "cluster", "workload", "cluster_name", "namespace_name"];
// The texts the backend reads as "no env reported" (is_no_env_literal).
const NO_ENV_LITERALS = ["default", "none", "unknown"];

/** Every env a scope was seen in, its pinned env first. */
export function envSet(scope: EnvSet): string[] {
  if (scope.envs?.length) return scope.envs;
  return scope.env ? [scope.env] : [];
}

/** True when the env was read from a namespace, cluster or workload name rather than sent or set. */
export function isInferredSource(source: string | undefined) {
  return INFERRED_SOURCES.includes(source || "");
}

/** The memberships the backend filters and counts a scope by, null for No env (label_env_entries). */
export function envEntries(scope: EnvSet): (string | null)[] {
  const envs = scope.envs?.length ? scope.envs : [scope.env ?? ""];
  // Only the pinned env carries its own flag; an override of a literal "default" stays a real env.
  const absent = (env: string) =>
    env === scope.env ? Boolean(scope.no_env) : NO_ENV_LITERALS.includes(env.trim().toLowerCase());
  return [...new Set(envs.map((env) => (absent(env) ? null : env)))];
}

export function inEnv(scope: EnvSet, env: string) {
  return envEntries(scope).includes(env === NO_ENV ? null : env);
}

/** The envs a scope was seen in besides the one its chip shows. */
export function otherEnvs(scope: EnvSet) {
  return envSet(scope).filter((env) => env !== scope.env);
}

/** Scopes pinned to the env, else the scopes that were also seen in it. */
export function scopesInEnv<T extends EnvSet>(scopes: T[], env: string): T[] {
  const pinned = scopes.filter((scope) => scope.env === env && !scope.no_env);
  return pinned.length ? pinned : scopes.filter((scope) => inEnv(scope, env));
}

const SHOWN_ENVS = 3;

/** Joins envs for the active locale, naming at most three and counting the rest. */
export function envListText(envs: string[], locale: string, more: (count: number) => string) {
  const shown = envs.length > SHOWN_ENVS ? envs.slice(0, SHOWN_ENVS) : envs;
  const rest = envs.length - shown.length;
  return new Intl.ListFormat(locale || "en", { type: "conjunction" }).format(
    rest ? [...shown, more(rest)] : shown,
  );
}
