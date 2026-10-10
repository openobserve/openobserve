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

import { computed, type InjectionKey, type Ref } from "vue";
import { useStore } from "vuex";
import { b64EncodeStandard } from "@/utils/formatters";
import { useOrgCredential } from "@/composables/useOrgCredential";

/** Provided by the Ingestion page so a snippet's token link can open the header token picker. */
export const OPEN_TOKEN_PICKER: InjectionKey<() => void> = Symbol("openTokenPicker");

const PASSCODE_PLACEHOLDERS = ["[PASSCODE]", "[BASIC_PASSCODE]"];
const MASK = "•".repeat(12);
const VISIBLE_EDGE = 4;

/** Keeps the first and last four characters; shorter secrets are fully masked. */
export function maskSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length <= VISIBLE_EDGE * 2) return MASK;
  return secret.slice(0, VISIBLE_EDGE) + MASK + secret.slice(-VISIBLE_EDGE);
}

/** Builds the real and the masked snippet from one template, so OCodeBlock can map a masked selection back to the real token. */
export function useCredentialSnippet(content: Ref<string>) {
  const store = useStore();

  const email = computed<string>(() => store.state.userInfo?.email ?? "");
  const passcode = computed<string>(() => store.state.organizationData?.organizationPasscode ?? "");
  const basicPasscode = computed(() =>
    passcode.value ? (b64EncodeStandard(`${email.value}:${passcode.value}`) ?? "") : "",
  );

  const fill = (template: string, token: string, basic: string) =>
    template
      .replaceAll("[EMAIL]", email.value)
      .replaceAll("[PASSCODE]", token)
      .replaceAll("[BASIC_PASSCODE]", basic);

  const code = computed(() => fill(content.value ?? "", passcode.value, basicPasscode.value));
  const codeMasked = computed(() =>
    fill(content.value ?? "", maskSecret(passcode.value), maskSecret(basicPasscode.value)),
  );
  const needsPasscode = computed(() =>
    PASSCODE_PLACEHOLDERS.some((token) => (content.value ?? "").includes(token)),
  );
  const { ready } = useOrgCredential(needsPasscode);
  const forbidden = computed(() => !!store.state.organizationData?.organizationPasscodeForbidden);
  const tokenName = computed<string | undefined>(() => {
    if (!passcode.value) return undefined;
    const tokens: Array<{ name: string; token: string }> =
      store.state.organizationData?.orgTokens ?? [];
    return tokens.find((t) => t.token === passcode.value)?.name;
  });

  return { code, codeMasked, needsPasscode, forbidden, tokenName, ready };
}

export default useCredentialSnippet;
