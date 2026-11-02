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
  computed,
  inject,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  provide,
  ref,
  shallowReactive,
  watch,
  type Component,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from "vue";

/** A page host sits in a page header or toolbar; the fallback host sits in the app top bar and shows only what no page host took. */
export type PageHeaderStatusPriority = "page" | "fallback";

/** One provider's status and the page hosts competing to show it. */
export interface PageHeaderStatusContext {
  /** What this provider's owning page host renders: its own status, or a nested provider's that found no host. */
  display: ComputedRef<Component | null>;
  /** The display once settled with no page host, for an ancestor provider or the fallback host. */
  unhosted: ComputedRef<Component | null>;
  owner: ComputedRef<symbol | null>;
  claim: (id: symbol, el: Element) => void;
  release: (id: symbol) => void;
  adopt: (child: PageHeaderStatusContext) => () => void;
}

export const PAGE_HEADER_STATUS_KEY: InjectionKey<PageHeaderStatusContext> =
  Symbol("pageHeaderStatus");

const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"]';
// A page's toolbar can arrive with a lazily loaded child, so a status waits this long before it falls back to an outer host.
const SETTLE_MS = 250;

const rootContexts = shallowReactive(new Set<PageHeaderStatusContext>());

/** Offers `component` to the first page host below; `resetKey` names the screen, so a change restarts the wait before falling back. */
export function providePageHeaderStatus(
  component: () => Component | null,
  resetKey: () => unknown,
): PageHeaderStatusContext {
  const parent = inject(PAGE_HEADER_STATUS_KEY, null);
  const claims = shallowReactive(new Map<symbol, Element>());
  const children = shallowReactive(new Set<PageHeaderStatusContext>());
  const owner = computed(() => firstInDocument(claims));
  const display = computed(() => component() ?? firstUnhosted(children));
  const settled = ref(false);
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  watch(
    [resetKey, display],
    () => {
      settled.value = false;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => (settled.value = true), SETTLE_MS);
    },
    { immediate: true },
  );
  const context: PageHeaderStatusContext = {
    display,
    unhosted: computed(() => (settled.value && owner.value === null ? display.value : null)),
    owner,
    claim: (id, el) => {
      claims.set(id, el);
    },
    release: (id) => {
      claims.delete(id);
    },
    adopt: (child) => {
      children.add(child);
      return () => {
        children.delete(child);
      };
    },
  };
  const detach = parent ? parent.adopt(context) : adoptRoot(context);
  provide(PAGE_HEADER_STATUS_KEY, context);
  onBeforeUnmount(() => {
    detach();
    clearTimeout(settleTimer);
  });
  return context;
}

/** Claims a place for the provided status at `el` and returns what this host should render now. */
export function usePageHeaderStatusHost(
  el: Ref<Element | null>,
  priority: PageHeaderStatusPriority = "page",
): ComputedRef<Component | null> {
  if (priority === "fallback") return computed(() => firstUnhosted(rootContexts));
  const context = inject(PAGE_HEADER_STATUS_KEY, null);
  const id = Symbol("page-header-status-host");
  // Claims compare DOM position, so they are made once the host is in the document and dropped while kept-alive and hidden.
  const claim = () => {
    if (context && el.value) context.claim(id, el.value);
  };
  const release = () => context?.release(id);
  onMounted(claim);
  onActivated(claim);
  onBeforeUnmount(release);
  onDeactivated(release);
  return computed(() => (context?.owner.value === id ? context.display.value : null));
}

function adoptRoot(context: PageHeaderStatusContext): () => void {
  rootContexts.add(context);
  return () => {
    rootContexts.delete(context);
  };
}

function firstUnhosted(contexts: Set<PageHeaderStatusContext>): Component | null {
  for (const context of contexts) {
    if (context.unhosted.value) return context.unhosted.value;
  }
  return null;
}

// The first host in document order that is not inside a dialog or drawer.
function firstInDocument(claims: Map<symbol, Element>): symbol | null {
  let first: [symbol, Element] | null = null;
  for (const [id, el] of claims) {
    if (!el.isConnected || el.closest(OVERLAY_SELECTOR)) continue;
    if (!first || first[1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) {
      first = [id, el];
    }
  }
  return first?.[0] ?? null;
}
