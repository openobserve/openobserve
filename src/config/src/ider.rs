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
    time::{SystemTime, UNIX_EPOCH},
};

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use rand::Rng;
use svix_ksuid::{Ksuid, KsuidLike};

static IDER: Lazy<Mutex<SnowflakeIdGenerator>> = Lazy::new(|| {
    let machine_id = unsafe { super::cluster::LOCAL_NODE_ID };
    log::info!("init ider with machine_id: {machine_id}");
    Mutex::new(SnowflakeIdGenerator::new(machine_id))
});

pub fn init() {
    _ = generate();
}

/// Generate a distributed unique id with snowflake.
pub fn generate() -> String {
    IDER.lock().real_time_generate().to_string()
}

/// Generate a unique id like uuid.
pub fn uuid() -> String {
    Ksuid::new(None, None).to_string()
}

/// Generate a new trace_id.
pub fn generate_trace_id() -> String {
    let trace_id = crate::utils::rand::get_rand_u128()
        .unwrap_or_else(|| crate::utils::time::now_micros() as u128);
    opentelemetry::trace::TraceId::from(trace_id).to_string()
}

/// Generate a new span_id.
pub fn generate_span_id() -> String {
    let mut rng = rand::thread_rng();
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
    fn test_generate_trace_id() {
        let trace_id = generate_trace_id();
        println!("trace_id: {}", trace_id);
        let trace_id1 = format!("{}-{}", trace_id, "0");
        let trace_id2 = format!("{}-{}", trace_id1, "abcd");

        let new_id = trace_id
            .split('-')
            .next()
            .and_then(|id| opentelemetry::trace::TraceId::from_hex(id).ok());
        assert!(new_id.is_some());
        let new_id = new_id.unwrap();
        let new_id1 = format!("{}-{}", new_id, "0");
        let new_id2 = format!("{}-{}", new_id1, "abcd");
        assert_eq!(new_id2, trace_id2);
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
        assert_ne!(span_id1, span_id2, "Generated span IDs should be unique");
        assert_eq!(
            span_id1.len(),
            16,
            "Span ID should be 16 characters long (8 bytes in hex)"
        );
        assert_ne!(
            span_id1, "0000000000000000",
            "Span ID should not be all zeros"
        );
    }

    #[test]
    fn test_snowflake_id_generator() {
        let mut generator = SnowflakeIdGenerator::new(1);
        let id1 = generator.real_time_generate();
        let id2 = generator.real_time_generate();
        assert_ne!(id1, id2, "Generated snowflake IDs should be unique");

        // Test timestamp extraction
        let timestamp = to_timestamp_millis(id1);
        assert!(timestamp > 0, "Timestamp should be positive");
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
