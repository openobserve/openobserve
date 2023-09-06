use anyhow::{Context, Result};
use maxminddb::Reader;
use std::path::Path;
use std::sync::Arc;

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

    /// Create a new instance of MaxmindClient with path to city/country database
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
