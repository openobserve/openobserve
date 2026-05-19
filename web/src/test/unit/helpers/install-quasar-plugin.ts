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

// TODO: REMOVE THIS FILE when unit tests are rewritten.
// Quasar has been removed as a dependency. This helper no longer installs
// Quasar — it only provides layout injections. All references to
// tempQuasarPlugin() in spec files should be replaced with direct
// qLayoutInjections() calls during the test rewrite.

import { config } from "@vue/test-utils";
import { cloneDeep } from "lodash-es";
import { qLayoutInjections } from "./layout-injections";
import { beforeAll, afterAll } from "vitest";

export function tempQuasarPlugin() {
  const globalConfigBackup = cloneDeep(config.global);

  beforeAll(() => {
    config.global.provide = {
      ...config.global.provide,
      ...qLayoutInjections(),
    };
  });

  afterAll(() => {
    config.global = globalConfigBackup;
  });
}
