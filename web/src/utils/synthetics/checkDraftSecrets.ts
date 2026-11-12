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

import type { BrowserCheck, BrowserStep, HttpCheckConfig } from "@/types/synthetics";
import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";
import type { RedactedDraft } from "@/utils/drafts/redactDraftSecrets";
import { urlCarriesCredential } from "@/utils/drafts/urlCredentials";

type ValueEntry = { value: string };

// A field these words name takes a credential, so what a step types into it is one, whatever the step is called.
const CREDENTIAL_TARGET =
  /pass(word|wd|code|phrase)|secret|token|api[-_ ]?key|\b(pwd|otp|pin|cvv|cvc|[2m]fa)\b|one[-_ ]?time/i;

// A value made only of `{{name}}` references names a stored secret or variable, so it holds none itself.
const ONLY_PLACEHOLDERS = /^\s*(\{\{\s*\w+\s*\}\}\s*)+$/;

/** Whether a journey step types a credential: into a password, token or one-time-code field, or under such a name. */
export const stepTypesCredential = (step: BrowserStep): boolean => {
  if (step.action !== "type" || typeof step.value !== "string" || step.value === "") return false;
  if (ONLY_PLACEHOLDERS.test(step.value)) return false;
  const target = [
    step.name,
    step.selector,
    step.wire?.selector,
    ...(step.locator?.candidates ?? []).map((candidate) => candidate.value),
  ];
  return target.some((text) => typeof text === "string" && CREDENTIAL_TARGET.test(text));
};

// The wire mirrors the typed value for replay; the editor writes it back from the step on restore.
const blankTypedStep = (step: BrowserStep): BrowserStep => ({
  ...step,
  value: "",
  ...(step.wire ? { wire: { ...step.wire, value: "" } } : {}),
});

/** Blanks a target URL that can hold a credential, the Auth & network and HTTP request header values, the cookie values, the secrets, the secure variables and the credentials a journey types. */
export const redactCheckDraftSecrets = <T extends BrowserCheck>(
  check: T,
  pointerPrefix = "",
  // A tcp, tls or ssh check targets a bare host, which holds no credential.
  { hostTarget = false }: { hostTarget?: boolean } = {},
): RedactedDraft<T> => {
  const paths: string[] = [];
  const blank = <E extends ValueEntry>(
    field: string,
    list: E[],
    isSecret: (entry: E) => boolean = () => true,
  ): E[] =>
    list.map((entry, index) => {
      if (typeof entry.value !== "string" || entry.value === "" || !isSecret(entry)) return entry;
      paths.push(`${pointerPrefix}/${field}/${index}/value`);
      return { ...entry, value: "" };
    });

  const data: T = { ...check };
  if (!hostTarget && urlCarriesCredential(check.url ?? "")) {
    data.url = "";
    paths.push(`${pointerPrefix}/url`);
  }
  // Custom headers and cookies on this card exist to carry credentials, whatever they are named.
  if (check.headers) data.headers = blank("headers", check.headers);
  if (check.cookies) data.cookies = blank("cookies", check.cookies);
  if (check.secrets) data.secrets = blank("secrets", check.secrets);
  if (check.variables) data.variables = blank("variables", check.variables, (v) => !!v.secure);
  if (check.journey?.length) {
    data.journey = check.journey.map((step, index) => {
      if (!stepTypesCredential(step)) return step;
      paths.push(`${pointerPrefix}/journey/${index}/value`);
      return blankTypedStep(step);
    });
  }
  // An HTTP check's own request headers carry credentials just as often, whatever they are named.
  const http = (check as { http?: HttpCheckConfig }).http;
  if (http?.headers?.length) {
    (data as { http?: HttpCheckConfig }).http = {
      ...http,
      headers: blank("http/headers", http.headers),
    };
  }
  return { data, paths };
};

/** Writes each typed step's restored value back into the wire it replays from, which the draft kept blank. */
export const refillTypedStepWires = <T extends BrowserCheck>(check: T): T => ({
  ...check,
  journey: (check.journey ?? []).map((step) =>
    step.action === "type" && step.wire?.value === "" && typeof step.value === "string"
      ? { ...step, wire: { ...step.wire, value: step.value } }
      : step,
  ),
});

type EntryField = {
  name: (check: BrowserCheck, index: number) => string | undefined;
  key: I18nKey;
};

const ENTRY_FIELDS: Record<string, EntryField> = {
  "http/headers": {
    name: (check, index) => (check as { http?: HttpCheckConfig }).http?.headers[index]?.name,
    key: "common.editorDraft.headerField",
  },
  headers: {
    name: (check, index) => check.headers?.[index]?.key,
    key: "common.editorDraft.headerField",
  },
  cookies: {
    name: (check, index) => check.cookies?.[index]?.name,
    key: "common.editorDraft.cookieField",
  },
  secrets: {
    name: (check, index) => check.secrets?.[index]?.name,
    key: "common.editorDraft.secretField",
  },
  variables: {
    name: (check, index) => check.variables?.[index]?.name,
    key: "common.editorDraft.variableField",
  },
  // An unnamed step is named by its position, as the journey numbers its steps.
  journey: {
    name: (check, index) =>
      check.journey?.[index] ? check.journey[index].name || String(index + 1) : undefined,
    key: "common.editorDraft.stepValueField",
  },
};

const ENTRY_PATH = /^\/(http\/headers|headers|cookies|secrets|variables|journey)\/(\d+)\/value$/;

/** Names the fields behind a check's redacted paths; empty when one cannot be named, so the dialog's general note covers them. */
export const describeCheckRedacted = (
  paths: string[],
  check: BrowserCheck,
  t: TranslateFn,
  { pointerPrefix = "", urlLabel }: { pointerPrefix?: string; urlLabel: I18nText },
): I18nText[] => {
  const labels = paths.flatMap((pointer): I18nText[] => {
    const path = pointer.slice(pointerPrefix.length);
    if (path === "/url") return [urlLabel];
    const match = ENTRY_PATH.exec(path);
    const field = match ? ENTRY_FIELDS[match[1]] : undefined;
    const name = match && field ? field.name(check, Number(match[2])) : undefined;
    return field && name ? [t(field.key, { name })] : [];
  });
  return labels.length === paths.length ? labels : [];
};

/** The configure cards' validation key (`auth.password`, `headers.0.value`) for a redacted pointer under `pointerPrefix`. */
export const reentryValidationKey = (path: string, pointerPrefix = ""): string =>
  path
    .slice(pointerPrefix.length + 1)
    .split("/")
    .join(".");
