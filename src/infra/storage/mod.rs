use async_trait::async_trait;
use bytes::Bytes;
use chrono::{TimeZone, Utc};

use crate::{common::utils::is_local_disk_storage, infra::ider, meta::StreamType};

pub mod local;
pub mod s3;

#[async_trait]
pub trait FileStorage: Sync + 'static {
    async fn list(&self, prefix: &str) -> Result<Vec<String>, anyhow::Error>;
    async fn get(&self, file: &str) -> Result<Bytes, anyhow::Error>;
    async fn put(&self, file: &str, data: Bytes) -> Result<(), anyhow::Error>;
    async fn del(&self, file: &str) -> Result<(), anyhow::Error>;
}

lazy_static! {
    pub static ref DEFAULT: Box<dyn FileStorage> = default();
}

pub fn default() -> Box<dyn FileStorage> {
    match is_local_disk_storage() {
        true => Box::new(local::Local {}),
        false => Box::new(s3::S3 {}),
    }
}

pub fn generate_partioned_file_key(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    min_ts: i64,
    extn: &str,
) -> (std::string::String, std::string::String) {
    let id = ider::generate();
    let time = Utc.timestamp_nanos(min_ts * 1000);

    let prefix = if stream_type.eq(&StreamType::Metadata) {
        time.format("%Y/00/00/00").to_string()
    } else {
        time.format("%Y/%m/%d/%H").to_string()
    };
    (
        format!("{}/{}/{}/{}/", org_id, stream_type, stream_name, prefix),
        format!("{}{}", id, extn),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::config::CONFIG;
    #[test]
    fn test_generate_partioned_file_key() {
        let file_key = generate_partioned_file_key(
            "org",
            "stream_name",
            StreamType::Logs,
            1665580243211047,
            &CONFIG.common.file_ext_parquet,
        );
        assert_eq!(file_key.0.as_str(), "org/logs/stream_name/2022/10/12/13/");
        assert!(file_key.1.as_str().contains(".parquet"));
    }
}
