// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use once_cell::sync::Lazy;
use snowflake::SnowflakeIdGenerator;

use super::cluster;

static mut IDER: Lazy<SnowflakeIdGenerator> =
    Lazy::new(|| unsafe { SnowflakeIdGenerator::new(1, cluster::LOCAL_NODE_ID) });

pub fn generate() -> String {
    let id = unsafe { IDER.real_time_generate() };
    id.to_string()
}

#[cfg(test)]
mod test_utils {
    use super::*;
    #[test]
    fn test_generate_id() {
        let id = generate();
        assert_ne!(id, "");
    }
}
