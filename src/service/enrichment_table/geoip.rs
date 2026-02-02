// Copyright 2025 OpenObserve Inc.
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
//
// The file re-use code snippets from https://github.com/vectordotdev/vector/blob/master/src/enrichment_tables/geoip.rs ,modified to suit openobserve needs

use std::{fs, net::IpAddr, sync::Arc, time::SystemTime};

use config::{MMDB_CITY_FILE_NAME, get_config};
#[cfg(feature = "enterprise")]
use maxminddb::geoip2::Enterprise;
use maxminddb::{
    Reader,
    geoip2::{City, ConnectionType, Isp},
};
use serde::{Deserialize, Serialize};
use vector_enrichment::{Case, Condition, IndexHandle, Table};
use vrl::value::{ObjectMap, Value};

// MaxMind GeoIP database files have a type field we can use to recognize
// specific products. If we encounter one of these two types, we look for
// ASN/ISP information; otherwise we expect to be working with a City database.
#[derive(Copy, Clone, Debug)]
#[allow(missing_docs)]
pub enum DatabaseKind {
    Asn,
    Isp,
    ConnectionType,
    City,
    #[cfg(feature = "enterprise")]
    Enterprise,
}

impl From<&str> for DatabaseKind {
    fn from(v: &str) -> Self {
        match v {
            "GeoLite2-ASN" => Self::Asn,
            "GeoIP2-ISP" => Self::Isp,
            "GeoIP2-Connection-Type" => Self::ConnectionType,
            #[cfg(feature = "enterprise")]
            "GeoIP2-Enterprise" => Self::Enterprise,
            _ => Self::City,
        }
    }
}

/// Configuration for the `geoip` enrichment table.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GeoipConfig {
    /// Path to the [MaxMind GeoIP2][geoip2] or [GeoLite2 binary city database
    /// file][geolite2] (**GeoLite2-City.mmdb**).
    ///
    /// Other databases, such as the country database, are not supported.
    ///
    /// [geoip2]: https://dev.maxmind.com/geoip/geoip2/downloadable
    /// [geolite2]: https://dev.maxmind.com/geoip/geoip2/geolite2/#Download_Access
    pub path: String,

    /// The locale to use when querying the database.
    ///
    /// MaxMind includes localized versions of some of the fields within their
    /// database, such as country name. This setting can control which of
    /// those localized versions are returned by the transform.
    ///
    /// More information on which portions of the geolocation data are
    /// localized, and what languages are available, can be found
    /// [here][locale_docs].
    ///
    /// [locale_docs]: https://support.maxmind.com/hc/en-us/articles/4414877149467-IP-Geolocation-Data#h_01FRRGRYTGZB29ERDBZCX3MR8Q
    #[serde(default = "default_locale")]
    pub locale: String,
}

fn default_locale() -> String {
    // Valid locales at the time of writing are: "de”, "en", “es”, “fr”, “ja”,
    // “pt-BR”, “ru”, and “zh-CN”.
    //
    // More information, including the up-to-date list of locales, can be found at
    // https://dev.maxmind.com/geoip/docs/databases/city-and-country?lang=en.

    // TODO: could we detect the system locale and use that as the default locale if
    // it matches one of the available locales in the dataset, and then fallback
    // to "en" otherwise?
    "en".to_string()
}

impl Default for GeoipConfig {
    fn default() -> self::GeoipConfig {
        GeoipConfig {
            path: format!(
                "{}{}",
                &get_config().common.mmdb_data_dir,
                MMDB_CITY_FILE_NAME
            ),
            locale: default_locale(),
        }
    }
}

impl GeoipConfig {
    pub fn new(name: &str) -> self::GeoipConfig {
        GeoipConfig {
            path: format!("{}{}", &get_config().common.mmdb_data_dir, name),
            locale: default_locale(),
        }
    }
}

#[derive(Clone)]
/// A struct that implements [enrichment::Table] to handle loading enrichment
/// data from a GeoIP database.
pub struct Geoip {
    config: GeoipConfig,
    dbreader: Arc<maxminddb::Reader<Vec<u8>>>,
    dbkind: DatabaseKind,
    last_modified: SystemTime,
}

impl Geoip {
    /// Creates a new GeoIP struct from the provided config.
    pub fn new(config: GeoipConfig) -> Result<Geoip, anyhow::Error> {
        let dbreader = Arc::new(Reader::open_readfile(config.path.clone())?);
        let dbkind = DatabaseKind::from(dbreader.metadata.database_type.as_str());

        // Check if we can read database with dummy Ip.
        let ip = IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED);
        let result = match dbkind {
            DatabaseKind::Asn | DatabaseKind::Isp => dbreader.lookup(ip).map(|_| ()),
            DatabaseKind::ConnectionType => dbreader.lookup(ip).map(|_| ()),
            DatabaseKind::City => dbreader.lookup(ip).map(|_| ()),
            #[cfg(feature = "enterprise")]
            DatabaseKind::Enterprise => dbreader.lookup(ip).map(|_| ()),
        };

        match result {
            // Returns Ok(None) when IP is valid but not found
            // [Changelog](https://github.com/oschwald/maxminddb-rust/blob/main/CHANGELOG.md#0260---2025-03-28)
            Ok(_) => Ok(Geoip {
                last_modified: fs::metadata(&config.path)?.modified()?,
                dbreader,
                dbkind,
                config,
            }),
            Err(error) => Err(error.into()),
        }
    }

    fn lookup(&self, ip: IpAddr, select: Option<&[String]>) -> Option<ObjectMap> {
        let mut map = ObjectMap::new();
        let mut add_field = |key: &str, value: Option<Value>| {
            if select
                .map(|fields| fields.iter().any(|field| field == key))
                .unwrap_or(true)
            {
                map.insert(key.into(), value.unwrap_or(Value::Null));
            }
        };

        macro_rules! add_field {
            ($k:expr, $v:expr) => {
                add_field($k, $v.map(Into::into))
            };
        }

        match self.dbkind {
            DatabaseKind::Asn | DatabaseKind::Isp => {
                let data = self.dbreader.lookup(ip).ok()?.decode::<Isp>().ok()??;

                add_field!("autonomous_system_number", data.autonomous_system_number);
                add_field!(
                    "autonomous_system_organization",
                    data.autonomous_system_organization
                );
                add_field!("isp", data.isp);
                add_field!("organization", data.organization);
            }
            DatabaseKind::City => {
                let data = self.dbreader.lookup(ip).ok()?.decode::<City>().ok()??;

                add_field!(
                    "city_name",
                    self.take_translation_from_names(&data.city.names)
                );

                add_field!("continent_code", data.continent.code);

                add_field!("country_code", data.country.iso_code);
                add_field!(
                    "country_name",
                    self.take_translation_from_names(&data.country.names)
                );

                add_field!("timezone", data.location.time_zone);
                add_field!("latitude", data.location.latitude);
                add_field!("longitude", data.location.longitude);
                add_field!("metro_code", data.location.metro_code);

                // last subdivision is most specific per https://github.com/maxmind/GeoIP2-java/blob/39385c6ce645374039450f57208b886cf87ade47/src/main/java/com/maxmind/geoip2/model/AbstractCityResponse.java#L96-L107
                let subdivision = data.subdivisions.last();
                add_field!(
                    "region_name",
                    subdivision.and_then(|s| self.take_translation_from_names(&s.names))
                );
                add_field!(
                    "region_code",
                    subdivision.and_then(|subdivision| subdivision.iso_code)
                );
                add_field!("postal_code", data.postal.code);
            }
            DatabaseKind::ConnectionType => {
                let data = self
                    .dbreader
                    .lookup(ip)
                    .ok()?
                    .decode::<ConnectionType>()
                    .ok()??;

                add_field!("connection_type", data.connection_type);
            }
            #[cfg(feature = "enterprise")]
            DatabaseKind::Enterprise => {
                let data = self
                    .dbreader
                    .lookup(ip)
                    .ok()?
                    .decode::<Enterprise>()
                    .ok()??;

                add_field!(
                    "city_name",
                    self.take_translation_from_names(&data.city.names)
                );

                add_field!("continent_code", data.continent.code);

                add_field!("country_code", data.country.iso_code);
                add_field!(
                    "country_name",
                    self.take_translation_from_names(&data.country.names)
                );

                add_field!("timezone", data.location.time_zone);
                add_field!("latitude", data.location.latitude);
                add_field!("longitude", data.location.longitude);
                add_field!("metro_code", data.location.metro_code);

                // last subdivision is most specific per https://github.com/maxmind/GeoIP2-java/blob/39385c6ce645374039450f57208b886cf87ade47/src/main/java/com/maxmind/geoip2/model/AbstractCityResponse.java#L96-L107
                let subdivision = data.subdivisions.last();
                add_field!(
                    "region_name",
                    subdivision.and_then(|s| self.take_translation_from_names(&s.names))
                );
                add_field!(
                    "region_code",
                    subdivision.and_then(|subdivision| subdivision.iso_code)
                );
                add_field!("postal_code", data.postal.code);

                add_field!("registered_country_code", data.registered_country.iso_code);
                add_field!(
                    "registered_country_name",
                    self.take_translation_from_names(&data.registered_country.names)
                );

                add_field!(
                    "represented_country_code",
                    data.represented_country.iso_code
                );
                add_field!(
                    "represented_country_name",
                    self.take_translation_from_names(&data.represented_country.names)
                );

                add_field!(
                    "autonomous_system_number",
                    data.traits.autonomous_system_number
                );
                add_field!(
                    "autonomous_system_organization",
                    data.traits.autonomous_system_organization
                );
                add_field!("isp", data.traits.isp);
                add_field!("organization", data.traits.organization);
                add_field!("connection_type", data.traits.connection_type);
                add_field!("user_type", data.traits.user_type);
                add_field!("mobile_country_code", data.traits.mobile_country_code);
                add_field!("mobile_network_code", data.traits.mobile_network_code);
                add_field!("domain", data.traits.domain);
            }
        }

        Some(map)
    }

    fn take_translation_from_names<'a>(
        &self,
        names: &maxminddb::geoip2::Names<'a>,
    ) -> Option<&'a str> {
        match self.config.locale.as_str() {
            "en" => names.english,
            "es" => names.spanish,
            "fr" => names.french,
            "de" => names.german,
            "ja" => names.japanese,
            "pt-BR" => names.brazilian_portuguese,
            "ru" => names.russian,
            "zh-CN" => names.simplified_chinese,
            _ => names.english, // fallback to English
        }
    }
}

impl Table for Geoip {
    /// Search the enrichment table data with the given condition.
    /// All conditions must match (AND).
    ///
    /// # Errors
    /// Errors if no rows, or more than 1 row is found.
    fn find_table_row<'a>(
        &self,
        case: Case,
        condition: &'a [Condition<'a>],
        select: Option<&[String]>,
        _wildcard: Option<&Value>, // Use not known yet
        index: Option<IndexHandle>,
    ) -> Result<ObjectMap, String> {
        let mut rows = self.find_table_rows(case, condition, select, _wildcard, index)?;

        match rows.pop() {
            Some(row) if rows.is_empty() => Ok(row),
            Some(_) => Err("More than 1 row found".to_string()),
            None => Err("IP not found".to_string()),
        }
    }

    /// Search the enrichment table data with the given condition.
    /// All conditions must match (AND).
    /// Can return multiple matched records
    fn find_table_rows<'a>(
        &self,
        _: Case,
        condition: &'a [Condition<'a>],
        select: Option<&[String]>,
        _wildcard: Option<&Value>, // Use not known yet
        _: Option<IndexHandle>,
    ) -> Result<Vec<ObjectMap>, String> {
        match condition.first() {
            Some(_) if condition.len() > 1 => Err("Only one condition is allowed".to_string()),
            Some(Condition::Equals { value, .. }) => {
                let ip = value
                    .to_string_lossy()
                    .parse::<IpAddr>()
                    .map_err(|_| "Invalid IP address".to_string())?;
                Ok(self
                    .lookup(ip, select)
                    .map(|values| vec![values])
                    .unwrap_or_default())
            }
            Some(_) => Err("Only equality condition is allowed".to_string()),
            None => Err("IP condition must be specified".to_string()),
        }
    }

    /// Hints to the enrichment table what data is going to be searched to allow
    /// it to index the data in advance.
    ///
    /// # Errors
    /// Errors if the fields are not in the table.
    fn add_index(&mut self, _: Case, fields: &[&str]) -> Result<IndexHandle, String> {
        match fields.len() {
            0 => Err("IP field is required".to_string()),
            1 => Ok(IndexHandle(0)),
            _ => Err("Only one field is allowed".to_string()),
        }
    }

    /// Returns a list of the field names that are in each index
    fn index_fields(&self) -> Vec<(Case, Vec<String>)> {
        Vec::new()
    }

    /// Returns true if the underlying data has changed and the table needs
    /// reloading.
    fn needs_reload(&self) -> bool {
        matches!(fs::metadata(&self.config.path)
            .and_then(|metadata| metadata.modified()),
            Ok(modified) if modified > self.last_modified)
    }
}

impl std::fmt::Debug for Geoip {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Geoip {} database {})",
            self.config.locale, self.config.path
        )
    }
}

#[cfg(test)]
mod tests {

    use super::*;

    #[test]
    fn test_database_kind_from_str() {
        match DatabaseKind::from("GeoLite2-ASN") {
            DatabaseKind::Asn => {}
            _ => panic!("Expected DatabaseKind::Asn for 'GeoLite2-ASN'"),
        }

        match DatabaseKind::from("GeoIP2-ISP") {
            DatabaseKind::Isp => {}
            _ => panic!("Expected DatabaseKind::Isp for 'GeoIP2-ISP'"),
        }

        match DatabaseKind::from("GeoIP2-Connection-Type") {
            DatabaseKind::ConnectionType => {}
            _ => panic!("Expected DatabaseKind::ConnectionType for 'GeoIP2-Connection-Type'"),
        }

        #[cfg(feature = "enterprise")]
        match DatabaseKind::from("GeoIP2-Enterprise") {
            DatabaseKind::Enterprise => {}
            _ => panic!("Expected DatabaseKind::Enterprise for 'GeoIP2-Enterprise'"),
        }

        match DatabaseKind::from("GeoLite2-City") {
            DatabaseKind::City => {}
            _ => panic!("Expected DatabaseKind::City for 'GeoLite2-City'"),
        }

        match DatabaseKind::from("Unknown-Type") {
            DatabaseKind::City => {}
            _ => panic!("Expected DatabaseKind::City for 'Unknown-Type'"),
        }
    }

    #[test]
    fn test_default_locale() {
        assert_eq!(default_locale(), "en");
    }

    #[test]
    fn test_geoip_config_default() {
        let config = GeoipConfig::default();
        assert_eq!(config.locale, "en");
        assert!(config.path.contains("GeoLite2-City.mmdb"));
    }

    #[test]
    fn test_geoip_config_new() {
        let config = GeoipConfig::new("test.mmdb");
        assert_eq!(config.locale, "en");
        assert!(config.path.contains("test.mmdb"));
    }

    #[test]
    fn test_geoip_config_equality() {
        let config1 = GeoipConfig {
            path: "/test/path.mmdb".to_string(),
            locale: "en".to_string(),
        };

        let config2 = GeoipConfig {
            path: "/test/path.mmdb".to_string(),
            locale: "en".to_string(),
        };

        let config3 = GeoipConfig {
            path: "/different/path.mmdb".to_string(),
            locale: "en".to_string(),
        };

        assert_eq!(config1, config2);
        assert_ne!(config1, config3);
    }

    #[test]
    fn test_geoip_config_clone() {
        let config = GeoipConfig {
            path: "/test/path.mmdb".to_string(),
            locale: "en".to_string(),
        };

        let cloned = config.clone();
        assert_eq!(config, cloned);
    }

    #[test]
    fn test_geoip_config_serialization() {
        let config = GeoipConfig {
            path: "/test/path.mmdb".to_string(),
            locale: "fr".to_string(),
        };

        let serialized = serde_json::to_string(&config).unwrap();
        let deserialized: GeoipConfig = serde_json::from_str(&serialized).unwrap();

        assert_eq!(config.path, deserialized.path);
        assert_eq!(config.locale, deserialized.locale);
    }

    #[test]
    fn test_geoip_new_with_invalid_path() {
        let config = GeoipConfig {
            path: "/nonexistent/path.mmdb".to_string(),
            locale: "en".to_string(),
        };

        let result = Geoip::new(config);
        assert!(result.is_err());
    }
}
