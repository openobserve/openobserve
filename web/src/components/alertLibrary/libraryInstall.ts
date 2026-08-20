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

// One library file -> the body of `POST /api/v2/{org}/alerts?folder=…`.
//
// A library file is a real alert someone EXPORTED, so it arrives carrying that
// org's identity: its own alert id, its author's destinations, no folder and no
// timezone. Sending it as-is is a 400 at best and someone else's Slack channel
// at worst. Two jobs, in this order:
//
//   1. The same normalization ImportAlert does (`createAlert`, ImportAlert.vue)
//      — that is the only place in the app that has ever turned a stored alert
//      document back into a create, and divergence here is a bug by definition.
//   2. Three things only the library needs: the org's destination replaces the
//      author's, provenance is stamped so Phase 5 can recognise the alert
//      later, and the library's severity becomes the product's priority.
//
// Pure and file-in/payload-out, so the wizard stays markup and this stays
// tested — same split as libraryTunables.ts.

import { priorityForSeverity } from "@/constants/alertLibrary";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";
import {
  convertV0ToV2,
  convertV1BEToV2,
  convertV1ToV2,
  detectConditionsVersion,
} from "@/utils/alerts/alertDataTransforms";

/** The batch-shared pair the wizard's Tune step edits, for every alert at once. */
export interface InstallOverrides {
  /** Evaluation interval, minutes. */
  frequency?: number;
  /** Repeat-notification suppression, minutes. */
  silence?: number;
}

export interface InstallPayloadInput {
  entry: AlertLibraryEntry;
  /** The tuned file, straight from the drawer, or freshly fetched. */
  file: AlertLibraryFile;
  folderId: string;
  /** A destination NAME that exists in this org. */
  destination: string;
  /** Installing user's email — becomes owner and last editor. */
  owner: string;
  /** Org timezone, used only when the file carries none. */
  timezone: string;
  overrides?: InstallOverrides;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Why a file could not be turned into a payload. Resolved to copy by the caller. */
export type InstallPayloadErrorCode = "unreadable_conditions";

/**
 * A file this builder refuses to install.
 *
 * Carries a CODE rather than a message: this module is Vue-less and has no `t`,
 * so the wizard resolves it — the same split `AlertLibraryError` already uses.
 */
export class InstallPayloadError extends Error {
  readonly code: InstallPayloadErrorCode;

  constructor(code: InstallPayloadErrorCode) {
    super(code);
    this.name = "InstallPayloadError";
    this.code = code;
  }
}

/**
 * The conditions tree, in the `{version: 2, conditions}` envelope the backend
 * requires. Lifted from ImportAlert's `createAlert` — the library ships files
 * exported from any product version, so all three legacy shapes are reachable.
 *
 * Unlike ImportAlert, this REFUSES a shape it cannot read instead of falling
 * back. `detectConditionsVersion` answers 0 for anything unrecognised and
 * `convertV0ToV2` answers an empty group for a non-array, so a plausible
 * legacy envelope like `{version: 1, conditions: …}` would otherwise install
 * an alert whose filter matches EVERY row, reported as a success. ImportAlert
 * can live with that because a human picked the document; here it arrives from
 * a public bucket. A visible per-alert failure beats a silent always-firing
 * alert at 3am.
 */
const toV2Conditions = (input: unknown): { version: number; conditions: unknown } => {
  // An already-wrapped tree is unwrapped first so detection sees the tree
  // itself rather than the envelope, which detects as v0.
  const wrapper = asRecord(input);
  const unwrapped =
    wrapper.version === 2 || wrapper.version === "2" ? wrapper.conditions : (input as unknown);

  const version = detectConditionsVersion(unwrapped);

  if (version === 2) return { version: 2, conditions: unwrapped };

  if (version === 1) {
    const tree = asRecord(unwrapped);
    const branch = tree.and ?? tree.or;
    if (branch !== undefined) {
      // Detection only checked that the key is truthy; `{and: "x"}` would reach
      // `.map` and surface a raw TypeError as the install's failure reason.
      if (!Array.isArray(branch)) throw new InstallPayloadError("unreadable_conditions");
      return { version: 2, conditions: convertV1BEToV2(unwrapped) };
    }
    if (!Array.isArray(tree.items)) throw new InstallPayloadError("unreadable_conditions");
    return { version: 2, conditions: convertV1ToV2(unwrapped) };
  }

  // v0 is a FLAT ARRAY. Anything else detecting as 0 is a shape this build does
  // not know, and converting it would silently drop the predicate.
  if (!Array.isArray(unwrapped)) throw new InstallPayloadError("unreadable_conditions");
  return { version: 2, conditions: convertV0ToV2(unwrapped) };
};

/**
 * `context_attributes` is free-form KV shipped into notification payloads and
 * typed `HashMap<String, String>` on the wire, so a non-string value 400s the
 * whole alert. Values are dropped rather than the field being whitelisted: a
 * library alert may legitimately carry attributes its row template reads, and
 * discarding those would change what the notification says.
 */
const stringValuedOnly = (record: Record<string, unknown>): Record<string, string> => {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") kept[key] = value;
  }
  return kept;
};

export function buildInstallPayload(input: InstallPayloadInput): Record<string, unknown> {
  const { entry, file, folderId, destination, owner, timezone, overrides } = input;

  // A library file is JSON by construction, so a JSON round-trip is a complete
  // clone. The drawer keeps rendering the object it handed us, and install
  // must not reach into it.
  const payload = JSON.parse(JSON.stringify(file)) as Record<string, unknown>;

  // ── ImportAlert parity ───────────────────────────────────────────────────
  const trigger = asRecord(payload.trigger_condition);
  if (!Object.hasOwn(trigger, "timezone")) trigger.timezone = timezone;
  if (!Object.hasOwn(trigger, "tolerance_in_secs")) trigger.tolerance_in_secs = null;
  if (overrides?.frequency !== undefined) trigger.frequency = overrides.frequency;
  if (overrides?.silence !== undefined) trigger.silence = overrides.silence;
  payload.trigger_condition = trigger;

  payload.folder_id = folderId;
  payload.owner = owner;
  payload.last_edited_by = owner;
  // The export's id would make this read as an update of an alert this org
  // does not have.
  delete payload.id;

  const queryCondition = asRecord(payload.query_condition);
  if (Object.hasOwn(queryCondition, "conditions") && queryCondition.conditions) {
    queryCondition.conditions = toV2Conditions(queryCondition.conditions);
    payload.query_condition = queryCondition;
  }

  // ── library-specific ─────────────────────────────────────────────────────
  // Overwrite, never merge: the packs hardcode "k8s_alert"/"o2_to_slack",
  // which no customer org has, and the alert API rejects an unknown name.
  payload.destinations = [destination];

  // Phase 5 input, recorded here because this is where the promise is made:
  // `context_attributes` is USER-EDITABLE — the alert form renders it as
  // add/removable KV rows — so these two keys can be edited away after install.
  // Detection must treat their absence as "unknown", never as "not from the
  // library". The `pack:` tag below is equally editable.
  payload.context_attributes = {
    ...stringValuedOnly(asRecord(payload.context_attributes)),
    library_id: entry.id,
    library_hash: entry.content_hash,
  };

  const packTag = `pack:${entry.pack}`;
  const tags = Array.isArray(payload.tags) ? (payload.tags as unknown[]) : [];
  payload.tags = tags.includes(packTag) ? tags : [...tags, packTag];

  // Integers on the wire; "P1" is a display label and a 400.
  const priority = priorityForSeverity(entry.severity);
  if (priority === null) {
    // The drawer told the user "No priority" for this severity. Carrying the
    // export's own value through would break that promise silently.
    delete payload.priority;
  } else {
    payload.priority = priority;
  }

  return payload;
}
