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

import { describe, it } from "vitest";

// TODO: Table.vue was removed during the Quasar UI framework migration.
// Source file `src/components/shared/grid/Table.vue` no longer exists.
// These tests need to be rewritten against the new replacement component
// (or deleted if no longer applicable).
describe.skip("Table", () => {
  describe("initial render", () => {
    it.skip("should mount without errors", () => {});

    it.skip("should render the q-table stub", () => {});

    it.skip("should render the Add Ticket button in the top-right slot", () => {});

    it.skip("should render a search input in the top-right slot", () => {});
  });

  describe("initial state", () => {
    it.skip("should initialise tickets as an empty array", () => {});

    it.skip("should initialise filterQuery as an empty string", () => {});

    it.skip("should initialise pagination as an empty object", () => {});
  });

  describe("filterData", () => {
    it.skip("should return the rows array unchanged", () => {});

    it.skip("should return an empty array when given an empty array", () => {});

    it.skip("should return rows with the same reference (no transformation)", () => {});
  });

  describe("editTicket", () => {
    it.skip("should not throw when called without arguments", () => {});

    it.skip("should not throw when called with a props argument", () => {});
  });

  describe("addTicket", () => {
    it.skip("should not throw when called", () => {});
  });

  describe("i18n", () => {
    it.skip("should show the Add Ticket label from i18n", () => {});

    it.skip("should set the search input placeholder from i18n", () => {});
  });
});
