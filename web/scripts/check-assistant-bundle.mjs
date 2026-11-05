#!/usr/bin/env node
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

// `vite build` runs the same check through `assistantBundlePlugin`; this runs it alone, without writing dist.
import { build } from "vite";

try {
  await build({ configFile: "vite.config.ts", logLevel: "info", build: { write: false } });
  console.log("check-assistant-bundle: ok");
} catch (err) {
  console.error(`check-assistant-bundle: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
