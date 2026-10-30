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

import { computed, reactive, toValue, watch, type MaybeRefOrGetter } from "vue";
import { useStore, type Store } from "vuex";
import { queryClient } from "@/composables/query/queryClient";
import { ingestionTokensQuery, orgPasscodeQuery } from "@/services/organizations.queries";

// keyed by store so setup pages, empty pages and Home publish one credential, and a test's fresh store starts clean
const states = new WeakMap<object, CredentialState>();

/** What GET /{org}/passcode answered; only `forbidden` withholds every snippet. */
export type PasscodeRead =
  | { kind: "ok"; passcode: string; user: string }
  | { kind: "empty" }
  | { kind: "forbidden" }
  | { kind: "failed" };

interface OrgToken {
  name: string;
  token: string;
  enabled?: boolean;
}

interface CredentialState {
  org: string;
  read: PasscodeRead | undefined;
  picked: string;
}

type AnyStore = Store<any>;

function stateFor(store: AnyStore): CredentialState {
  let state = states.get(store);
  if (!state) {
    state = reactive<CredentialState>({ org: "", read: undefined, picked: "" });
    states.set(store, state);
  }
  return state;
}

function currentOrg(store: AnyStore): string {
  return store.state.selectedOrganization?.identifier ?? "";
}

function orgTokens(store: AnyStore): OrgToken[] {
  return store.state.organizationData?.orgTokens ?? [];
}

function chosenToken(store: AnyStore, state: CredentialState): OrgToken | undefined {
  const tokens = orgTokens(store).filter((t) => t?.enabled && !!t.token);
  return tokens.find((t) => t.name === state.picked) ?? tokens[0];
}

function publishPasscode(store: AnyStore, value: string): void {
  if (store.state.organizationData?.organizationPasscode !== value) {
    store.dispatch("setOrganizationPasscode", value);
  }
}

function toRead(res: { data?: { passcode?: string; user?: string } } | undefined): PasscodeRead {
  return res?.data?.passcode
    ? { kind: "ok", passcode: res.data.passcode, user: res.data.user ?? "" }
    : { kind: "empty" };
}

/** Publishes what every snippet reads: the picked org token, else the first enabled one, else the user passcode. */
export function applyOrgCredential(store: AnyStore): void {
  const state = stateFor(store);
  const read = state.read;
  if (!read || state.org !== currentOrg(store)) return;
  if (read.kind === "forbidden") {
    store.dispatch("setOrganizationPasscodeForbidden", true);
    // a token published before the 403 landed was never this role's to see
    const published = store.state.organizationData?.organizationPasscode;
    if (published && orgTokens(store).some((t) => t.token === published)) {
      store.dispatch("setOrganizationPasscode", "");
    }
    return;
  }
  if (store.state.organizationData?.organizationPasscodeForbidden) {
    store.dispatch("setOrganizationPasscodeForbidden", false);
  }
  const token = chosenToken(store, state);
  if (token) {
    state.picked = token.name;
    publishPasscode(store, token.token);
    return;
  }
  if (read.kind === "ok") {
    publishPasscode(store, read.passcode);
    store.dispatch("setOrganizationPasscodeUser", read.user);
  }
}

/** Reads the org's ingestion tokens and passcode together and publishes once both settled, so answer order cannot decide. */
export async function loadOrgCredential(store: AnyStore, org: string): Promise<PasscodeRead> {
  const state = stateFor(store);
  if (state.org !== org) {
    state.org = org;
    state.read = undefined;
    state.picked = "";
  }
  const [, read] = await Promise.all([
    queryClient
      .fetchQuery(ingestionTokensQuery(org))
      .then((res: { data?: OrgToken[] } | undefined) => {
        if (state.org === org) store.dispatch("setOrgTokens", res?.data ?? []);
      })
      .catch(() => undefined),
    queryClient
      .fetchQuery(orgPasscodeQuery(org))
      .then(toRead)
      .catch((e: { response?: { status?: number } }): PasscodeRead =>
        e?.response?.status === 403 ? { kind: "forbidden" } : { kind: "failed" },
      ),
  ]);
  if (state.org === org) {
    state.read = read;
    applyOrgCredential(store);
  }
  return read;
}

/** Loads the selected org's credential while `enabled`, and lets the token picker and a passcode reset steer it. */
export function useOrgCredential(enabled: MaybeRefOrGetter<boolean> = true) {
  const store = useStore();
  const state = stateFor(store);
  const org = computed(() => currentOrg(store));

  const load = (): Promise<PasscodeRead | undefined> =>
    org.value ? loadOrgCredential(store, org.value) : Promise.resolve(undefined);

  // MainLayout replaces organizationData on an org switch, which drops what was published
  watch(
    [org, () => toValue(enabled), () => store.state.organizationData],
    ([identifier, on]) => {
      if (identifier && on) void load();
    },
    { immediate: true },
  );
  // the Ingestion tokens page writes the list directly when a token is added or disabled
  watch(
    () => store.state.organizationData?.orgTokens,
    () => {
      if (toValue(enabled)) applyOrgCredential(store);
    },
  );

  const ready = computed(() => state.org === org.value && !!state.read);
  const pickedName = computed<string>(() =>
    state.org === org.value ? (chosenToken(store, state)?.name ?? "") : "",
  );

  const pickToken = (name: string) => {
    if (state.org !== org.value) return;
    state.picked = name;
    applyOrgCredential(store);
  };

  const setUserPasscode = (passcode: string, user: string) => {
    if (state.org !== org.value) return;
    state.read = { kind: "ok", passcode, user };
    applyOrgCredential(store);
  };

  return { ready, pickedName, load, pickToken, setUserPasscode };
}

export default useOrgCredential;
