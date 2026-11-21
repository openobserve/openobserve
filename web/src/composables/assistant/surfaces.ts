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

/** The assistant's focus scope: `assistantClose` is bound only while focus is inside it. */
export const ASSISTANT_ROOT_SELECTOR = "[data-assistant-root]";

/** Every assistant surface that owns the keyboard while focused (the tray renders inside the Threads bar). */
export const ASSISTANT_SURFACES_SELECTOR = `${ASSISTANT_ROOT_SELECTOR}, [data-assistant-window], [data-test='threads-bar']`;
