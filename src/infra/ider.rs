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
use rand::{distributions::Alphanumeric, thread_rng, Rng};
use snowflake::SnowflakeIdGenerator;
use std::iter;

use super::cluster;

static mut IDER: Lazy<SnowflakeIdGenerator> =
    Lazy::new(|| unsafe { SnowflakeIdGenerator::new(1, cluster::LOCAL_NODE_ID) });

pub fn generate() -> String {
    let id = unsafe { IDER.real_time_generate() };
    format!("{}{}", id, generate_random_string(6))
}

fn generate_random_string(len: usize) -> String {
    let mut rng = thread_rng();
    iter::repeat(())
        .map(|()| rng.sample(Alphanumeric))
        .map(char::from)
        .take(len)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_id() {
        let id = generate();
        assert_ne!(id, "");
    }

    #[test]
    fn test_generate_random_string() {
        let random_string = generate_random_string(10);
        assert_eq!(random_string.len(), 10);
    }
}
