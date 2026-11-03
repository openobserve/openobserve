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

// Always-open menus: reka-ui opens on pointer events jsdom does not dispatch, and a spec here reads the items, not the popup.
export const dropdownStubs = {
  ODropdown: { name: "ODropdown", template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownGroup: {
    name: "ODropdownGroup",
    props: ["label"],
    template: "<div :data-group-label='label'><slot /></div>",
  },
  ODropdownSeparator: { name: "ODropdownSeparator", template: "<hr />" },
  ODropdownItem: {
    name: "ODropdownItem",
    props: ["variant", "iconLeft", "disabled"],
    emits: ["select"],
    template:
      "<button type='button' :data-variant='variant' @click=\"$emit('select')\"><slot /></button>",
  },
};

/** Renders each row's `cell-<id>` slots, which the real virtualised table does not lay out in jsdom. */
export const OTableRowsStub = {
  name: "OTable",
  props: ["data", "columns", "loading"],
  template: `
    <div data-test="otable-stub">
      <slot name="toolbar" />
      <div v-for="(row, i) in data" :key="i" data-test="otable-stub-row">
        <div v-for="col in columns" :key="col.id" :data-col="col.id">
          <slot
            :name="'cell-' + col.id"
            :row="row"
            :value="col.accessorKey ? row[col.accessorKey] : undefined"
          />
        </div>
      </div>
      <slot v-if="!data || !data.length" name="empty" />
    </div>`,
};
