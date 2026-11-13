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

import { getCurrentScope, onScopeDispose, ref, watch, type Ref } from "vue";

export const TITLE_MIN_PX = 160;

export interface TitleRoomState {
  crowded: boolean;
  /** Header width at which the title had room again when it was last crowded. */
  roomAt: number;
  /** Width of the moved control in its new place, first measured after the move; null until then. */
  movedWidth: number | null;
}

export interface TitleRoomSizes {
  headerWidth: number;
  /** Width the title text needs. */
  titleWidth: number;
  /** Width the header leaves the title. */
  titleRoom: number;
  /** Width of the control that moves out of the header when the title is crowded. */
  movedWidth?: number;
}

export interface TitleRoomOptions {
  minPx?: number;
  /** The control the page moves out when crowded; its width changes move the threshold. */
  movedEl?: Ref<HTMLElement | null>;
}

// Once crowded, the title box is no longer squeezed, so only the header width and the moved control say when it fits.
export const nextTitleRoom = (
  state: TitleRoomState,
  sizes: TitleRoomSizes,
  minPx = TITLE_MIN_PX,
): TitleRoomState => {
  if (state.crowded) {
    const moved = sizes.movedWidth;
    // The header may have squeezed the control, so its width is only compared once it has moved.
    const baseline = state.movedWidth ?? moved;
    const shrunk = baseline === undefined || moved === undefined ? 0 : baseline - moved;
    if (sizes.headerWidth >= state.roomAt - shrunk)
      return { crowded: false, roomAt: 0, movedWidth: null };
    if (state.movedWidth !== null || moved === undefined) return state;
    return { ...state, movedWidth: moved };
  }
  const need = Math.min(sizes.titleWidth, minPx);
  if (sizes.titleRoom >= need) return state;
  return { crowded: true, roomAt: sizes.headerWidth + need - sizes.titleRoom, movedWidth: null };
};

/** True while header actions would squeeze the title below `minPx`, so the page can move one out. */
export const useHeaderTitleRoom = (
  titleEl: Ref<HTMLElement | null>,
  { minPx = TITLE_MIN_PX, movedEl }: TitleRoomOptions = {},
) => {
  const crowded = ref(false);
  let state: TitleRoomState = { crowded: false, roomAt: 0, movedWidth: null };
  let observer: ResizeObserver | null = null;
  let textObserver: MutationObserver | null = null;

  const check = () => {
    const title = titleEl.value;
    const box = title?.parentElement;
    const header = title?.closest("header");
    if (!title || !box || !header) return;
    state = nextTitleRoom(
      state,
      {
        headerWidth: header.clientWidth,
        titleWidth: title.getBoundingClientRect().width,
        titleRoom: box.clientWidth,
        movedWidth: movedEl?.value?.getBoundingClientRect().width,
      },
      minPx,
    );
    crowded.value = state.crowded;
  };

  const stop = () => {
    observer?.disconnect();
    textObserver?.disconnect();
    observer = null;
    textObserver = null;
  };

  watch(
    [titleEl, () => movedEl?.value ?? null],
    ([title, moved]) => {
      stop();
      const header = title?.closest("header");
      if (!title?.parentElement || !header || typeof ResizeObserver === "undefined") return;
      observer = new ResizeObserver(check);
      observer.observe(header);
      observer.observe(title.parentElement);
      if (moved) observer.observe(moved);
      // A title that loads into an already squeezed box resizes nothing, so watch its text too.
      textObserver = new MutationObserver(check);
      textObserver.observe(title, { childList: true, characterData: true, subtree: true });
    },
    { flush: "post" },
  );

  if (getCurrentScope()) onScopeDispose(stop);

  return { crowded, check };
};
