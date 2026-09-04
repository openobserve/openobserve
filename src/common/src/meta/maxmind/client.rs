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

use std::{path::Path, sync::Arc};

use anyhow::{Context, Result};
use maxminddb::Reader;

#[derive(Clone)]
pub struct MaxmindClient {
    pub city_reader: Arc<Reader<Vec<u8>>>,
}

impl MaxmindClient {
    /// Create a new instance of MaxmindClient
    pub fn new_with_reader(city_reader: Reader<Vec<u8>>) -> Self {
        Self {
            city_reader: Arc::new(city_reader),
        }
    }

    /// Create a new instance of MaxmindClient with path to city/country
    /// database
    pub fn new_with_path<T: AsRef<Path>>(city_database: T) -> Result<MaxmindClient> {
        let city_reader: Reader<Vec<u8>> =
            Reader::open_readfile(&city_database).with_context(|| {
                format!(
                    "Failed to find city-database from path {:?}",
                    city_database.as_ref()
                )
            })?;
        Ok(MaxmindClient::new_with_reader(city_reader))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_with_path_nonexistent_returns_error() {
        let result = MaxmindClient::new_with_path("/nonexistent/path/city.mmdb");
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(err.to_string().contains("Failed to find city-database"));
    }

    #[test]
    fn test_new_with_path_empty_path_returns_error() {
        let result = MaxmindClient::new_with_path("");
        assert!(result.is_err());
    }
}
