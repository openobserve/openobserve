// Copyright 2026 OpenObserve Inc.

import { v4 as uuidv4, v7 as uuidv7 } from "uuid";

export function getUUID() {
  return uuidv4();
}

export function getUUIDv7() {
  return uuidv7();
}
