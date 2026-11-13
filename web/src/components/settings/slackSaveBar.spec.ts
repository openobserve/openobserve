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

import { describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { useSavedBaseline } from "./slackSaveBar";

interface Values extends Record<string, unknown> {
  a: string;
  b: string;
}
type Step =
  | ["edit", keyof Values, string]
  | ["save"]
  | ["ok" | "fail", number]
  | ["refresh", Partial<Values>]
  | ["discard"];

const SERVER: Values = { a: "old", b: "old" };

/** Runs the steps on a real form; `ok` / `fail` settle the nth Save, `refresh` is the server's values landing. */
async function play(steps: Step[]) {
  const server = ref<Values>({ ...SERVER });
  const requests: { resolve: () => void; reject: (reason: Error) => void }[] = [];
  let form!: ReturnType<typeof useOForm<Values>>;
  let baseline!: ReturnType<typeof useSavedBaseline<Values>>;
  const w = mount(
    defineComponent({
      setup() {
        form = useOForm<Values>({ defaultValues: { ...SERVER }, onSubmit: () => {} });
        baseline = useSavedBaseline(
          form,
          form.useStore((s) => s.values),
          () => server.value,
        );
        return () => h("div");
      },
    }),
  );
  for (const step of steps) {
    if (step[0] === "edit") form.setFieldValue(step[1], step[2]);
    if (step[0] === "save") {
      const request = new Promise<void>((resolve, reject) => requests.push({ resolve, reject }));
      void baseline.save(() => request).catch(() => {});
    }
    if (step[0] === "ok") requests[step[1]].resolve();
    if (step[0] === "fail") requests[step[1]].reject(new Error("refused"));
    if (step[0] === "refresh") server.value = { ...server.value, ...step[1] };
    if (step[0] === "discard") baseline.discard();
    await flushPromises();
  }
  const result = { draft: { ...form.state.values }, unsaved: [...baseline.changed.value] };
  w.unmount();
  return result;
}

describe("useSavedBaseline", () => {
  it.each<{ name: string; steps: Step[]; draft: Values; unsaved: string[] }>([
    {
      name: "save, then its refresh: the field follows the server",
      steps: [["edit", "a", "new"], ["save"], ["ok", 0], ["refresh", { a: "new" }]],
      draft: { a: "new", b: "old" },
      unsaved: [],
    },
    {
      name: "save open, nothing typed since: counted until it answers",
      steps: [["edit", "a", "new"], ["save"]],
      draft: { a: "new", b: "old" },
      unsaved: ["a"],
    },
    {
      name: "typed back to the old value while the save is open, before it answers",
      steps: [["edit", "a", "new"], ["save"], ["edit", "a", "old"]],
      draft: { a: "old", b: "old" },
      unsaved: ["a"],
    },
    {
      name: "save answered, refresh not here yet: clean",
      steps: [["edit", "a", "new"], ["save"], ["ok", 0]],
      draft: { a: "new", b: "old" },
      unsaved: [],
    },
    {
      name: "typed back after the save answered, with its refresh late or failed: unsaved",
      steps: [["edit", "a", "new"], ["save"], ["ok", 0], ["edit", "a", "old"]],
      draft: { a: "old", b: "old" },
      unsaved: ["a"],
    },
    {
      name: "edited and typed back with no save: clean",
      steps: [
        ["edit", "a", "x"],
        ["edit", "a", "old"],
      ],
      draft: { a: "old", b: "old" },
      unsaved: [],
    },
    {
      name: "the server stores the saved value in another form: adopted",
      steps: [["edit", "a", " new"], ["save"], ["ok", 0], ["refresh", { a: "new" }]],
      draft: { a: "new", b: "old" },
      unsaved: [],
    },
    {
      name: "edited while the save is open",
      steps: [
        ["edit", "a", "new"],
        ["save"],
        ["edit", "a", "later"],
        ["ok", 0],
        ["refresh", { a: "new" }],
      ],
      draft: { a: "later", b: "old" },
      unsaved: ["a"],
    },
    {
      name: "typed back to the old value while the save is open",
      steps: [
        ["edit", "a", "new"],
        ["save"],
        ["edit", "a", "old"],
        ["ok", 0],
        ["refresh", { a: "new" }],
      ],
      draft: { a: "old", b: "old" },
      unsaved: ["a"],
    },
    {
      name: "typed back to the old value after the save answered, before its refresh",
      steps: [
        ["edit", "a", "new"],
        ["save"],
        ["ok", 0],
        ["edit", "a", "old"],
        ["refresh", { a: "new" }],
      ],
      draft: { a: "old", b: "old" },
      unsaved: ["a"],
    },
    {
      name: "the first save's refresh lands while a second save is open, which then fails",
      steps: [
        ["edit", "a", "first"],
        ["save"],
        ["ok", 0],
        ["edit", "a", "second"],
        ["save"],
        ["refresh", { a: "first" }],
        ["fail", 1],
      ],
      draft: { a: "second", b: "old" },
      unsaved: ["a"],
    },
    {
      name: "two saves in a row, both answered, refreshes in order",
      steps: [
        ["edit", "a", "first"],
        ["save"],
        ["ok", 0],
        ["edit", "a", "second"],
        ["save"],
        ["refresh", { a: "first" }],
        ["ok", 1],
        ["refresh", { a: "second" }],
      ],
      draft: { a: "second", b: "old" },
      unsaved: [],
    },
    {
      name: "two saves answered before the first one's late refresh: ends on the second value",
      steps: [
        ["edit", "a", "first"],
        ["save"],
        ["ok", 0],
        ["edit", "a", "second"],
        ["save"],
        ["ok", 1],
        ["refresh", { a: "first" }],
        ["refresh", { a: "second" }],
      ],
      draft: { a: "second", b: "old" },
      unsaved: [],
    },
    {
      name: "a failed save, then someone else's change arrives: the draft stays",
      steps: [["edit", "a", "new"], ["save"], ["fail", 0], ["refresh", { a: "theirs" }]],
      draft: { a: "new", b: "old" },
      unsaved: ["a"],
    },
    {
      name: "never touched: someone else's change is shown",
      steps: [["refresh", { a: "theirs", b: "theirs" }]],
      draft: { a: "theirs", b: "theirs" },
      unsaved: [],
    },
    {
      name: "edited and typed back without saving: still the user's, so not replaced",
      steps: [
        ["edit", "a", "x"],
        ["edit", "a", "old"],
        ["refresh", { a: "theirs" }],
      ],
      draft: { a: "old", b: "old" },
      unsaved: ["a"],
    },
    {
      name: "discarded: follows the server again",
      steps: [["edit", "a", "x"], ["discard"], ["refresh", { a: "theirs" }]],
      draft: { a: "theirs", b: "old" },
      unsaved: [],
    },
    {
      name: "two fields: the other one edited while the save is open",
      steps: [
        ["edit", "a", "new"],
        ["save"],
        ["edit", "b", "later"],
        ["ok", 0],
        ["refresh", { a: "new" }],
      ],
      draft: { a: "new", b: "later" },
      unsaved: ["b"],
    },
    {
      name: "two fields saved, one typed back while the save is open",
      steps: [
        ["edit", "a", "new"],
        ["edit", "b", " new"],
        ["save"],
        ["edit", "a", "old"],
        ["ok", 0],
        ["refresh", { a: "new", b: "new" }],
      ],
      draft: { a: "old", b: "new" },
      unsaved: ["a"],
    },
    {
      name: "two fields: a kept draft does not stop the saved field from following later refreshes",
      steps: [
        ["edit", "a", "new"],
        ["save"],
        ["ok", 0],
        ["edit", "b", "mine"],
        ["refresh", { a: "new" }],
        ["refresh", { a: "theirs" }],
      ],
      draft: { a: "theirs", b: "mine" },
      unsaved: ["b"],
    },
  ])("$name", async ({ steps, draft, unsaved }) => {
    expect(await play(steps)).toEqual({ draft, unsaved });
  });
});
