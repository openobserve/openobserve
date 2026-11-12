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

// Fades start at 40% opacity so an entering element never paints a blank frame.
export const ENTER_FADE =
  "motion-safe:animate-in motion-safe:fade-in-40 motion-safe:duration-200 motion-safe:ease-out";

export const ENTER_SLIDE =
  "motion-safe:animate-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 motion-safe:ease-out";

// Region loaders (skeleton, progress line, button spinner) wait this long, so fast loads never flash one.
export const LOADER_DELAY_MS = 300;

// A skeleton, once shown, stays at least this long so it never blinks.
export const MIN_SKELETON_MS = 300;

// Past this a wait gets words and elapsed time, since a bare loader no longer says enough.
export const LONG_WAIT_MS = 10_000;

// A long wait is re-announced at most this often, so a screen reader is not flooded.
export const STILL_LOADING_REPEAT_MS = 30_000;

// Kept content dims only after this long, so a fast refetch neither flickers nor swallows a click.
export const STALE_DIM_DELAY_MS = 150;

export const STALE_DIM = "opacity-60";
