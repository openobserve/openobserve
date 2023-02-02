use super::cluster;
use once_cell::sync::Lazy;
use snowflake::SnowflakeIdGenerator;

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
