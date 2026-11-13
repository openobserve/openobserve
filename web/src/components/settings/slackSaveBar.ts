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
  onBeforeUnmount,
  provide,
  ref,
  shallowReactive,
  watch,
  type InjectionKey,
  type Ref,
} from "vue";
import { scrollToFirstError } from "@/lib/forms/Form/scrollToFirstError";
import { rebaseSavedValues } from "@/lib/forms/SaveBar/formCounts";

/** One section's unsaved settings, saved and discarded by the page's pinned bar. */
export interface SlackSavePart {
  changes: () => number;
  /** Fields printing an error, for the bar's Fix link. */
  errors: () => number;
  /** Resolves `false` when the part stays unsaved; the part reports its own failure. */
  save: () => Promise<boolean>;
  discard: () => void;
}

type Register = (part: SlackSavePart) => void;

const KEY: InjectionKey<Register> = Symbol("slack-save-bar");

/** The page side: collects the sections' parts and runs them as one Save and one Discard. */
export function provideSlackSaveBar(page?: Ref<HTMLElement | null>) {
  const parts = shallowReactive(new Set<SlackSavePart>());
  provide(KEY, (part) => {
    parts.add(part);
    onBeforeUnmount(() => parts.delete(part));
  });

  const changeCount = computed(() => [...parts].reduce((sum, part) => sum + part.changes(), 0));
  const errorCount = computed(() => [...parts].reduce((sum, part) => sum + part.errors(), 0));
  // A part whose section was replaced keeps its open request, but no longer holds the bar.
  const busy = shallowReactive(new Set<SlackSavePart>());
  const saving = computed(() => [...busy].some((part) => parts.has(part)));

  // Started together so each request carries what Save was clicked on; a failed part stays counted.
  const save = async (): Promise<void> => {
    const dirty = [...parts].filter((part) => part.changes() > 0 && !busy.has(part));
    const saved = await Promise.all(
      dirty.map((part) => {
        busy.add(part);
        return part.save().finally(() => busy.delete(part));
      }),
    );
    // A refused part has marked its field; a failed request has none and this finds nothing.
    if (dirty.some((part, index) => !saved[index] && parts.has(part))) {
      await scrollToFirstError(page?.value ?? undefined);
    }
  };
  const discard = (): void => {
    for (const part of parts) part.discard();
  };

  return {
    changeCount,
    errorCount,
    saving,
    save,
    discard,
    hasParts: computed(() => parts.size > 0),
  };
}

interface BaselineForm<T> {
  state: { values: T; fieldMeta: Record<string, unknown> };
  reset: (_values?: any) => void;
  setFieldValue: (_name: any, _value: any, _opts?: { dontUpdateMeta?: boolean }) => void;
  setFieldMeta: (_name: any, _updater: (_meta: any) => any) => void;
}

// Stands in for "edited" where the rebase compares values; equal to nothing a field can hold.
const EDITED = { edited: true };

/** Owns a form's saved baseline: a successful Save advances it at once, a refresh replaces it and only unedited drafts. */
export function useSavedBaseline<T extends Record<string, unknown>>(
  form: BaselineForm<T>,
  values: Readonly<Ref<T>>,
  fetched: () => T,
  // Makes two spellings of one value equal before they are compared, such as untrimmed text.
  normalize: (value: T) => T = (value) => value,
) {
  const text = (value: unknown) => JSON.stringify(value);
  const copy = (value: T) => JSON.parse(text(value)) as T;
  const baseline = ref(copy(fetched())) as Ref<T>;
  // What each open request carries: a draft that differs from it is unsaved even when it equals the baseline.
  const pending = shallowReactive(new Set<T>());
  const keys = () => Object.keys(baseline.value) as (keyof T & string)[];
  // Values cannot tell "never touched" from "typed back", so each field counts its edits.
  const edits: Record<string, number> = {};
  const settled: Record<string, number> = {};
  const seen: Record<string, string> = {};
  const untouched = (key: string) => (edits[key] ?? 0) === (settled[key] ?? 0);
  // The helper's own writes are not edits: skipped while they run, and recorded as seen after.
  let writing = false;
  const write = (run: () => void) => {
    writing = true;
    try {
      run();
    } finally {
      writing = false;
      for (const key of keys()) seen[key] = text(form.state.values[key]);
    }
  };
  write(() => {});

  // Sync, so an edit is counted before a response handled in the same tick looks at the counts.
  watch(
    () => keys().map((key) => text(values.value[key])),
    (now) =>
      keys().forEach((key, index) => {
        if (writing || now[index] === seen[key]) return;
        seen[key] = now[index];
        edits[key] = (edits[key] ?? 0) + 1;
      }),
    { flush: "sync" },
  );

  const adopt = (next: T) => {
    baseline.value = copy(next);
    const current = form.state.values;
    const submitted = Object.fromEntries(
      keys().map((key) => [key, untouched(key) ? current[key] : EDITED]),
    ) as T;
    write(() => rebaseSavedValues(form, copy(next), submitted));
  };
  watch(
    () => text(fetched()),
    () => adopt(fetched()),
  );

  const changed = computed(() => {
    const draft = normalize(values.value);
    const differs = (from: T, key: string) => text(draft[key]) !== text(normalize(from)[key]);
    return keys().filter(
      (key) => differs(baseline.value, key) || [...pending].some((sent) => differs(sent, key)),
    );
  });

  return {
    /** The last values known to be saved: the dirty count, Discard and the request body compare with this. */
    baseline: baseline as Readonly<Ref<T>>,
    /** Fields whose draft is not what is saved, or not what an open request is saving. */
    changed,
    /** Runs a save request; on success its values become the baseline and fields not edited since the click are settled. */
    async save(request: () => Promise<unknown>): Promise<void> {
      const atClick = { ...edits };
      const sent = copy(form.state.values);
      pending.add(sent);
      try {
        await request();
      } finally {
        pending.delete(sent);
      }
      for (const key of keys()) {
        if ((edits[key] ?? 0) === (atClick[key] ?? 0)) settled[key] = edits[key] ?? 0;
      }
      adopt(sent);
    },
    discard(): void {
      write(() => form.reset(copy(baseline.value)));
      Object.assign(settled, edits);
    },
  };
}

/** The section side. Outside the Slack page (a section mounted alone) nothing is registered. */
export function useSlackSavePart(part: SlackSavePart): boolean {
  const register = inject(KEY, null);
  register?.(part);
  return !!register;
}
