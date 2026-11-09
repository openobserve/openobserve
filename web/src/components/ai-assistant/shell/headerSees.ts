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

interface StripComposer {
  chips?: readonly { kind: string; provenance?: string }[];
  images?: readonly unknown[];
}

/** True when the composer's chip strip shows the ⓘ itself, so the header must not. */
export function composerStripHoldsSees(composer: StripComposer | null): boolean {
  if (!composer) return false;
  if ((composer.images?.length ?? 0) > 0) return true;
  return (composer.chips ?? []).some((chip) => chip.kind !== "time" && chip.provenance !== "page");
}
