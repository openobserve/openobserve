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

import type { Plugin } from "vite";

const ENTRY = /\/src\/main\.ts$/;

const PAGE = /\/src\/views\/SharedChatView\.vue$/;

const FORBIDDEN = [
  /\/composables\/assistant\/(runtime|assistantStore|turnEngine|useAssistantClient|index)\.ts$/,
  /\/services\/assistant\.queries\.ts$/,
];

// Each edge sits behind a branch the public page never takes; the sharing E2E checks the network for it.
const GATED_EDGES: [RegExp, RegExp][] = [
  // initAssistant, which main.ts skips on /ai/public/.
  [ENTRY, /\/composables\/assistant\/index\.ts$/],
  // ensureRuntime, called only by host editors and the panel width, which the page never mounts.
  [/\/composables\/assistant\/runtimeHandle\.ts$/, /\/composables\/assistant\/runtime\.ts$/],
  // The gate states, which only the org page shows (forbidden, not configured).
  [/\/shared\/SharedChatState\.vue(\?.*)?$/, /\/gate\/AssistantGateState\.vue$/],
  // The message bar and inline editor, which a readonly transcript never mounts.
  [/\/transcript\/AssistantTranscript\.vue(\?.*)?$/, /\/transcript\/AssistantMessageActions\.vue$/],
  // Ask an admin, which a readonly turn outcome replaces with one line.
  [/\/turn\/AssistantTurnOutcome\.vue(\?.*)?$/, /\/gate\/AssistantAskAdminPopover\.vue$/],
];

interface ModuleEdges {
  importedIds: readonly string[];
  dynamicallyImportedIds: readonly string[];
}

/** Fails the build when the public shared page can reach the assistant runtime, printing the import chain. */
export function assistantBundlePlugin(): Plugin {
  return {
    name: "o2-assistant-bundle-check",
    apply: "build",
    generateBundle() {
      const ids = [...this.getModuleIds()];
      const unmatched = FORBIDDEN.filter((re) => !ids.some((id) => re.test(id)));
      if (unmatched.length) this.error(`no module matches ${unmatched.join(", ")}`);
      const entry = ids.find((id) => ENTRY.test(id));
      const page = ids.find((id) => PAGE.test(id));
      if (!entry || !page) this.error("main.ts or SharedChatView.vue is missing from the build");
      const edges = (id: string): ModuleEdges | null => this.getModuleInfo(id);
      const app = walk(entry as string, edges, false);
      const shared = walk(page as string, edges, true);
      const failures = [...app.failures, ...shared.failures];
      if (failures.length) {
        this.error(`the public shared page reaches the runtime:\n${failures.join("\n")}`);
      }
      this.info(`public shared page: ${app.seen + shared.seen} modules, none of the runtime`);
    },
  };
}

// From main.ts only its own dynamic imports run on every page; the routes behind the router are lazy.
function walk(
  start: string,
  edges: (id: string) => ModuleEdges | null,
  followDynamic: boolean,
): { failures: string[]; seen: number } {
  const chain = new Map<string, string[]>([[start, [start]]]);
  const queue = [start];
  const failures: string[] = [];
  while (queue.length) {
    const id = queue.shift() as string;
    const info = edges(id);
    if (!info) continue;
    const next = [...info.importedIds];
    if (followDynamic || id === start) next.push(...info.dynamicallyImportedIds);
    for (const to of next) {
      if (chain.has(to) || GATED_EDGES.some(([from, target]) => from.test(id) && target.test(to))) {
        continue;
      }
      const path = [...(chain.get(id) as string[]), to];
      chain.set(to, path);
      if (FORBIDDEN.some((re) => re.test(to))) failures.push(`  ${path.map(short).join(" -> ")}`);
      else queue.push(to);
    }
  }
  return { failures, seen: chain.size };
}

function short(id: string): string {
  const at = id.indexOf("/src/");
  return at >= 0 ? id.slice(at + 1) : id;
}
