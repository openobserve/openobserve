// Copyright 2023 Zinc Labs Inc.
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

use once_cell::sync::Lazy;
use snowflake::SnowflakeIdGenerator;

use super::cluster;
use crate::utils::rand::generate_random_string;

static mut IDER: Lazy<SnowflakeIdGenerator> =
    Lazy::new(|| unsafe { SnowflakeIdGenerator::new(1, cluster::LOCAL_NODE_ID) });

pub fn init() -> Result<(), anyhow::Error> {
    _ = generate();
    Ok(())
}

pub fn generate() -> String {
    let id = unsafe { IDER.real_time_generate() };
    format!("{}{}", id, generate_random_string(6))
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
