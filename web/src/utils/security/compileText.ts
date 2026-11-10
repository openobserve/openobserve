// Copyright 2026 OpenObserve Inc.

// A compile result from the Sigma API, in one line for the UI.
import type { CompiledSigma } from "@/services/securitySigma";
import { gt, raw, type I18nText } from "@/types/i18n";

/** Why a rule cannot run here, or empty when it can. */
export function blockedReason(compiled: CompiledSigma): I18nText {
  if (compiled.error) return raw(compiled.error);
  if (!compiled.runnable && compiled.reason?.trim()) return raw(compiled.reason);
  if (compiled.unsupported.length) {
    return gt("siem.sigma.notSupported", { fields: compiled.unsupported.join(", ") });
  }
  if (compiled.runnable) return raw("");
  if (compiled.assumedAbsent.length) {
    return gt("siem.sigma.cannotMatch", { fields: compiled.assumedAbsent.join(", ") });
  }
  return gt("siem.sigma.compiledEmpty");
}

/** What a runnable rule assumed absent to run, or empty: a caveat, not a refusal. */
export function caveat(compiled: CompiledSigma): I18nText {
  if (!compiled.runnable || !compiled.assumedAbsent.length) return raw("");
  return gt("siem.sigma.assumedAbsent", { fields: compiled.assumedAbsent.join(", ") });
}
