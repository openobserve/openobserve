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

import {
  effectScope,
  getCurrentScope,
  onScopeDispose,
  reactive,
  ref,
  watch,
  type EffectScope,
  type Ref,
} from "vue";

import type { FindMoreSource } from "./findMore";
import type { StarterPack } from "./types";
import { useStarterPackFlow, type StarterPackFlow } from "./useStarterPackFlow";
import { useStarterPackMatcher } from "./useStarterPackMatcher";

type PopupScreen = "list" | "pack";

/** One pack's install state and data match, shared by every surface of an org. */
export interface PackEntry {
  pack: StarterPack;
  flow: StarterPackFlow;
  matcher: ReturnType<typeof useStarterPackMatcher>;
}

/** One pack in a pack list: its state, what the last check found, and where its setup stands. */
export interface RailPack {
  entry: PackEntry;
  source?: FindMoreSource;
  setUp: boolean;
  stopped: boolean;
}

/** What the user chose in a pack's review, kept while the app is open. */
export interface PackReviewChoices {
  unticked: Set<string>;
  expanded: Record<string, boolean>;
  turnOn: boolean;
  sendTo: boolean;
  destination: string;
}

interface PopupOrg {
  open: Ref<boolean>;
  screen: Ref<PopupScreen>;
  packId: Ref<string | null>;
  /** Whether the open pack was reached from the list, so its review can go back to it. */
  fromList: Ref<boolean>;
  /** The pack whose review waits for its plan before it opens. */
  opening: Ref<string | null>;
  entries: Map<string, PackEntry>;
  choices: Map<string, PackReviewChoices>;
  /** Clusters a surface knows before the pack's own match sees them, such as a typed name. */
  hints: Map<string, string[]>;
  // Pack state outlives the surface that made it, so a closed popup keeps a setup running.
  scope: EffectScope;
  /** Mounted surfaces of this org; at none, the org's state goes once no setup runs. */
  users: number;
}

const orgs = new Map<string, PopupOrg>();

const stateOf = (org: string): PopupOrg => {
  let state = orgs.get(org);
  if (!state) {
    state = {
      open: ref(false),
      screen: ref<PopupScreen>("list"),
      packId: ref<string | null>(null),
      fromList: ref(false),
      opening: ref<string | null>(null),
      entries: new Map(),
      choices: new Map(),
      hints: new Map(),
      scope: effectScope(true),
      users: 0,
    };
    orgs.set(org, state);
  }
  return state;
};

const running = (state: PopupOrg) =>
  [...state.entries.values()].some(({ flow }) => flow.running.value);

const dropIfIdle = (org: string, state: PopupOrg) => {
  if (state.users > 0 || orgs.get(org) !== state) return;
  if (!running(state)) {
    state.scope.stop();
    orgs.delete(org);
    return;
  }
  state.scope.run(() => {
    const stop = watch(
      () => running(state),
      (busy) => {
        if (busy) return;
        stop();
        dropIfIdle(org, state);
      },
    );
  });
};

/** Forgets every org's popup and pack state. */
export const resetStarterPackPopups = () => {
  for (const state of orgs.values()) state.scope.stop();
  orgs.clear();
};

/** The one Starter Packs popup of an org: which screen shows, and the pack state behind it. */
export function useStarterPackPopup(org: string) {
  const state = stateOf(org);
  if (getCurrentScope()) {
    state.users += 1;
    onScopeDispose(() => {
      state.users -= 1;
      dropIfIdle(org, state);
    });
  }

  /** Call from a component's setup: the pack state injects the store and router. */
  const entryOf = (pack: StarterPack): PackEntry => {
    let entry = state.entries.get(pack.id);
    if (!entry) {
      entry = state.scope.run(() => ({
        pack,
        flow: useStarterPackFlow(org, pack),
        matcher: useStarterPackMatcher(org, { pack }),
      }))!;
      state.entries.set(pack.id, entry);
    }
    return entry;
  };

  const choicesOf = (packId: string): PackReviewChoices => {
    let choices = state.choices.get(packId);
    if (!choices) {
      choices = reactive<PackReviewChoices>({
        unticked: new Set(),
        expanded: {},
        turnOn: true,
        sendTo: false,
        destination: "",
      });
      state.choices.set(packId, choices);
    }
    return choices;
  };

  const openList = (packId?: string) => {
    if (packId) state.packId.value = packId;
    state.screen.value = "list";
    state.open.value = true;
  };

  const openPack = (packId: string, clusters: string[] = [], { fromList = false } = {}) => {
    if (clusters.length) state.hints.set(packId, clusters);
    state.packId.value = packId;
    state.fromList.value = fromList;
    state.screen.value = "pack";
    state.open.value = true;
  };

  // The review opens fully drawn, so it never swaps the list for skeleton rows.
  const openWhenReady = async (
    { pack, flow }: PackEntry,
    options: { fromList?: boolean; clusters?: string[] } = {},
  ) => {
    const pending = () => ["idle", "loading"].includes(flow.previewState.value);
    if (!flow.installed.value && pending()) {
      if (flow.previewState.value === "idle") void flow.loadPreview();
      state.opening.value = pack.id;
      await new Promise<void>((resolve) => {
        const stop = watch(pending, (waiting) => {
          if (waiting) return;
          stop();
          resolve();
        });
      });
      if (state.opening.value !== pack.id) return;
      state.opening.value = null;
    }
    openPack(pack.id, options.clusters, { fromList: options.fromList });
  };

  const clustersOf = (packId: string, seen: string[]) => [
    ...new Set([...(state.hints.get(packId) ?? []), ...seen]),
  ];

  const back = () => {
    state.screen.value = "list";
  };

  const close = () => {
    state.opening.value = null;
    state.open.value = false;
  };

  return {
    open: state.open,
    screen: state.screen,
    packId: state.packId,
    fromList: state.fromList,
    opening: state.opening,
    entryOf,
    choicesOf,
    clustersOf,
    openList,
    openPack,
    openWhenReady,
    back,
    close,
  };
}

export type StarterPackPopup = ReturnType<typeof useStarterPackPopup>;
