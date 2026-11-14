// Copyright 2026 OpenObserve Inc.
//
// Validation for SecurityOpenCaseDialog.vue, with the server's limits.

import { z } from "zod";

import type { CaseEntityKind } from "@/services/securityCases";
import type { NormalizedEvent } from "@/utils/security/ocsf";

type Translate = (key: string, named?: Record<string, unknown>) => string;

export const CASE_PRIORITIES = ["P1", "P2", "P3", "P4"] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

/** Mirrors the server's limits on a case title, its entities and the opening note. */
export const MAX_TITLE_CHARS = 255;
export const MAX_NOTE_CHARS = 4000;
export const MAX_ENTITIES = 10;

export interface CaseEntityOption {
  kind: CaseEntityKind;
  value: string;
}

/** A stable form value for one entity checkbox. */
export const entityKey = (e: CaseEntityOption) => `${e.kind}:${e.value}`;

export function parseEntityKey(key: string): CaseEntityOption | null {
  const at = key.indexOf(":");
  if (at < 1) return null;
  const kind = key.slice(0, at) as CaseEntityKind;
  if (!["user", "host", "ip"].includes(kind)) return null;
  return { kind, value: key.slice(at + 1) };
}

/** The event's user, host and addresses; host first, since cases key on the host before the user. */
export function eventEntities(n: NormalizedEvent): CaseEntityOption[] {
  const out: CaseEntityOption[] = [];
  const push = (kind: CaseEntityKind, value: string) => {
    const v = value.trim();
    if (v && v !== "-" && !out.some((e) => e.kind === kind && e.value === v)) {
      out.push({ kind, value: v });
    }
  };
  // A column holding several values lists them comma-separated; each address is its own entity.
  const each = (kind: CaseEntityKind, value: string) =>
    value.split(/,\s*/).forEach((v) => push(kind, v));
  each("host", n.host);
  push("user", n.actor);
  each("ip", n.srcIp);
  each("ip", n.dstIp);
  return out.slice(0, MAX_ENTITIES);
}

/** "<event type> on <entity>", the way a detection's case is titled. */
export function eventCaseTitle(eventType: string, entities: CaseEntityOption[]): string {
  const subject = entities.find((e) => e.kind !== "ip") ?? entities[0];
  const title = subject ? `${eventType} on ${subject.value}` : eventType;
  return title.slice(0, MAX_TITLE_CHARS);
}

/** The form value of "open a new case" beside the existing cases an event can join. */
export const NEW_CASE = "new";

export const makeOpenCaseSchema = (t: Translate) =>
  z.object({
    target: z.string().min(1),
    title: z
      .string()
      .trim()
      .min(1, t("siem.drawer.openCaseDialog.titleRequired"))
      .max(MAX_TITLE_CHARS, t("siem.drawer.openCaseDialog.titleTooLong", { max: MAX_TITLE_CHARS })),
    priority: z.enum(CASE_PRIORITIES),
    entities: z.array(z.string()).max(MAX_ENTITIES),
    note: z
      .string()
      .max(MAX_NOTE_CHARS, t("siem.drawer.openCaseDialog.noteTooLong", { max: MAX_NOTE_CHARS })),
  });

export type OpenCaseValues = {
  /** `NEW_CASE`, or the id of an open case on the same entity to add the event to. */
  target: string;
  title: string;
  priority: CasePriority;
  entities: string[];
  note: string;
};
