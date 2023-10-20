// Copyright 2023 Zinc Labs Inc.

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

import type { App } from "vue";
import Logs from "./logs/Index.vue";
import AppMetrics from "./metrics/Index.vue";
import AppTraces from "./traces/Index.vue";

export default {
  install: (app: App, options?: any) => {
    app.component("zinc-logs", Logs);
    app.component("zinc-metrics", AppMetrics);
    app.component("zinc-traces", AppTraces);
  },
};
