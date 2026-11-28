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

use std::{net::IpAddr, path::Path, sync::Arc};

use anyhow::{Context, Result};
use maxminddb::{
    Reader,
    geoip2::{City, city::Location},
};
use serde::{Deserialize, Serialize};

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

    /// The `geo_info` RUM and audit rows carry; `None` when the City DB has no record for `ip`.
    pub fn city_geo_info(&self, ip: IpAddr) -> Option<GeoInfoData<'_>> {
        let city = self.city_reader.lookup(ip).ok()?.decode::<City>().ok()??;
        Some(GeoInfoData {
            city: city.city.names.english,
            country: city.country.names.english,
            country_iso_code: city.country.iso_code,
            location: Some(city.location),
        })
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct GeoInfoData<'a> {
    pub city: Option<&'a str>,
    pub country: Option<&'a str>,
    pub country_iso_code: Option<&'a str>,
    pub location: Option<Location<'a>>,
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

    #[test]
    fn test_geo_info_data_creation_and_properties() {
        let geo_info = GeoInfoData {
            city: Some("New York"),
            country: Some("United States"),
            country_iso_code: Some("US"),
            location: None,
        };

        assert_eq!(geo_info.city, Some("New York"));
        assert_eq!(geo_info.country, Some("United States"));
        assert_eq!(geo_info.country_iso_code, Some("US"));
        assert!(geo_info.location.is_none());
    }
}
