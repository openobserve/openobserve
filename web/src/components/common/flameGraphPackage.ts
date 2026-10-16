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

/**
 * The package part of a frame name, so frames from one package share a colour.
 *
 *   "crypto/sha256.(*Digest).Sum" → "crypto/sha256"
 *   "main.handleCheckout"         → "main"
 *   "std::vec::Vec::push"         → "std"
 *
 * ponytail: cuts at the first "." or "::" after the last "/", which is exact for Go and
 * coarse for Java or Rust (whole top-level namespace); use frame metadata from ingest if that matters.
 */
export const packageOf = (name: string): string => {
  const start = name.lastIndexOf("/") + 1;
  const cut = name.slice(start).search(/\.|::/);
  return cut > 0 ? name.slice(0, start + cut) : name;
};

/** A stable index into a palette of `size` colours for a frame name. */
export const paletteIndexFor = (name: string, size: number): number => {
  const key = packageOf(name);
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash << 5) - hash + key.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) % size;
};
