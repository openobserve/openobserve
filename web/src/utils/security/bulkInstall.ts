// Copyright 2026 OpenObserve Inc.

// Installs catalog rules in one go through the same compile and builder as the new-detection dialog.
import type {
  CatalogRule,
  SigmaCompileRequest,
  SigmaCompileResponse,
  UnseenField,
} from "@/services/securitySigma";
import { raw, type I18nText } from "@/types/i18n";

import { blockedReason } from "./compileText";
import { buildDetectionAlert } from "./detection";

export interface BulkTarget {
  rule: CatalogRule;
  stream: string;
  sourceType: string;
  fields: string[];
  fieldTypes: Record<string, string>;
}

export interface BulkSettings {
  period: number;
  frequency: number;
  silence: number;
  destinations: string[];
  folderId: string;
}

export type BulkStatus = "installed" | "skipped" | "failed";

export interface BulkResult {
  key: string;
  title: string;
  stream: string;
  status: BulkStatus;
  name: string;
  reason: I18nText;
}

export interface StreamColumns {
  fields: string[];
  fieldTypes: Record<string, string>;
}

export interface BulkDeps {
  /** The stream's current schema; a compile without its types cannot pick a column's comparison. */
  loadSchema?: (stream: string) => Promise<StreamColumns>;
  compile: (body: SigmaCompileRequest) => Promise<SigmaCompileResponse>;
  /** Null when the SQL plans, else the engine's reason. */
  validate: (sql: string) => Promise<string | null>;
  /** Creates documented columns the stream has not shown yet, so the rule's SQL can plan. */
  addColumns?: (stream: string, fields: UnseenField[]) => Promise<void>;
  create: (payload: Record<string, any>, folderId: string) => Promise<void>;
  /** Names already taken in the org; a detection never reuses one. */
  takenNames: Set<string>;
  failureReason: (error: unknown) => I18nText;
  messages: { duplicate: (name: string) => I18nText; correlationBlocked: I18nText };
  concurrency?: number;
}

/** One (rule, stream) pair: compile on the server, build as the dialog does, check the SQL, then save. */
async function installOne(
  target: BulkTarget,
  settings: BulkSettings,
  deps: BulkDeps,
  schemaOf: (stream: string) => Promise<StreamColumns | null>,
): Promise<BulkResult> {
  const base = {
    key: target.rule.key,
    title: target.rule.title,
    stream: target.stream,
    name: "",
  };
  try {
    const schema = await schemaOf(target.stream);
    const res = await deps.compile({
      rule_id: target.rule.key,
      source_type: target.sourceType || undefined,
      stream: target.stream,
      fields: schema?.fields.length ? schema.fields : target.fields,
      field_types: { ...target.fieldTypes, ...schema?.fieldTypes },
    });
    const compiled = res.compiled;
    if (!compiled?.runnable) {
      return {
        ...base,
        status: "failed",
        reason: compiled ? blockedReason(compiled) : raw(res.parseError ?? ""),
      };
    }
    const correlation = res.correlation;
    if (target.rule.correlation && !correlation?.runnable) {
      return {
        ...base,
        status: "failed",
        reason: correlation?.reason ? raw(correlation.reason) : deps.messages.correlationBlocked,
      };
    }
    const payload = buildDetectionAlert({
      rule: res.rule ?? target.rule,
      where: compiled.where,
      fields: compiled.fields,
      stream: target.stream,
      destinations: settings.destinations,
      sourceType: target.sourceType,
      period: settings.period,
      frequency: settings.frequency,
      silence: settings.silence,
      correlation: correlation ?? undefined,
      sql: compiled.sql,
    });
    const name = String(payload.name);
    // Claimed before the save so two targets in one batch can never race for a name.
    if (deps.takenNames.has(name)) {
      return { ...base, name, status: "skipped", reason: deps.messages.duplicate(name) };
    }
    deps.takenNames.add(name);
    const unseen = compiled.unseenFields ?? [];
    if (unseen.length && deps.addColumns) await deps.addColumns(target.stream, unseen);
    const failure = await deps.validate(payload.query_condition.sql);
    if (failure) {
      deps.takenNames.delete(name);
      return { ...base, name, status: "failed", reason: raw(failure) };
    }
    try {
      await deps.create(payload, settings.folderId);
    } catch (e) {
      deps.takenNames.delete(name);
      throw e;
    }
    return { ...base, name, status: "installed", reason: raw("") };
  } catch (e) {
    return { ...base, status: "failed", reason: deps.failureReason(e) };
  }
}

/** Results come back in target order, whatever order the saves finish in. */
export async function runBulkInstall(
  targets: BulkTarget[],
  settings: BulkSettings,
  deps: BulkDeps,
  onResult?: (result: BulkResult, index: number) => void,
): Promise<BulkResult[]> {
  const results: BulkResult[] = new Array(targets.length);
  const schemas = new Map<string, Promise<StreamColumns | null>>();
  // One load per stream for the whole batch; a failed load falls back to the page's copy.
  const schemaOf = (stream: string) => {
    if (!deps.loadSchema) return Promise.resolve(null);
    let pending = schemas.get(stream);
    if (!pending) {
      pending = deps.loadSchema(stream).catch(() => null);
      schemas.set(stream, pending);
    }
    return pending;
  };
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const i = next++;
      results[i] = await installOne(targets[i], settings, deps, schemaOf);
      onResult?.(results[i], i);
    }
  };
  const lanes = Math.max(1, Math.min(deps.concurrency ?? 4, targets.length));
  await Promise.all(Array.from({ length: lanes }, worker));
  return results;
}
