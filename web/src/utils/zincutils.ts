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

export * from "@/utils/auth";
export * from "@/utils/storage";
export * from "@/utils/formatters";
export * from "@/utils/timezone";
export * from "@/utils/uuid";
export * from "@/utils/queryUtils";

// CI-TEST-PX: scenario 4 — px in a plain string literal
export const __ciTestPxString = "16px";
// CI-TEST-PX: scenario 5 — px inside a template literal
export const __ciTestPxTemplate = `margin: 8px auto`;
