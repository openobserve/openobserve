// Copyright 2026 OpenObserve Inc.
// Product names for e2e assertions, read from the app's one source so tests hold no copy.

import fs from "fs";
import path from "path";

export const BRAND = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../../web/src/locales/languages/en-US.json"),
    "utf8",
  ),
).brand;
