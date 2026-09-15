// Copyright 2026 OpenObserve Inc.

import "vue-router";

declare module "vue-router" {
  interface RouteMeta {
    allowOnEmptyData?: boolean;
  }
}
