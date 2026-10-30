// Copyright 2026 OpenObserve Inc.

import hljs from "highlight.js/lib/common";
import groovy from "highlight.js/lib/languages/groovy";
import http from "highlight.js/lib/languages/http";
import powershell from "highlight.js/lib/languages/powershell";
import properties from "highlight.js/lib/languages/properties";
import { hclLanguage } from "./hclLanguage";

// The full "highlight.js" entry ships ~190 grammars (~1 MB); these are the ones outside the common set that our content uses.
hljs.registerLanguage("groovy", groovy);
hljs.registerLanguage("http", http);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("properties", properties);
hljs.registerLanguage("hcl", hclLanguage);

export default hljs;
