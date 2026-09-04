# ua_regex

`regexes.yaml` in this directory is a vendored copy of the user-agent parsing
rules from the [ua-parser / uap-core](https://github.com/ua-parser/uap-core)
project. It is consumed at runtime by the [`uaparser`](https://crates.io/crates/uaparser)
crate to identify browsers, operating systems, and devices from User-Agent
strings.

## License and attribution

The data originates from ua-parser/uap-core and is licensed under the
**Apache License, Version 2.0** — Copyright 2009 Google Inc. and the uap-core
contributors. The upstream license notice is retained in [`LICENSE`](./LICENSE)
in this directory.

- Upstream source: https://github.com/ua-parser/uap-core
- Upstream file: https://github.com/ua-parser/uap-core/blob/master/regexes.yaml
- License: https://www.apache.org/licenses/LICENSE-2.0

The vendored `regexes.yaml` corresponds to an earlier revision of the upstream
file and may differ from the current upstream version.
