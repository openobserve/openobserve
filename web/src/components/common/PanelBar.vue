<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!-- The 40 px panel header of chart panels that are not an OCard; consumers pass layout through class. -->
<template>
  <div
    class="border-border-subtle text-compact text-text-heading flex min-h-10 items-center gap-2 border-b py-1 ps-3 pe-1.5 font-semibold"
  >
    <slot />
  </div>
</template>
