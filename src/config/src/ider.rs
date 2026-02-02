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

use std::{
    hint::spin_loop,
    sync::{LazyLock, atomic::Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use parking_lot::Mutex;
use rand::Rng;
use svix_ksuid::{Ksuid, KsuidLike};
use uuid::Uuid;

static IDER: LazyLock<Mutex<SnowflakeIdGenerator>> = LazyLock::new(|| {
    let machine_id = super::cluster::LOCAL_NODE_ID.load(Ordering::Relaxed);
    log::info!("init ider with machine_id: {machine_id}");
    Mutex::new(SnowflakeIdGenerator::new(machine_id))
});

/// Cached base timestamp in microseconds for UUID v7 validation.
/// Initialized once on first use to avoid repeated syscalls.
static BASE_TIMESTAMP_MICROS: LazyLock<i64> = LazyLock::new(|| {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_micros() as i64
});
// 10 years in microseconds: 10 * 365.25 * 24 * 60 * 60 * 1_000_000
const TEN_YEARS_MICROS: i64 = 315_576_000_000_000;

pub fn init() {
    _ = generate();
    _ = BASE_TIMESTAMP_MICROS;
}

pub fn reload_machine_id() {
    let machine_id = super::cluster::LOCAL_NODE_ID.load(Ordering::Relaxed);
    log::info!("init ider with machine_id: {machine_id}");
    let new_ider = SnowflakeIdGenerator::new(machine_id);
    let mut w = IDER.lock();
    _ = std::mem::replace(&mut *w, new_ider);
}

/// Generate a distributed unique id with snowflake.
pub fn generate() -> String {
    IDER.lock().real_time_generate().to_string()
}

/// Generate a unique id like uuid.
pub fn uuid() -> String {
    Ksuid::new(None, None).to_string()
}

/// Generate a unique id like uuid for file name.
pub fn generate_file_name() -> String {
    let id = generate();
    let rand_str = format!("{:04x}", rand::random::<u16>());
    id + rand_str.as_str()
}

/// Generate a new trace_id using UUID v7.
pub fn generate_trace_id() -> String {
    // Generate UUID v7 (time-ordered UUID)
    let uuid_v7 = Uuid::now_v7();

    // Convert UUID to 128-bit integer and then to OpenTelemetry TraceId
    let trace_id = uuid_v7.as_u128();
    opentelemetry::trace::TraceId::from(trace_id).to_string()
}

/// Extract timestamp from UUID v7 trace ID
/// Returns the timestamp in microseconds since Unix epoch, or None if parsing fails
pub fn get_start_time_from_trace_id(trace_id: &str) -> Option<i64> {
    // First, convert the hex string back to UUID format if needed
    let uuid_str = if trace_id.len() == 32 {
        // Convert from hex format (32 chars) to UUID format (with hyphens)
        format!(
            "{}-{}-{}-{}-{}",
            &trace_id[0..8],
            &trace_id[8..12],
            &trace_id[12..16],
            &trace_id[16..20],
            &trace_id[20..32]
        )
    } else {
        trace_id.to_string()
    };

    // Parse the UUID and extract timestamp
    if let Ok(uuid) = Uuid::parse_str(&uuid_str) {
        // Check if it's actually a UUID v7
        if uuid.get_version() == Some(uuid::Version::SortRand) {
            if let Some(timestamp) = uuid.get_timestamp() {
                // Convert to microseconds: seconds * 1_000_000 + nanoseconds / 1_000
                let (seconds, nanoseconds) = timestamp.to_unix();
                let timestamp_micros = (seconds * 1_000_000 + nanoseconds as u64 / 1_000) as i64;

                // Validate timestamp is reasonable:
                // - Should be within +/- 10 years from base time (when module was loaded)
                // This allows for some clock skew and future-dated traces while rejecting clearly
                // invalid timestamps
                let min_timestamp = BASE_TIMESTAMP_MICROS.saturating_sub(TEN_YEARS_MICROS);
                let max_timestamp = BASE_TIMESTAMP_MICROS.saturating_add(TEN_YEARS_MICROS);

                if timestamp_micros >= min_timestamp && timestamp_micros <= max_timestamp {
                    Some(timestamp_micros)
                } else {
                    None // Timestamp is out of reasonable range
                }
            } else {
                None // No timestamp available
            }
        } else {
            None // Not a UUID v7
        }
    } else {
        None // Failed to parse as UUID
    }
}

/// Generate a new span_id.
pub fn generate_span_id() -> String {
    let mut rng = rand::rng();
    let mut bytes = [0u8; 8];
    rng.fill(&mut bytes);

    let hex = hex::encode(bytes);

    if hex == "0000000000000000" {
        return generate_span_id();
    }

    hex
}

/// Convert a snowflake id to a timestamp in milliseconds.
pub fn to_timestamp_millis(id: i64) -> i64 {
    id >> 22
}

/// The `SnowflakeIdGenerator` type is snowflake algorithm wrapper.
#[derive(Copy, Clone, Debug)]
pub struct SnowflakeIdGenerator {
    /// epoch used by the snowflake algorithm.
    epoch: SystemTime,

    /// last_time_millis, last time generate id is used times millis.
    last_time_millis: i64,

    /// machine_id, is use to supplement id machine or sectionalization attribute.
    pub machine_id: i32,

    /// auto-increment record.
    idx: u16,
}

/// The `SnowflakeIdBucket` type is snowflake-id-bucket it easy to get id also have a id buffer.
#[derive(Clone, Debug)]
pub struct SnowflakeIdBucket {
    /// Hidden the `SnowflakeIdGenerator` in bucket .
    snowflake_id_generator: SnowflakeIdGenerator,

    /// The bucket buffer;
    bucket: Vec<i64>,
}

impl SnowflakeIdGenerator {
    /// Constructs a new `SnowflakeIdGenerator` using the UNIX epoch.
    /// Please make sure that machine_id is small than 1024(2^10);
    pub fn new(machine_id: i32) -> SnowflakeIdGenerator {
        let epoch = UNIX_EPOCH;
        let last_time_millis = get_time_millis(epoch);
        SnowflakeIdGenerator {
            epoch,
            last_time_millis,
            machine_id,
            idx: 0,
        }
    }

    /// The real_time_generate keep id generate time is eq call method time.
    pub fn real_time_generate(&mut self) -> i64 {
        self.idx = (self.idx + 1) % 4096;

        let mut now_millis = get_time_millis(self.epoch);

        // supplement code for 'clock is moving backwards situation'.

        // If the milliseconds of the current clock are equal to
        // the number of milliseconds of the most recently generated id,
        // then check if enough 4096 are generated,
        // if enough then busy wait until the next millisecond.
        if now_millis == self.last_time_millis {
            if self.idx == 0 {
                now_millis = biding_time_conditions(self.last_time_millis, self.epoch);
                self.last_time_millis = now_millis;
            }
        } else {
            self.last_time_millis = now_millis;
            self.idx = 0;
        }

        // last_time_millis is 64 bits, left shift 22 bit, store 42 bits, machine_id left shift 12
        // bits, idx complementing bits.
        (self.last_time_millis << 22) | ((self.machine_id << 12) as i64) | (self.idx as i64)
    }

    /// The basic guarantee time punctuality.
    ///
    /// Basic guarantee time punctuality.
    /// sometimes one millis can't use up 4096 ID, the property of the ID isn't real-time.
    /// But setting time after every 4096 calls.
    pub fn generate(&mut self) -> i64 {
        self.idx = (self.idx + 1) % 4096;

        // Maintenance `last_time_millis` for every 4096 ids generated.
        if self.idx == 0 {
            let mut now_millis = get_time_millis(self.epoch);

            if now_millis == self.last_time_millis {
                now_millis = biding_time_conditions(self.last_time_millis, self.epoch);
                if now_millis == self.last_time_millis {
                    panic!("Clock is moving backwards.  Rejecting requests until {now_millis}.");
                }
            }

            self.last_time_millis = now_millis;
        }

        // last_time_millis is 64 bits, left shift 22 bit, store 42 bits, machine_id left shift 12
        // bits, idx complementing bits.
        (self.last_time_millis << 22) | ((self.machine_id << 12) as i64) | (self.idx as i64)
    }

    /// The lazy generate.
    ///
    /// Lazy generate.
    /// Just start time record last_time_millis it consume every millis ID.
    /// Maybe faster than standing time.
    pub fn lazy_generate(&mut self) -> i64 {
        self.idx = (self.idx + 1) % 4096;

        if self.idx == 0 {
            self.last_time_millis += 1;
        }

        // last_time_millis is 64 bits, left shift 22 bit, store 42 bits, machine_id left shift 12
        // bits, idx complementing bits.
        (self.last_time_millis << 22) | ((self.machine_id << 12) as i64) | (self.idx as i64)
    }
}

impl SnowflakeIdBucket {
    /// Constructs a new `SnowflakeIdBucket` using the UNIX epoch.
    /// Please make sure that machine_id is small than 1024(2^10);
    pub fn new(machine_id: i32) -> Self {
        let snowflake_id_generator = SnowflakeIdGenerator::new(machine_id);
        let bucket = Vec::new();

        SnowflakeIdBucket {
            snowflake_id_generator,
            bucket,
        }
    }

    pub fn get_id(&mut self) -> i64 {
        if self.bucket.is_empty() {
            self.generate_ids();
            self.bucket.reverse();
        }
        self.bucket.pop().unwrap()
    }

    fn generate_ids(&mut self) {
        for _ in 0..4091 {
            self.bucket
                .push(self.snowflake_id_generator.lazy_generate());
        }
    }
}

#[inline(always)]
/// Get the latest milliseconds of the clock.
pub fn get_time_millis(epoch: SystemTime) -> i64 {
    SystemTime::now()
        .duration_since(epoch)
        .expect("Time went backward")
        .as_millis() as i64
}

#[inline(always)]
// Constantly refreshing the latest milliseconds by busy waiting.
fn biding_time_conditions(last_time_millis: i64, epoch: SystemTime) -> i64 {
    let mut latest_time_millis: i64;
    loop {
        latest_time_millis = get_time_millis(epoch);
        if latest_time_millis > last_time_millis {
            return latest_time_millis;
        }
        spin_loop();
    }
}

#[cfg(test)]
mod tests {

    use chrono::TimeZone;

    use super::*;

    #[test]
    fn test_generate_trace_id_basic() {
        let trace_id = generate_trace_id();

        // Basic format validation
        assert_eq!(trace_id.len(), 32, "Trace ID should be 32 characters long");
        assert!(
            trace_id.chars().all(|c| c.is_ascii_hexdigit()),
            "Trace ID should contain only hex characters"
        );
        assert_ne!(
            trace_id, "00000000000000000000000000000000",
            "Trace ID should not be all zeros"
        );

        // Should be parseable as OpenTelemetry TraceId
        assert!(
            opentelemetry::trace::TraceId::from_hex(&trace_id).is_ok(),
            "Should be valid OpenTelemetry TraceId"
        );
    }

    #[test]
    fn test_generate_trace_id_uuid_v7() {
        let trace_id1 = generate_trace_id();
        let trace_id2 = generate_trace_id();

        // Trace IDs should be unique
        assert_ne!(trace_id1, trace_id2, "Generated trace IDs should be unique");

        // Trace IDs should be 32 characters long (16 bytes in hex)
        assert_eq!(trace_id1.len(), 32, "Trace ID should be 32 characters long");
        assert_eq!(trace_id2.len(), 32, "Trace ID should be 32 characters long");

        // Trace IDs should be valid hex
        assert!(
            trace_id1.chars().all(|c| c.is_ascii_hexdigit()),
            "Trace ID should contain only hex characters"
        );
        assert!(
            trace_id2.chars().all(|c| c.is_ascii_hexdigit()),
            "Trace ID should contain only hex characters"
        );

        // Trace IDs should not be all zeros
        assert_ne!(
            trace_id1, "00000000000000000000000000000000",
            "Trace ID should not be all zeros"
        );
        assert_ne!(
            trace_id2, "00000000000000000000000000000000",
            "Trace ID should not be all zeros"
        );

        // Verify they can be parsed as OpenTelemetry TraceIds
        assert!(
            opentelemetry::trace::TraceId::from_hex(&trace_id1).is_ok(),
            "Should be valid OpenTelemetry TraceId"
        );
        assert!(
            opentelemetry::trace::TraceId::from_hex(&trace_id2).is_ok(),
            "Should be valid OpenTelemetry TraceId"
        );

        // Verify they are actually UUID v7 by converting back to UUID format and checking version
        let uuid_str1 = format!(
            "{}-{}-{}-{}-{}",
            &trace_id1[0..8],
            &trace_id1[8..12],
            &trace_id1[12..16],
            &trace_id1[16..20],
            &trace_id1[20..32]
        );
        let uuid_str2 = format!(
            "{}-{}-{}-{}-{}",
            &trace_id2[0..8],
            &trace_id2[8..12],
            &trace_id2[12..16],
            &trace_id2[16..20],
            &trace_id2[20..32]
        );

        let uuid1 = Uuid::parse_str(&uuid_str1).unwrap();
        let uuid2 = Uuid::parse_str(&uuid_str2).unwrap();

        assert_eq!(
            uuid1.get_version(),
            Some(uuid::Version::SortRand),
            "Should be UUID v7"
        );
        assert_eq!(
            uuid2.get_version(),
            Some(uuid::Version::SortRand),
            "Should be UUID v7"
        );
    }

    #[test]
    fn test_get_start_time_from_trace_id_valid_cases() {
        // Test with a generated UUID v7 trace ID (hex format)
        let trace_id = generate_trace_id();
        let timestamp = get_start_time_from_trace_id(&trace_id);

        // Should successfully extract timestamp
        assert!(
            timestamp.is_some(),
            "Should extract timestamp from valid UUID v7"
        );
        let timestamp = timestamp.unwrap();

        // Timestamp should be reasonable (not too far in past or future)
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_micros() as i64;

        // Allow for some tolerance (within last hour and next hour)
        assert!(
            timestamp >= now - 3600_000_000,
            "Timestamp should not be too far in past"
        );
        assert!(
            timestamp <= now + 3600_000_000,
            "Timestamp should not be too far in future"
        );

        // Test with UUID v7 in standard format (with hyphens)
        let uuid_v7_standard = Uuid::now_v7().to_string();
        let standard_result = get_start_time_from_trace_id(&uuid_v7_standard);
        assert!(
            standard_result.is_some(),
            "Should extract timestamp from standard UUID v7 format"
        );

        // Verify both formats give reasonable timestamps
        let standard_timestamp = standard_result.unwrap();
        assert!(standard_timestamp >= now - 3600_000_000);
        assert!(standard_timestamp <= now + 3600_000_000);
    }

    #[test]
    fn test_get_start_time_from_trace_id_invalid_cases() {
        // Test with invalid UUID string
        let invalid_result = get_start_time_from_trace_id("invalid-uuid");
        assert!(
            invalid_result.is_none(),
            "Should return None for invalid UUID string"
        );

        // Test with empty string
        let empty_result = get_start_time_from_trace_id("");
        assert!(
            empty_result.is_none(),
            "Should return None for empty string"
        );

        // Test with too short string
        let short_result = get_start_time_from_trace_id("123");
        assert!(
            short_result.is_none(),
            "Should return None for too short string"
        );

        // Test with too long string
        let long_result = get_start_time_from_trace_id("1234567890123456789012345678901234567890");
        assert!(
            long_result.is_none(),
            "Should return None for too long string"
        );

        // Test with UUID v4 (should return None)
        let uuid_v4 = Uuid::new_v4().to_string().replace('-', "");
        let v4_result = get_start_time_from_trace_id(&uuid_v4);
        assert!(v4_result.is_none(), "Should return None for UUID v4");

        // Test with UUID v1 (should return None) - using a known v1 UUID
        let uuid_v1_str = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // Known UUID v1
        let v1_result = get_start_time_from_trace_id(&uuid_v1_str.replace('-', ""));
        assert!(v1_result.is_none(), "Should return None for UUID v1");

        // Test with non-hex characters
        let non_hex_result = get_start_time_from_trace_id("gggggggggggggggggggggggggggggggg");
        assert!(
            non_hex_result.is_none(),
            "Should return None for non-hex characters"
        );

        // Test with trace_id that parses as UUID but has invalid timestamp
        // This specific trace_id can be parsed as a UUID but the extracted timestamp is invalid
        let invalid_timestamp_result =
            get_start_time_from_trace_id("dcada199d60f72d202bdcf69a0cd7c8c");
        assert!(
            invalid_timestamp_result.is_none(),
            "Should return None for trace_id with invalid timestamp range"
        );
    }

    #[test]
    fn test_get_start_time_from_trace_id_valid_uuid_v7() {
        // This is a known valid UUID v7 trace_id that should successfully extract timestamp
        // Original format: 019BA22B-DCFB-78A4-84F8-4F8F530BBFBA
        // OpenTelemetry trace_id format (32 hex chars, no hyphens, lowercase)
        let trace_id = "019ba22bdcfb78a484f84f8f530bbfba";

        // Should successfully extract a timestamp
        let result = get_start_time_from_trace_id(trace_id);
        assert!(
            result.is_some(),
            "Should extract timestamp from valid UUID v7 trace_id: {}",
            trace_id
        );

        // Convert to human-readable date for verification
        let timestamp_micros = result.unwrap();
        let timestamp_secs = timestamp_micros / 1_000_000;
        let datetime = chrono::DateTime::from_timestamp(timestamp_secs, 0).unwrap();

        // Log the extracted timestamp for manual verification
        println!(
            "Extracted timestamp from {}: {} microseconds ({} UTC)",
            trace_id, timestamp_micros, datetime
        );
    }

    #[test]
    fn test_get_start_time_from_trace_id_time_ordering() {
        // Generate two UUID v7s with a small delay to ensure different timestamps
        let trace_id1 = generate_trace_id();
        std::thread::sleep(std::time::Duration::from_millis(1));
        let trace_id2 = generate_trace_id();

        let timestamp1 = get_start_time_from_trace_id(&trace_id1).unwrap();
        let timestamp2 = get_start_time_from_trace_id(&trace_id2).unwrap();

        // Timestamp2 should be greater than timestamp1 (time ordering)
        assert!(
            timestamp2 > timestamp1,
            "UUID v7 timestamps should be time-ordered"
        );

        // The difference should be reasonable (at least 1ms = 1000 microseconds)
        let diff = timestamp2 - timestamp1;
        assert!(diff >= 1000, "Time difference should be at least 1ms");
    }

    #[test]
    fn test_ider_to_timestamp_millis() {
        let data = [
            (7232450184620358447, "2024-08-22"),
            (7317509042887196698, "2025-04-14"),
        ];
        for (id, ts) in data {
            let id_ts = to_timestamp_millis(id);
            let t = chrono::Utc.timestamp_nanos(id_ts * 1000_000);
            let td = t.format("%Y-%m-%d").to_string();
            assert_eq!(td, ts.to_string());
        }
    }

    #[test]
    fn test_generate() {
        let id1 = generate();
        let id2 = generate();
        assert_ne!(id1, id2, "Generated IDs should be unique");
        assert!(
            id1.parse::<i64>().is_ok(),
            "Generated ID should be a valid i64"
        );
    }

    #[test]
    fn test_uuid() {
        let uuid1 = uuid();
        let uuid2 = uuid();
        assert_ne!(uuid1, uuid2, "Generated UUIDs should be unique");
        assert_eq!(uuid1.len(), 27, "KSUID should be 27 characters long");
    }

    #[test]
    fn test_generate_span_id() {
        let span_id1 = generate_span_id();
        let span_id2 = generate_span_id();

        // Uniqueness
        assert_ne!(span_id1, span_id2, "Generated span IDs should be unique");

        // Format validation
        assert_eq!(
            span_id1.len(),
            16,
            "Span ID should be 16 characters long (8 bytes in hex)"
        );
        assert!(
            span_id1.chars().all(|c| c.is_ascii_hexdigit()),
            "Span ID should contain only hex characters"
        );

        // Should not be all zeros (this is tested in the function itself with recursion)
        assert_ne!(
            span_id1, "0000000000000000",
            "Span ID should not be all zeros"
        );

        // Test multiple generations to ensure no all-zero IDs slip through
        for _ in 0..100 {
            let span_id = generate_span_id();
            assert_ne!(
                span_id, "0000000000000000",
                "Span ID should never be all zeros"
            );
            assert_eq!(span_id.len(), 16, "All span IDs should be 16 characters");
        }
    }

    #[test]
    fn test_snowflake_id_generator() {
        let mut generator = SnowflakeIdGenerator::new(1);
        let id1 = generator.real_time_generate();
        let id2 = generator.real_time_generate();

        // Uniqueness
        assert_ne!(id1, id2, "Generated snowflake IDs should be unique");

        // Test timestamp extraction
        let timestamp = to_timestamp_millis(id1);
        assert!(timestamp > 0, "Timestamp should be positive");

        // Test that IDs are monotonically increasing (time-ordered)
        assert!(id2 > id1, "Snowflake IDs should be time-ordered");

        // Test with different machine IDs
        let mut generator2 = SnowflakeIdGenerator::new(2);
        let id3 = generator2.real_time_generate();
        assert_ne!(id1, id3, "IDs from different machines should be different");
    }

    #[test]
    fn test_snowflake_id_bucket() {
        let mut bucket = SnowflakeIdBucket::new(1);
        let id1 = bucket.get_id();
        let id2 = bucket.get_id();
        assert_ne!(id1, id2, "IDs from bucket should be unique");
    }

    #[test]
    fn test_concurrent_id_generation() {
        use std::{
            sync::{
                Arc,
                atomic::{AtomicUsize, Ordering},
            },
            thread,
        };

        let count = Arc::new(AtomicUsize::new(0));
        let mut handles = vec![];
        let iterations = 1000;

        for _ in 0..4 {
            let count = Arc::clone(&count);
            handles.push(thread::spawn(move || {
                for _ in 0..iterations {
                    let _id = generate();
                    count.fetch_add(1, Ordering::SeqCst);
                }
            }));
        }

        for handle in handles {
            handle.join().unwrap();
        }

        assert_eq!(count.load(Ordering::SeqCst), 4 * iterations);
    }
}
