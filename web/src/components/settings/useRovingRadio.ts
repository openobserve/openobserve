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

const STEP_KEYS: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/** Arrow-key selection with a single tab stop, for a row of buttons acting as a radio group. */
export function useRovingRadio(
  choices: () => readonly string[],
  selected: () => string,
  choose: (_choice: string) => void,
) {
  const options: (HTMLElement | null)[] = [];

  const setOption = (index: number, el: unknown) => {
    const node = (el as { $el?: HTMLElement } | null)?.$el ?? (el as HTMLElement | null);
    options[index] = node ?? null;
  };

  const tabStop = (choice: string) => {
    const all = choices();
    const current = all.includes(selected()) ? selected() : all[0];
    return choice === current ? 0 : -1;
  };

  const onKeydown = (event: KeyboardEvent) => {
    const step = STEP_KEYS[event.key];
    if (!step) return;
    event.preventDefault();
    const all = choices();
    const current = Math.max(0, all.indexOf(selected()));
    const next = (current + step + all.length) % all.length;
    choose(all[next]);
    options[next]?.focus();
  };

  return { setOption, tabStop, onKeydown };
}
