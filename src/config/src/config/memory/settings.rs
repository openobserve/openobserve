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

use std::collections::HashMap;

use dotenv_config::EnvConfig;
use serde::Serialize;

use super::{
    Allocation, BudgetInputs, ConsumerSetting, MemoryConsumer, NodeRoles, Switches, allocate,
};
use crate::{
    config::{Config, MAX_FILE_SIZE_DEFAULT_CAP, MAX_FILE_SIZE_DEFAULT_FLOOR, MB},
    utils::sysinfo,
};

/// Every in-memory cache and buffer setting. Env sizes are MB (the result cache entry size is
/// bytes) and hold bytes after `check_memory_config`; quotas come from `allocation`.
#[derive(Serialize, EnvConfig, Default)]
pub struct Memory {
    #[env_config(
        name = "ZO_MEMORY_BUDGET_PERCENT",
        default = 80,
        help = "Share of node memory, in percent (1-200), that the memtable, DataFusion pools and memory caches split by their ZO_MEMORY_RATIO_* values. Above 100 overcommits; the rest is left for the runtime and unregistered memory."
    )]
    pub budget_percent: usize,
    pub memtable: MemTable,
    pub datafusion: DataFusion,
    pub file_cache: FileCache,
    pub index: IndexCache,
    pub metrics: MetricsCache,
    pub queue: MemoryQueue,
    pub allocation: Allocation,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct MemTable {
    #[env_config(
        name = "ZO_MEMORY_RATIO_MEMTABLE",
        default = "",
        help = "Share of the memory budget for the memtable on ingesters: an integer 0-100. Unset uses 80; the enabled shares are scaled to fill the budget."
    )]
    pub ratio: String,
    #[env_config(
        name = "ZO_MEM_TABLE_MAX_SIZE",
        default = 0,
        help = "Deprecated, use ZO_MEMORY_RATIO_MEMTABLE. Memtable size in MB, read as a share of node memory."
    )]
    pub max_size: usize,
    #[env_config(
        name = "ZO_MEM_TABLE_BUCKET_NUM",
        default = 0,
        help = "MemTable bucket num, 0 derives it from the memtable quota: quota / ZO_MAX_FILE_SIZE_IN_MEMORY / 4, between 1 and the cpu num"
    )]
    pub bucket_num: usize,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct DataFusion {
    #[env_config(
        name = "ZO_MEMORY_RATIO_DATAFUSION_POOL",
        default = "",
        help = "Share of the memory budget for each DataFusion query or merge pool: an integer 0-100, where 0 is refused on nodes that run queries or merges. Unset uses 50 on ingesters and 80 elsewhere; a compactor-only node splits it across ZO_FILE_MERGE_THREAD_NUM."
    )]
    pub pool_ratio: String,
    #[env_config(
        name = "ZO_MEMORY_CACHE_DATAFUSION_MAX_SIZE",
        default = 0,
        help = "Deprecated, use ZO_MEMORY_RATIO_DATAFUSION_POOL. DataFusion pool size in MB, read as a share of node memory."
    )]
    pub pool_size: usize,
    #[env_config(
        name = "ZO_MEMORY_CACHE_DATAFUSION_MEMORY_POOL",
        default = "",
        help = "DataFusion memory pool type: greedy (default), fair, or none for an unbounded pool."
    )]
    pub pool_type: String,
    #[env_config(
        name = "ZO_MEMORY_RATIO_DATAFUSION_FILE_STAT",
        default = 5,
        help = "Share of the memory budget for the DataFusion file statistics cache on queriers: an integer 0-100."
    )]
    pub file_stat_ratio: u32,
    #[env_config(
        name = "ZO_MEMORY_RATIO_STREAMING_AGGS_CACHE",
        default = 1,
        help = "Share of the memory budget for the streaming aggs cache metadata (cache file lists and partition plans) on queriers: an integer 0-100."
    )]
    pub streaming_aggs_ratio: u32,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct FileCache {
    #[env_config(
        name = "ZO_MEMORY_CACHE_ENABLED",
        default = false,
        help = "Cache downloaded data files in memory on queriers. Resolves to false where the cache gets no quota."
    )]
    pub enabled: bool,
    #[env_config(
        name = "ZO_MEMORY_RATIO_FILE_MEMORY_CACHE",
        default = 50,
        help = "Share of the memory budget for the file memory cache when ZO_MEMORY_CACHE_ENABLED is on: an integer 0-100."
    )]
    pub ratio: u32,
    // Memory data cache strategy, default is lru, other value is fifo, time_lru
    #[env_config(name = "ZO_MEMORY_CACHE_STRATEGY", default = "lru")]
    pub strategy: String,
    // Memory data cache bucket num, multiple bucket means multiple locker, default is 0
    #[env_config(name = "ZO_MEMORY_CACHE_BUCKET_NUM", default = 0)]
    pub bucket_num: usize,
    // MB, will skip the cache when a query need cache great than this value, default is 50% of
    // the quota
    #[env_config(name = "ZO_MEMORY_CACHE_SKIP_SIZE", default = 0)]
    pub skip_size: usize,
    // MB, when cache is full will release how many data once time, default is 10% of the quota
    #[env_config(name = "ZO_MEMORY_CACHE_RELEASE_SIZE", default = 0)]
    pub release_size: usize,
    #[env_config(name = "ZO_MEMORY_CACHE_GC_SIZE", default = 100)] // MB
    pub gc_size: usize,
    #[env_config(name = "ZO_MEMORY_CACHE_GC_INTERVAL", default = 60)] // seconds
    pub gc_interval: u64,
    // Days, files with data older than this will not be downloaded into the cache,
    // queries read them directly from object storage. default 0 means no limit
    #[env_config(name = "ZO_MEMORY_CACHE_MAX_AGE_DAYS", default = 0)]
    pub max_age_days: i64,
    #[env_config(name = "ZO_MEMORY_CACHE_SKIP_DISK_CHECK", default = false)]
    pub skip_disk_check: bool,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct IndexCache {
    #[env_config(
        name = "ZO_MEMORY_RATIO_INDEX_FOOTER_CACHE",
        default = 5,
        help = "Share of the memory budget for the inverted index footer cache on queriers: an integer 0-100."
    )]
    pub footer_ratio: u32,
    #[env_config(
        name = "ZO_MEMORY_RATIO_BLOOM_FOOTER_CACHE",
        default = 1,
        help = "Share of the memory budget for the bloom-filter footer cache on queriers: an integer 0-100. It holds the suffix bytes of each .bf file so prune calls skip the suffix-range GET."
    )]
    pub bloom_footer_ratio: u32,
    #[env_config(
        name = "ZO_MEMORY_RATIO_INDEX_RESULT_CACHE",
        default = 0,
        help = "Share of the memory budget for the inverted index result cache on queriers: an integer 0-100; 0 keeps the cache off."
    )]
    pub result_cache_ratio: u32,
    #[env_config(
        name = "ZO_INVERTED_INDEX_RESULT_CACHE_MAX_ENTRY_SIZE",
        default = 20480, // bytes, default is 20KB
        help = "Maximum size of a single entry in the inverted index result cache. Higher values increase memory usage but may improve query performance."
    )]
    pub result_cache_max_entry_size: usize,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct MetricsCache {
    #[env_config(
        name = "ZO_MEMORY_RATIO_METRICS_BLOCKS_CACHE",
        default = 5,
        help = "Share of the memory budget for the parsed metrics block metadata cache on queriers: an integer 0-100."
    )]
    pub blocks_ratio: u32,
    #[env_config(
        name = "ZO_MEMORY_RATIO_LABEL_CACHE",
        default = 5,
        help = "Share of the memory budget for the PromQL series label cache on queriers: an integer 0-100."
    )]
    pub label_ratio: u32,
    #[env_config(
        name = "ZO_MEMORY_RATIO_METRICS_RESULT_CACHE",
        default = 1,
        help = "Share of the memory budget for the PromQL result cache index on queriers and schedulers: an integer 0-100."
    )]
    pub result_ratio: u32,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct MemoryQueue {
    #[env_config(
        name = "ZO_MEMORY_RATIO_MEMORY_QUEUE",
        default = 1,
        help = "Share of the memory budget for the in-memory queue across all topics when ZO_QUEUE_STORE=memory: an integer 0-100."
    )]
    pub ratio: u32,
}

#[expect(
    clippy::disallowed_methods,
    reason = "the budget is where node memory is split"
)]
pub(crate) fn check_memory_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    resolve_memory_config(cfg, sysinfo::get_memory_limit())
}

/// Resolves every memory setting against `mem_total` bytes of node memory.
pub(crate) fn resolve_memory_config(
    cfg: &mut Config,
    mem_total: usize,
) -> Result<(), anyhow::Error> {
    cfg.limit.mem_total = mem_total;
    legacy_sizes_to_bytes(&mut cfg.memory);
    let inputs = budget_inputs(cfg);
    cfg.memory.allocation = allocate(&inputs)?;
    resolve_file_cache(&mut cfg.memory, cfg.limit.cpu_num);
    resolve_mem_table(cfg, &inputs);
    resolve_index_result_cache(&mut cfg.memory.index);
    Ok(())
}

fn legacy_sizes_to_bytes(memory: &mut Memory) {
    for size in [
        &mut memory.memtable.max_size,
        &mut memory.datafusion.pool_size,
    ] {
        *size = size.saturating_mul(MB);
    }
}

fn budget_inputs(cfg: &Config) -> BudgetInputs {
    let memory = &cfg.memory;
    let defaults = Memory::get_help();
    BudgetInputs {
        mem_total: cfg.limit.mem_total,
        budget_percent: memory.budget_percent,
        node_role: cfg.common.node_role.clone(),
        roles: NodeRoles::parse(&cfg.common.node_role),
        switches: Switches {
            file_cache: memory.file_cache.enabled,
            memory_queue: cfg.common.queue_store == "memory",
        },
        merge_threads: cfg.limit.file_merge_thread_num,
        pool_unbounded: matches!(
            memory.datafusion.pool_type.trim().to_lowercase().as_str(),
            "none" | "off"
        ),
        settings: MemoryConsumer::ALL.map(|consumer| consumer_setting(memory, consumer, &defaults)),
    }
}

fn consumer_setting(
    memory: &Memory,
    consumer: MemoryConsumer,
    defaults: &HashMap<String, (String, Option<String>)>,
) -> ConsumerSetting {
    let ratio = match consumer {
        MemoryConsumer::MemTable => {
            return ConsumerSetting {
                ratio: memory.memtable.ratio.clone(),
                legacy_bytes: memory.memtable.max_size,
                is_default: false,
            };
        }
        MemoryConsumer::DataFusionPool => {
            return ConsumerSetting {
                ratio: memory.datafusion.pool_ratio.clone(),
                legacy_bytes: memory.datafusion.pool_size,
                is_default: false,
            };
        }
        MemoryConsumer::FileMemoryCache => memory.file_cache.ratio,
        MemoryConsumer::DataFusionFileStat => memory.datafusion.file_stat_ratio,
        MemoryConsumer::MetricsBlocksCache => memory.metrics.blocks_ratio,
        MemoryConsumer::IndexFooterCache => memory.index.footer_ratio,
        MemoryConsumer::LabelCache => memory.metrics.label_ratio,
        MemoryConsumer::BloomFooterCache => memory.index.bloom_footer_ratio,
        MemoryConsumer::MetricsResultCache => memory.metrics.result_ratio,
        MemoryConsumer::IndexResultCache => memory.index.result_cache_ratio,
        MemoryConsumer::StreamingAggsCache => memory.datafusion.streaming_aggs_ratio,
        MemoryConsumer::MemoryQueue => memory.queue.ratio,
    };
    let ratio = ratio.to_string();
    ConsumerSetting {
        is_default: defaults[consumer.spec().ratio_env].0 == ratio,
        ratio,
        legacy_bytes: 0,
    }
}

fn quota_of(allocation: &Allocation, consumer: MemoryConsumer) -> usize {
    allocation.item(consumer).map_or(0, |item| item.quota)
}

/// Readers check `enabled` alone, so it must be false wherever the cache has no quota.
fn resolve_file_cache(memory: &mut Memory, cpu_num: usize) {
    let quota = quota_of(&memory.allocation, MemoryConsumer::FileMemoryCache);
    let file_cache = &mut memory.file_cache;
    file_cache.enabled = quota > 0;
    file_cache.skip_size = match file_cache.skip_size {
        0 => quota / 2,
        mb => mb.saturating_mul(MB),
    };
    file_cache.release_size = match file_cache.release_size {
        0 => quota / 10,
        mb => mb.saturating_mul(MB),
    };
    file_cache.gc_size = match file_cache.gc_size {
        0 => 100 * MB,
        mb => mb.saturating_mul(MB),
    };
    if file_cache.bucket_num == 0 {
        file_cache.bucket_num = cpu_num;
    }
}

fn resolve_mem_table(cfg: &mut Config, inputs: &BudgetInputs) {
    let quota = memtable_quota_for_file_sizes(&cfg.memory.allocation, inputs);
    cfg.limit.max_file_size_in_memory = match cfg.limit.max_file_size_in_memory {
        0 => default_max_file_size(quota),
        mb => mb * MB,
    };
    cfg.limit.max_file_size_on_disk = match cfg.limit.max_file_size_on_disk {
        0 => default_max_file_size(quota),
        mb => mb * MB,
    };
    if cfg.memory.memtable.bucket_num == 0 {
        cfg.memory.memtable.bucket_num = default_mem_table_bucket_num(
            quota,
            cfg.limit.max_file_size_in_memory,
            cfg.limit.cpu_num,
        );
    }
}

/// The compactor sizes its merge threshold from the file size too, so a node without a memtable
/// uses the quota an ingester-only node with the same memory and settings would get.
fn memtable_quota_for_file_sizes(allocation: &Allocation, inputs: &BudgetInputs) -> usize {
    let own = allocation.item(MemoryConsumer::MemTable);
    if let Some(item) = own.filter(|item| item.enabled) {
        return item.quota;
    }
    let mut as_ingester = BudgetInputs {
        roles: NodeRoles::INGESTER_ONLY,
        ..inputs.clone()
    };
    if own.is_some_and(|item| item.ratio == 0) {
        as_ingester.settings[MemoryConsumer::MemTable as usize] = ConsumerSetting::default();
    }
    let allocation = allocate(&as_ingester).unwrap_or_else(|error| error.allocation);
    quota_of(&allocation, MemoryConsumer::MemTable)
}

fn resolve_index_result_cache(index: &mut IndexCache) {
    if index.result_cache_max_entry_size == 0 {
        index.result_cache_max_entry_size = 20480;
    }
}

/// A quarter of what the budget holds, so each bucket can keep two full memtables in memory.
fn default_mem_table_bucket_num(
    mem_table_max_size: usize,
    max_file_size_in_memory: usize,
    cpu_num: usize,
) -> usize {
    let by_memory = mem_table_max_size / max_file_size_in_memory.max(1) / 4;
    by_memory.clamp(1, cpu_num.max(1))
}

/// A quarter of the memtable budget in whole MB, clamped to 32..512 MB.
fn default_max_file_size(mem_table_max_size: usize) -> usize {
    (mem_table_max_size / 4 / MB * MB).clamp(MAX_FILE_SIZE_DEFAULT_FLOOR, MAX_FILE_SIZE_DEFAULT_CAP)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{GB, memory::RatioSource};

    fn config(node_role: &str, edit: impl FnOnce(&mut Config)) -> Config {
        let mut cfg = Config {
            memory: Memory::init().unwrap(),
            ..Default::default()
        };
        cfg.common.node_role = node_role.to_string();
        cfg.limit.cpu_num = 8;
        cfg.limit.file_merge_thread_num = 2;
        edit(&mut cfg);
        cfg
    }

    fn resolved(node_role: &str, edit: impl FnOnce(&mut Config)) -> Config {
        resolved_at(node_role, 16 * GB, edit)
    }

    fn resolved_at(node_role: &str, mem_total: usize, edit: impl FnOnce(&mut Config)) -> Config {
        let mut cfg = config(node_role, edit);
        resolve_memory_config(&mut cfg, mem_total).unwrap();
        cfg
    }

    fn quota(cfg: &Config, consumer: MemoryConsumer) -> usize {
        quota_of(&cfg.memory.allocation, consumer)
    }

    #[test]
    fn test_every_size_resolves_to_bytes() {
        let cfg = resolved("querier", |cfg| {
            cfg.memory.file_cache.enabled = true;
            cfg.memory.file_cache.release_size = 1024;
            cfg.memory.file_cache.gc_size = 16;
        });
        let memory = &cfg.memory;
        let file_cache = quota(&cfg, MemoryConsumer::FileMemoryCache);
        assert!(file_cache > 0);
        assert_eq!(memory.file_cache.skip_size, file_cache / 2);
        assert_eq!(memory.file_cache.release_size, GB);
        let defaults = resolved("querier", |cfg| cfg.memory.file_cache.enabled = true);
        let default_quota = quota(&defaults, MemoryConsumer::FileMemoryCache);
        assert_eq!(defaults.memory.file_cache.release_size, default_quota / 10);
        assert_eq!(defaults.memory.file_cache.bucket_num, 8);
        assert_eq!(memory.file_cache.gc_size, 16 * MB);
        assert_eq!(memory.index.result_cache_max_entry_size, 20480);
    }

    #[test]
    fn test_legacy_and_ratio_settings_reach_the_allocation() {
        let cfg = resolved("querier", |cfg| {
            cfg.memory.datafusion.pool_size = 1638;
            cfg.memory.index.footer_ratio = 0;
        });
        let pool = cfg
            .memory
            .allocation
            .item(MemoryConsumer::DataFusionPool)
            .unwrap();
        assert_eq!(pool.ratio, 10);
        assert!(
            !cfg.memory
                .allocation
                .item(MemoryConsumer::IndexFooterCache)
                .unwrap()
                .enabled
        );
        assert_eq!(cfg.memory.allocation.warnings().len(), 1);
    }

    #[test]
    fn test_file_cache_switch_resolves_off_where_the_cache_gets_no_quota() {
        let on = |node_role| resolved(node_role, |cfg| cfg.memory.file_cache.enabled = true);
        assert!(on("querier").memory.file_cache.enabled);
        assert!(!on("ingester").memory.file_cache.enabled);
        let zero = resolved("querier", |cfg| {
            cfg.memory.file_cache.enabled = true;
            cfg.memory.file_cache.ratio = 0;
        });
        assert!(!zero.memory.file_cache.enabled);
    }

    #[test]
    fn test_mem_table_sizes_derive_from_the_memtable_quota() {
        // 2 GB keeps the file size under its 512 MB cap: 1.6 GB x 80 / 130 / 4 = 252 MB
        let ingester = resolved_at("ingester", 2 * GB, |_| {});
        assert_eq!(ingester.limit.max_file_size_in_memory, 252 * MB);
        assert_eq!(ingester.limit.max_file_size_on_disk, 252 * MB);
        assert_eq!(ingester.memory.memtable.bucket_num, 1);

        for edit in [
            |_: &mut Config| {},
            |cfg: &mut Config| cfg.memory.memtable.ratio = "0".to_string(),
        ] {
            let compactor = resolved_at("compactor", 2 * GB, edit);
            assert_eq!(quota(&compactor, MemoryConsumer::MemTable), 0);
            assert_eq!(compactor.limit.max_file_size_in_memory, 252 * MB);
            assert_eq!(compactor.memory.memtable.bucket_num, 1);
        }

        let explicit = resolved("ingester", |cfg| {
            cfg.limit.max_file_size_in_memory = 256;
            cfg.limit.max_file_size_on_disk = 128;
            cfg.memory.memtable.bucket_num = 3;
        });
        assert_eq!(explicit.limit.max_file_size_in_memory, 256 * MB);
        assert_eq!(explicit.limit.max_file_size_on_disk, 128 * MB);
        assert_eq!(explicit.memory.memtable.bucket_num, 3);
    }

    #[test]
    fn test_budget_percent_defaults_to_80() {
        assert_eq!(Memory::get_help()["ZO_MEMORY_BUDGET_PERCENT"].0, "80");
    }

    #[test]
    fn test_a_ratio_reads_as_default_only_while_it_equals_its_env_default() {
        let source = |cfg: &Config| {
            cfg.memory
                .allocation
                .item(MemoryConsumer::LabelCache)
                .unwrap()
                .source
        };
        assert_eq!(source(&resolved("querier", |_| {})), RatioSource::Default);
        let set = resolved("querier", |cfg| cfg.memory.metrics.label_ratio = 17);
        assert_eq!(source(&set), RatioSource::RatioEnv);
    }

    #[test]
    fn test_ratio_env_defaults() {
        use MemoryConsumer::*;
        let help = Memory::get_help();
        let cases = [
            (MemTable, ""),
            (DataFusionPool, ""),
            (FileMemoryCache, "50"),
            (DataFusionFileStat, "5"),
            (MetricsBlocksCache, "5"),
            (IndexFooterCache, "5"),
            (LabelCache, "5"),
            (BloomFooterCache, "1"),
            (MetricsResultCache, "1"),
            (IndexResultCache, "0"),
            (StreamingAggsCache, "1"),
            (MemoryQueue, "1"),
        ];
        assert_eq!(cases.len(), MemoryConsumer::ALL.len());
        for (consumer, default) in cases {
            assert_eq!(help[consumer.spec().ratio_env].0, default, "{consumer:?}");
        }
    }

    #[test]
    fn test_an_invalid_budget_stops_startup_with_the_list() {
        let mut cfg = config("ingester", |cfg| {
            cfg.memory.memtable.ratio = "0".to_string()
        });
        let error = resolve_memory_config(&mut cfg, 16 * GB)
            .unwrap_err()
            .to_string();
        assert!(error.contains("memtable cannot be off"), "{error}");
        assert!(
            error.contains("Memory budget: node memory 16.00 GB"),
            "{error}"
        );
    }

    #[test]
    fn test_memory_queue_gets_a_quota_only_with_the_memory_store() {
        let local = resolved("all", |cfg| cfg.common.queue_store = "memory".to_string());
        assert!(quota(&local, MemoryConsumer::MemoryQueue) > 0);
        let nats = resolved("all", |cfg| cfg.common.queue_store = "nats".to_string());
        assert_eq!(quota(&nats, MemoryConsumer::MemoryQueue), 0);
        let off = resolved("all", |cfg| {
            cfg.common.queue_store = "memory".to_string();
            cfg.memory.queue.ratio = 0;
        });
        assert_eq!(quota(&off, MemoryConsumer::MemoryQueue), 0);
    }

    #[test]
    fn test_default_mem_table_bucket_num() {
        // 32 GB holds 64 memtables of 512 MB; a quarter of that, then the core count caps it
        assert_eq!(default_mem_table_bucket_num(32 * GB, 512 * MB, 64), 16);
        assert_eq!(default_mem_table_bucket_num(32 * GB, 512 * MB, 8), 8);
        assert_eq!(default_mem_table_bucket_num(4 * GB, 512 * MB, 28), 2);
        assert_eq!(default_mem_table_bucket_num(2 * GB, 512 * MB, 28), 1);
        assert_eq!(default_mem_table_bucket_num(4 * GB, 128 * MB, 28), 8);
        assert_eq!(default_mem_table_bucket_num(512 * MB, 512 * MB, 28), 1);
        assert_eq!(default_mem_table_bucket_num(0, 512 * MB, 28), 1);
        assert_eq!(default_mem_table_bucket_num(32 * GB, 0, 28), 28);
        assert_eq!(default_mem_table_bucket_num(32 * GB, 512 * MB, 0), 1);
    }

    #[test]
    fn test_default_max_file_size() {
        assert_eq!(default_max_file_size(64 * GB), 512 * MB);
        assert_eq!(default_max_file_size(2 * GB), 512 * MB);
        assert_eq!(default_max_file_size(GB), 256 * MB);
        assert_eq!(default_max_file_size(512 * MB), 128 * MB);
        assert_eq!(default_max_file_size(1000 * MB + 123), 250 * MB);
        assert_eq!(default_max_file_size(64 * MB), 32 * MB);
        assert_eq!(default_max_file_size(0), 32 * MB);
    }
}
