// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

mod settings;

use std::{collections::HashMap, fmt, sync::Arc};

use serde::Serialize;

pub use self::settings::Memory;
pub(crate) use self::settings::check_memory_config;
use crate::{
    config::{Config, MAX_BUDGET_PERCENT, MAX_RATIO, MB, MIN_POOL_SIZE, get_config},
    meta::cluster::Role,
    utils::size::bytes_to_human_readable,
};

/// Every memory consumer whose size is derived from node memory; sizes are read only from here.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
pub enum MemoryConsumer {
    MemTable,
    DataFusionPool,
    FileMemoryCache,
    DataFusionFileStat,
    MetricsBlocksCache,
    IndexFooterCache,
    LabelCache,
    BloomFooterCache,
    MetricsResultCache,
    IndexResultCache,
    StreamingAggsCache,
    MemoryQueue,
}

impl MemoryConsumer {
    /// In declaration order, so `consumer as usize` indexes it.
    pub const ALL: [MemoryConsumer; 12] = [
        MemoryConsumer::MemTable,
        MemoryConsumer::DataFusionPool,
        MemoryConsumer::FileMemoryCache,
        MemoryConsumer::DataFusionFileStat,
        MemoryConsumer::MetricsBlocksCache,
        MemoryConsumer::IndexFooterCache,
        MemoryConsumer::LabelCache,
        MemoryConsumer::BloomFooterCache,
        MemoryConsumer::MetricsResultCache,
        MemoryConsumer::IndexResultCache,
        MemoryConsumer::StreamingAggsCache,
        MemoryConsumer::MemoryQueue,
    ];

    pub fn spec(self) -> ConsumerSpec {
        let spec = ConsumerSpec {
            name: "",
            default_ratio: DefaultRatio::Fixed(0),
            enabled_on: EnabledOn::Querier,
            scope: Scope::Process,
            required: false,
            ratio_env: "",
            legacy_env: "",
        };
        match self {
            MemoryConsumer::MemTable => ConsumerSpec {
                name: "memtable",
                default_ratio: DefaultRatio::Fixed(80),
                enabled_on: EnabledOn::Ingester,
                required: true,
                ratio_env: "ZO_MEMORY_RATIO_MEMTABLE",
                legacy_env: "ZO_MEM_TABLE_MAX_SIZE",
                ..spec
            },
            MemoryConsumer::DataFusionPool => ConsumerSpec {
                name: "datafusion_pool",
                default_ratio: DefaultRatio::ByIngester {
                    ingester: 50,
                    other: 80,
                },
                enabled_on: EnabledOn::QueryOrMerge,
                scope: Scope::PerPool,
                required: true,
                ratio_env: "ZO_MEMORY_RATIO_DATAFUSION_POOL",
                legacy_env: "ZO_MEMORY_CACHE_DATAFUSION_MAX_SIZE",
            },
            MemoryConsumer::FileMemoryCache => ConsumerSpec {
                name: "file_memory_cache",
                enabled_on: EnabledOn::FileMemoryCacheSwitch,
                ratio_env: "ZO_MEMORY_RATIO_FILE_MEMORY_CACHE",
                ..spec
            },
            MemoryConsumer::DataFusionFileStat => ConsumerSpec {
                name: "datafusion_file_stat",
                ratio_env: "ZO_MEMORY_RATIO_DATAFUSION_FILE_STAT",
                ..spec
            },
            MemoryConsumer::MetricsBlocksCache => ConsumerSpec {
                name: "metrics_blocks_cache",
                ratio_env: "ZO_MEMORY_RATIO_METRICS_BLOCKS_CACHE",
                ..spec
            },
            MemoryConsumer::IndexFooterCache => ConsumerSpec {
                name: "index_footer_cache",
                ratio_env: "ZO_MEMORY_RATIO_INDEX_FOOTER_CACHE",
                ..spec
            },
            MemoryConsumer::LabelCache => ConsumerSpec {
                name: "label_cache",
                ratio_env: "ZO_MEMORY_RATIO_LABEL_CACHE",
                ..spec
            },
            MemoryConsumer::BloomFooterCache => ConsumerSpec {
                name: "bloom_footer_cache",
                ratio_env: "ZO_MEMORY_RATIO_BLOOM_FOOTER_CACHE",
                ..spec
            },
            MemoryConsumer::MetricsResultCache => ConsumerSpec {
                name: "metrics_result_cache",
                enabled_on: EnabledOn::QuerierOrScheduler,
                ratio_env: "ZO_MEMORY_RATIO_METRICS_RESULT_CACHE",
                ..spec
            },
            MemoryConsumer::IndexResultCache => ConsumerSpec {
                name: "index_result_cache",
                ratio_env: "ZO_MEMORY_RATIO_INDEX_RESULT_CACHE",
                ..spec
            },
            MemoryConsumer::StreamingAggsCache => ConsumerSpec {
                name: "streaming_aggs_cache",
                ratio_env: "ZO_MEMORY_RATIO_STREAMING_AGGS_CACHE",
                ..spec
            },
            MemoryConsumer::MemoryQueue => ConsumerSpec {
                name: "memory_queue",
                enabled_on: EnabledOn::MemoryQueueSwitch,
                ratio_env: "ZO_MEMORY_RATIO_MEMORY_QUEUE",
                ..spec
            },
        }
    }

    pub fn name(self) -> &'static str {
        self.spec().name
    }
}

/// How one consumer is registered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConsumerSpec {
    pub name: &'static str,
    /// Read only when the ratio env is empty; a numeric ratio env carries its own default.
    pub default_ratio: DefaultRatio,
    pub enabled_on: EnabledOn,
    pub scope: Scope,
    /// The node cannot work without it where `enabled_on` holds, so ratio 0 fails startup.
    pub required: bool,
    pub ratio_env: &'static str,
    /// The deprecated MB setting, converted to a ratio when the ratio env is unset.
    pub legacy_env: &'static str,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DefaultRatio {
    Fixed(u32),
    ByIngester { ingester: u32, other: u32 },
}

impl DefaultRatio {
    pub fn resolve(self, roles: NodeRoles) -> u32 {
        match self {
            DefaultRatio::Fixed(ratio) => ratio,
            DefaultRatio::ByIngester { ingester, .. } if roles.ingester => ingester,
            DefaultRatio::ByIngester { other, .. } => other,
        }
    }
}

/// Which nodes can fill the consumer, from the code paths that insert into it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnabledOn {
    Ingester,
    Querier,
    /// The scheduler leads PromQL alert, recording rule and SLO queries.
    QuerierOrScheduler,
    /// Queries, search leaders and merges each build a pool.
    QueryOrMerge,
    /// `ZO_MEMORY_CACHE_ENABLED`, on the nodes that lead or serve searches.
    FileMemoryCacheSwitch,
    /// `ZO_QUEUE_STORE=memory`, which only local mode allows.
    MemoryQueueSwitch,
}

impl EnabledOn {
    pub fn holds(self, roles: NodeRoles, switches: Switches) -> bool {
        match self {
            EnabledOn::Ingester => roles.ingester,
            EnabledOn::Querier => roles.querier,
            EnabledOn::QuerierOrScheduler => roles.querier || roles.scheduler,
            EnabledOn::QueryOrMerge => {
                roles.ingester || roles.querier || roles.compactor || roles.scheduler
            }
            EnabledOn::FileMemoryCacheSwitch => {
                switches.file_cache && (roles.querier || roles.scheduler)
            }
            EnabledOn::MemoryQueueSwitch => switches.memory_queue,
        }
    }
}

/// The on/off settings that gate a consumer besides the node roles.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Switches {
    pub file_cache: bool,
    pub memory_queue: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    Process,
    /// Every query or merge builds its own pool of the quota size.
    PerPool,
}

/// The roles of a node, as the consumers' enablement needs them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NodeRoles {
    pub ingester: bool,
    pub querier: bool,
    pub compactor: bool,
    pub scheduler: bool,
    pub compactor_only: bool,
}

impl NodeRoles {
    pub const INGESTER_ONLY: NodeRoles = NodeRoles {
        ingester: true,
        querier: false,
        compactor: false,
        scheduler: false,
        compactor_only: false,
    };

    pub fn new(roles: &[Role]) -> Self {
        let all = roles.contains(&Role::All);
        Self {
            ingester: all || roles.contains(&Role::Ingester),
            querier: all || roles.contains(&Role::Querier),
            compactor: all || roles.contains(&Role::Compactor),
            scheduler: all || roles.contains(&Role::Scheduler),
            compactor_only: roles == [Role::Compactor],
        }
    }

    pub fn parse(node_role: &str) -> Self {
        // check_common_config already panics on an invalid role, so none is dropped here
        let roles: Vec<Role> = node_role
            .split(',')
            .filter_map(|role| role.parse().ok())
            .collect();
        Self::new(&roles)
    }
}

/// What the operator set for one consumer: the ratio env as written and the legacy size in bytes.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ConsumerSetting {
    pub ratio: String,
    pub legacy_bytes: usize,
    /// The ratio equals its env default, so the report labels it a default.
    pub is_default: bool,
}

/// Everything an allocation reads; `settings` follows `MemoryConsumer::ALL`.
#[derive(Clone, Debug)]
pub struct BudgetInputs {
    pub mem_total: usize,
    pub budget_percent: usize,
    pub node_role: String,
    pub roles: NodeRoles,
    pub switches: Switches,
    pub merge_threads: usize,
    pub pool_unbounded: bool,
    pub settings: [ConsumerSetting; 12],
}

/// The quota of every consumer on this node, split from one budget by ratio.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Allocation {
    mem_total: usize,
    budget_percent: usize,
    node_role: String,
    pool_unbounded: bool,
    items: Vec<AllocatedItem>,
    warnings: Vec<String>,
}

impl Allocation {
    /// Built by `check_memory_config`; the `EnvConfig` derive on `Memory` calls this.
    pub fn init() -> Result<Self, &'static str> {
        Ok(Self::default())
    }

    /// Reads no env, so it adds nothing to the env help.
    pub fn get_help() -> HashMap<String, (String, Option<String>)> {
        HashMap::new()
    }

    pub fn budget(&self) -> usize {
        (self.mem_total as u128 * self.budget_percent as u128 / 100) as usize
    }

    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }

    /// `None` before `check_memory_config` ran.
    pub fn item(&self, consumer: MemoryConsumer) -> Option<&AllocatedItem> {
        self.items.get(consumer as usize)
    }

    /// The startup allocation list.
    pub fn report(&self) -> String {
        let mut lines = vec![
            format!(
                "Memory budget: node memory {}, budget {}% = {}, roles: {}",
                human(self.mem_total),
                self.budget_percent,
                human(self.budget()),
                self.node_role
            ),
            format!(
                "  {:<22} {:<8} {:>5}  {:<8} {:>12}  scope",
                "item", "enabled", "ratio", "source", "quota"
            ),
        ];
        let mut ratio_sum = 0;
        let mut total = 0;
        for item in &self.items {
            if item.enabled {
                ratio_sum += item.ratio;
                total += item.quota * item.pools;
            }
            lines.push(self.report_line(item));
        }
        let mem_total = self.mem_total as u128;
        let percent = match (total as u128 * 100 + mem_total / 2).checked_div(mem_total) {
            Some(percent) => format!("{percent}%"),
            None => "-".to_string(),
        };
        lines.push(format!(
            "  {:<22} {:<8} {:>5}  {:<8} {:>12}  {percent} of node memory",
            "total",
            "",
            ratio_sum,
            "",
            human(total)
        ));
        lines.join("\n")
    }

    fn report_line(&self, item: &AllocatedItem) -> String {
        let quota = if item.enabled {
            human(item.quota)
        } else {
            "-".to_string()
        };
        let scope = match (item.consumer.spec().scope, item.pools) {
            (Scope::Process, _) => "process".to_string(),
            (Scope::PerPool, 1) => "per pool".to_string(),
            (Scope::PerPool, pools) => format!("per pool x{pools}"),
        };
        let unbounded = if self.pool_unbounded && item.consumer == MemoryConsumer::DataFusionPool {
            ", unbounded"
        } else {
            ""
        };
        format!(
            "  {:<22} {:<8} {:>5}  {:<8} {:>12}  {scope}{unbounded}",
            item.consumer.name(),
            if item.enabled { "yes" } else { "no" },
            item.ratio,
            item.source.label(),
            quota
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AllocatedItem {
    pub consumer: MemoryConsumer,
    pub enabled: bool,
    pub ratio: u32,
    pub source: RatioSource,
    /// Bytes of one pool for a `PerPool` consumer; 0 when it is off.
    pub quota: usize,
    pub pools: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum RatioSource {
    Default,
    RatioEnv,
    LegacyEnv { mb: usize },
}

impl RatioSource {
    fn label(self) -> &'static str {
        match self {
            RatioSource::Default => "default",
            RatioSource::RatioEnv => "env",
            RatioSource::LegacyEnv { .. } => "legacy",
        }
    }
}

/// Why startup stops, with the allocation list the operator needs to fix it.
#[derive(Debug)]
pub struct BudgetError {
    pub reasons: Vec<String>,
    pub allocation: Allocation,
}

impl fmt::Display for BudgetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "invalid memory budget: {}\n{}",
            self.reasons.join("; "),
            self.allocation.report()
        )
    }
}

impl std::error::Error for BudgetError {}

/// Quotas of every consumer, read from the allocation in the current config.
pub struct MemoryBudget {
    cfg: Arc<Config>,
}

impl MemoryBudget {
    pub fn new(cfg: Arc<Config>) -> Self {
        Self { cfg }
    }

    /// Bytes the consumer may hold; for a `PerPool` consumer this is the size of one pool.
    pub fn quota(&self, consumer: MemoryConsumer) -> usize {
        self.item(consumer).map_or(0, |item| item.quota)
    }

    pub fn is_enabled(&self, consumer: MemoryConsumer) -> bool {
        self.item(consumer).is_some_and(|item| item.enabled)
    }

    /// Pools of this consumer that can be live at once: one per merge thread on a compactor-only
    /// node, whose pool size is split across them.
    pub fn pools(&self, consumer: MemoryConsumer) -> usize {
        self.item(consumer).map_or(1, |item| item.pools)
    }

    /// Bytes the consumer counts toward the node total; zero when it is off on this node.
    pub fn limit(&self, consumer: MemoryConsumer) -> usize {
        self.item(consumer)
            .filter(|item| item.enabled)
            .map_or(0, |item| item.quota * item.pools)
    }

    pub fn total(&self) -> usize {
        MemoryConsumer::ALL.iter().map(|c| self.limit(*c)).sum()
    }

    pub fn report(&self) -> String {
        self.cfg.memory.allocation.report()
    }

    pub fn warnings(&self) -> &[String] {
        self.cfg.memory.allocation.warnings()
    }

    fn item(&self, consumer: MemoryConsumer) -> Option<&AllocatedItem> {
        self.cfg.memory.allocation.item(consumer)
    }
}

pub fn memory_budget() -> MemoryBudget {
    MemoryBudget::new(get_config())
}

/// Splits the budget across the consumers enabled on this node, in proportion to their ratios.
pub fn allocate(inputs: &BudgetInputs) -> Result<Allocation, BudgetError> {
    let mut reasons = Vec::new();
    if !(1..=MAX_BUDGET_PERCENT).contains(&inputs.budget_percent) {
        reasons.push(format!(
            "ZO_MEMORY_BUDGET_PERCENT must be 1-{MAX_BUDGET_PERCENT}, got {}",
            inputs.budget_percent
        ));
    }
    let chosen: Vec<(u32, RatioSource)> = MemoryConsumer::ALL
        .iter()
        .map(|&consumer| {
            choose_ratio(consumer, &inputs.settings[consumer as usize], inputs).unwrap_or_else(
                |reason| {
                    reasons.push(reason);
                    (0, RatioSource::RatioEnv)
                },
            )
        })
        .collect();
    let allocation = split_budget(inputs, &chosen);
    reasons.extend(check(inputs, &allocation));
    if reasons.is_empty() {
        Ok(allocation)
    } else {
        Err(BudgetError {
            reasons,
            allocation,
        })
    }
}

/// The ratio a consumer asks for and where it came from.
fn choose_ratio(
    consumer: MemoryConsumer,
    setting: &ConsumerSetting,
    inputs: &BudgetInputs,
) -> Result<(u32, RatioSource), String> {
    let spec = consumer.spec();
    let ratio = setting.ratio.trim();
    if !ratio.is_empty() {
        return match ratio.parse::<u32>() {
            Ok(ratio) if ratio <= MAX_RATIO => {
                let source = if setting.is_default {
                    RatioSource::Default
                } else {
                    RatioSource::RatioEnv
                };
                Ok((ratio, source))
            }
            _ => Err(format!(
                "{} must be an integer 0-{MAX_RATIO}, got '{ratio}'",
                spec.ratio_env
            )),
        };
    }
    if setting.legacy_bytes == 0 {
        return Ok((
            spec.default_ratio.resolve(inputs.roles),
            RatioSource::Default,
        ));
    }
    let mb = setting.legacy_bytes / MB;
    Ok((
        legacy_ratio(mb, inputs.mem_total),
        RatioSource::LegacyEnv { mb },
    ))
}

fn split_budget(inputs: &BudgetInputs, chosen: &[(u32, RatioSource)]) -> Allocation {
    let mut items: Vec<AllocatedItem> = MemoryConsumer::ALL
        .iter()
        .zip(chosen)
        .map(|(&consumer, &(ratio, source))| {
            let spec = consumer.spec();
            let pools = match spec.scope {
                Scope::PerPool if inputs.roles.compactor_only => inputs.merge_threads.max(1),
                Scope::PerPool | Scope::Process => 1,
            };
            AllocatedItem {
                consumer,
                enabled: ratio > 0 && spec.enabled_on.holds(inputs.roles, inputs.switches),
                ratio,
                source,
                quota: 0,
                pools,
            }
        })
        .collect();
    let ratio_sum: u128 = items
        .iter()
        .filter(|i| i.enabled)
        .map(|i| i.ratio as u128)
        .sum();
    let budget = inputs.mem_total as u128 * inputs.budget_percent as u128 / 100;
    for item in items.iter_mut().filter(|i| i.enabled) {
        // ratio_sum > 0 because this item is enabled with a ratio above 0
        let share = budget * item.ratio as u128 / ratio_sum;
        item.quota = (share / item.pools as u128) as usize;
    }
    let mut allocation = Allocation {
        mem_total: inputs.mem_total,
        budget_percent: inputs.budget_percent,
        node_role: inputs.node_role.clone(),
        pool_unbounded: inputs.pool_unbounded,
        items,
        warnings: Vec::new(),
    };
    allocation.warnings = warnings(inputs, &allocation);
    allocation
}

/// The legacy MB size as a share of node memory in whole percent, within 1-100.
fn legacy_ratio(mb: usize, mem_total: usize) -> u32 {
    let bytes = mb as u128 * MB as u128;
    let mem_total = mem_total.max(1) as u128;
    ((bytes * 100 + mem_total / 2) / mem_total).clamp(1, MAX_RATIO as u128) as u32
}

fn warnings(inputs: &BudgetInputs, allocation: &Allocation) -> Vec<String> {
    let mut warnings = Vec::new();
    for (item, setting) in allocation.items.iter().zip(&inputs.settings) {
        let spec = item.consumer.spec();
        match item.source {
            RatioSource::LegacyEnv { mb } => warnings.push(format!(
                "{}={mb} MB is deprecated; it is read as ratio {} (its share of node memory), \
                 scaled with the other enabled ratios to fill the {}% budget: quota {}. \
                 Set {} instead.",
                spec.legacy_env,
                item.ratio,
                inputs.budget_percent,
                if item.enabled {
                    human(item.quota)
                } else {
                    "off on this node".to_string()
                },
                spec.ratio_env
            )),
            RatioSource::RatioEnv if setting.legacy_bytes > 0 => warnings.push(format!(
                "{} is deprecated and ignored because {} is set.",
                spec.legacy_env, spec.ratio_env
            )),
            RatioSource::Default | RatioSource::RatioEnv => {}
        }
    }
    if inputs.pool_unbounded {
        warnings.push(
            "ZO_MEMORY_CACHE_DATAFUSION_MEMORY_POOL=none leaves every DataFusion pool unbounded; \
             queries can use more memory than the budget."
                .to_string(),
        );
    }
    warnings
}

/// The reasons this allocation cannot start the node.
fn check(inputs: &BudgetInputs, allocation: &Allocation) -> Vec<String> {
    if inputs.mem_total == 0 {
        return vec!["node memory could not be read from the cgroup or the system".to_string()];
    }
    let mut reasons = Vec::new();
    for item in &allocation.items {
        let spec = item.consumer.spec();
        let needed = spec.required && spec.enabled_on.holds(inputs.roles, inputs.switches);
        if needed && !item.enabled {
            reasons.push(format!(
                "{} cannot be off on this node; set {} above 0",
                spec.name, spec.ratio_env
            ));
        } else if needed
            && spec.scope == Scope::PerPool
            && !inputs.pool_unbounded
            && item.quota < MIN_POOL_SIZE
        {
            reasons.push(format!(
                "each {} gets {}, below the {} minimum; raise ZO_MEMORY_BUDGET_PERCENT or {}",
                spec.name,
                human(item.quota),
                human(MIN_POOL_SIZE),
                spec.ratio_env
            ));
        }
    }
    reasons
}

fn human(bytes: usize) -> String {
    bytes_to_human_readable(bytes as f64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::GB;

    const MERGE_THREADS: usize = 2;
    const ROLE_SETS: [&str; 9] = [
        "querier",
        "ingester",
        "compactor",
        "router",
        "alertmanager",
        "ingester,querier",
        "querier,compactor",
        "compactor,alertmanager",
        "all",
    ];

    fn inputs(node_role: &str, mem_total: usize) -> BudgetInputs {
        BudgetInputs {
            mem_total,
            budget_percent: 80,
            node_role: node_role.to_string(),
            roles: NodeRoles::parse(node_role),
            switches: Switches::default(),
            merge_threads: MERGE_THREADS,
            pool_unbounded: false,
            settings: MemoryConsumer::ALL.map(env_default),
        }
    }

    fn env_default(consumer: MemoryConsumer) -> ConsumerSetting {
        ConsumerSetting {
            ratio: Memory::get_help()[consumer.spec().ratio_env].0.clone(),
            legacy_bytes: 0,
            is_default: true,
        }
    }

    fn with(
        mut inputs: BudgetInputs,
        consumer: MemoryConsumer,
        ratio: &str,
        mb: usize,
    ) -> BudgetInputs {
        inputs.settings[consumer as usize] = ConsumerSetting {
            ratio: ratio.to_string(),
            legacy_bytes: mb * MB,
            is_default: false,
        };
        inputs
    }

    fn quota(allocation: &Allocation, consumer: MemoryConsumer) -> usize {
        allocation.item(consumer).unwrap().quota
    }

    fn enabled(allocation: &Allocation) -> Vec<MemoryConsumer> {
        allocation
            .items
            .iter()
            .filter(|i| i.enabled)
            .map(|i| i.consumer)
            .collect()
    }

    fn reasons(inputs: &BudgetInputs) -> String {
        allocate(inputs).unwrap_err().reasons.join("; ")
    }

    #[test]
    fn test_quotas_split_the_budget_by_ratio() {
        use MemoryConsumer::*;
        let budget = 16 * GB as u128 * 80 / 100;
        let share = |ratio: u128, sum: u128| (budget * ratio / sum) as usize;
        let querier = allocate(&inputs("querier", 16 * GB)).unwrap();
        assert_eq!(quota(&querier, DataFusionPool), share(80, 103));
        assert_eq!(quota(&querier, LabelCache), share(5, 103));
        assert_eq!(quota(&querier, BloomFooterCache), share(1, 103));
        assert_eq!(quota(&querier, MemTable), 0);

        let ingester = allocate(&inputs("ingester", 16 * GB)).unwrap();
        assert_eq!(quota(&ingester, MemTable), share(80, 130));
        assert_eq!(quota(&ingester, DataFusionPool), share(50, 130));
    }

    #[test]
    fn test_quotas_sum_to_the_budget_and_every_pool_holds_the_minimum() {
        for (mem, node_role, switch) in [2 * GB, 4 * GB, 16 * GB, 64 * GB]
            .into_iter()
            .flat_map(|mem| ROLE_SETS.map(|role| (mem, role)))
            .flat_map(|(mem, role)| [(mem, role, false), (mem, role, true)])
        {
            {
                let mut case = inputs(node_role, mem);
                case.switches = Switches {
                    file_cache: switch,
                    memory_queue: switch,
                };
                let allocation = allocate(&case).unwrap();
                let total: usize = allocation
                    .items
                    .iter()
                    .filter(|i| i.enabled)
                    .map(|i| i.quota * i.pools)
                    .sum();
                if enabled(&allocation).is_empty() {
                    assert_eq!(total, 0, "{node_role}");
                    continue;
                }
                let lost = allocation.budget() - total;
                assert!(
                    lost < 2 * MemoryConsumer::ALL.len(),
                    "{node_role} {mem}: {lost}"
                );
                let pool = allocation.item(MemoryConsumer::DataFusionPool).unwrap();
                assert!(
                    !pool.enabled || pool.quota >= MIN_POOL_SIZE,
                    "{node_role} {mem}"
                );
            }
        }
    }

    #[test]
    fn test_enabled_consumers_by_role() {
        use MemoryConsumer::*;
        let querier = vec![
            DataFusionPool,
            DataFusionFileStat,
            MetricsBlocksCache,
            IndexFooterCache,
            LabelCache,
            BloomFooterCache,
            MetricsResultCache,
            StreamingAggsCache,
        ];
        let mut all = vec![MemTable];
        all.extend(&querier);
        let cases: [(&str, Vec<MemoryConsumer>); 8] = [
            ("querier", querier.clone()),
            ("ingester", vec![MemTable, DataFusionPool]),
            ("compactor", vec![DataFusionPool]),
            ("router", vec![]),
            ("alertmanager", vec![DataFusionPool, MetricsResultCache]),
            ("ingester,querier", all.clone()),
            ("querier,compactor", querier.clone()),
            ("all", all.clone()),
        ];
        for (node_role, expected) in cases {
            let allocation = allocate(&inputs(node_role, 16 * GB)).unwrap();
            assert_eq!(enabled(&allocation), expected, "{node_role}");
        }
    }

    #[test]
    fn test_file_memory_cache_needs_the_switch_and_a_search_role() {
        for (node_role, expected) in [
            ("querier", true),
            ("alertmanager", true),
            ("all", true),
            ("ingester", false),
            ("compactor", false),
        ] {
            let mut on = inputs(node_role, 16 * GB);
            on.switches.file_cache = true;
            let allocation = allocate(&on).unwrap();
            let item = allocation.item(MemoryConsumer::FileMemoryCache).unwrap();
            assert_eq!(item.enabled, expected, "{node_role}");
        }
        let off = allocate(&inputs("querier", 16 * GB)).unwrap();
        assert!(!off.item(MemoryConsumer::FileMemoryCache).unwrap().enabled);
    }

    #[test]
    fn test_index_result_cache_is_off_until_its_ratio_is_set_on_a_querier() {
        for (node_role, expected) in [
            ("querier", true),
            ("all", true),
            ("alertmanager", false),
            ("ingester", false),
            ("compactor", false),
        ] {
            let on = with(
                inputs(node_role, 16 * GB),
                MemoryConsumer::IndexResultCache,
                "5",
                0,
            );
            let allocation = allocate(&on).unwrap();
            let item = allocation.item(MemoryConsumer::IndexResultCache).unwrap();
            assert_eq!(item.enabled, expected, "{node_role}");
        }
        let off = allocate(&inputs("querier", 16 * GB)).unwrap();
        assert!(!off.item(MemoryConsumer::IndexResultCache).unwrap().enabled);
    }

    #[test]
    fn test_ratio_env_replaces_the_default_and_zero_turns_a_consumer_off() {
        use MemoryConsumer::*;
        let base = inputs("querier", 16 * GB);
        let set = allocate(&with(base.clone(), LabelCache, "17", 0)).unwrap();
        let label = set.item(LabelCache).unwrap();
        assert_eq!((label.ratio, label.source), (17, RatioSource::RatioEnv));
        assert_eq!(
            quota(&set, LabelCache),
            (set.budget() as u128 * 17 / 115) as usize
        );

        let off = allocate(&with(base, LabelCache, "0", 0)).unwrap();
        assert!(!off.item(LabelCache).unwrap().enabled);
        assert_eq!(quota(&off, LabelCache), 0);
        assert_eq!(
            quota(&off, DataFusionPool),
            (off.budget() as u128 * 80 / 98) as usize
        );
    }

    #[test]
    fn test_invalid_ratio_or_budget_stops_startup() {
        let base = inputs("querier", 16 * GB);
        for ratio in ["abc", "101", "-1", "2.5"] {
            let reason = reasons(&with(base.clone(), MemoryConsumer::LabelCache, ratio, 0));
            assert!(
                reason.contains("ZO_MEMORY_RATIO_LABEL_CACHE"),
                "{ratio}: {reason}"
            );
        }
        for percent in [0, 201] {
            let mut bad = base.clone();
            bad.budget_percent = percent;
            assert!(
                reasons(&bad).contains("ZO_MEMORY_BUDGET_PERCENT"),
                "{percent}"
            );
        }
        let mut edge = base;
        edge.budget_percent = 200;
        assert!(allocate(&edge).is_ok());
    }

    #[test]
    fn test_required_consumers_cannot_be_off_where_the_role_needs_them() {
        use MemoryConsumer::*;
        let ingester = with(inputs("ingester", 16 * GB), MemTable, "0", 0);
        assert!(reasons(&ingester).contains("memtable cannot be off"));
        let querier = with(inputs("querier", 16 * GB), DataFusionPool, "0", 0);
        assert!(reasons(&querier).contains("datafusion_pool cannot be off"));
        assert!(allocate(&with(inputs("querier", 16 * GB), MemTable, "0", 0)).is_ok());
        assert!(allocate(&with(inputs("router", 16 * GB), DataFusionPool, "0", 0)).is_ok());
    }

    #[test]
    fn test_each_pool_must_hold_the_minimum() {
        let mut compactor = inputs("compactor", GB);
        compactor.merge_threads = 4;
        assert!(reasons(&compactor).contains("below the 256.00 MB minimum"));
        assert!(allocate(&inputs("querier", 512 * MB)).is_ok());
        // an ingester pool is 0.8 x 50 / 130 of memory, so 256 MiB needs about 832 MiB
        assert!(reasons(&inputs("ingester", 800 * MB)).contains("minimum"));
        assert!(allocate(&inputs("ingester", 900 * MB)).is_ok());
        let mut unbounded = inputs("ingester", 800 * MB);
        unbounded.pool_unbounded = true;
        assert!(allocate(&unbounded).is_ok());
    }

    #[test]
    fn test_unreadable_node_memory_stops_startup() {
        assert!(reasons(&inputs("querier", 0)).contains("node memory could not be read"));
    }

    #[test]
    fn test_compactor_only_pool_is_split_per_merge_thread() {
        let allocation = allocate(&inputs("compactor", 16 * GB)).unwrap();
        let pool = allocation.item(MemoryConsumer::DataFusionPool).unwrap();
        assert_eq!(pool.pools, MERGE_THREADS);
        assert_eq!(pool.quota, allocation.budget() / MERGE_THREADS);

        let mixed = allocate(&inputs("querier,compactor", 16 * GB)).unwrap();
        assert_eq!(mixed.item(MemoryConsumer::DataFusionPool).unwrap().pools, 1);
    }

    #[test]
    fn test_legacy_mb_settings_convert_to_ratios_with_a_warning() {
        use MemoryConsumer::*;
        let ingester = inputs("ingester", 28 * GB);
        let converted = allocate(&with(ingester.clone(), MemTable, "", 22938)).unwrap();
        let memtable = converted.item(MemTable).unwrap();
        assert_eq!(memtable.ratio, 80);
        assert_eq!(memtable.source, RatioSource::LegacyEnv { mb: 22938 });
        assert_eq!(converted.warnings.len(), 1);
        assert!(converted.warnings[0].contains("ZO_MEM_TABLE_MAX_SIZE=22938 MB is deprecated"));
        assert!(converted.warnings[0].contains("Set ZO_MEMORY_RATIO_MEMTABLE instead"));

        let huge = allocate(&with(inputs("ingester", 16 * GB), MemTable, "", 40000)).unwrap();
        assert_eq!(huge.item(MemTable).unwrap().ratio, 100);

        let tiny = allocate(&with(inputs("querier", 64 * GB), DataFusionPool, "", 64)).unwrap();
        assert_eq!(tiny.item(DataFusionPool).unwrap().ratio, 1);

        let both = allocate(&with(ingester, MemTable, "60", 22938)).unwrap();
        assert_eq!(both.item(MemTable).unwrap().ratio, 60);
        assert!(both.warnings[0].contains("ignored because ZO_MEMORY_RATIO_MEMTABLE is set"));
    }

    #[test]
    fn test_unbounded_pool_is_marked_and_warned() {
        let mut none = inputs("querier", 16 * GB);
        none.pool_unbounded = true;
        let allocation = allocate(&none).unwrap();
        assert!(allocation.report().contains("per pool, unbounded"));
        assert!(allocation.warnings[0].contains("unbounded"));
    }

    #[test]
    fn test_report_lists_every_consumer_and_the_total() {
        let report = allocate(&inputs("compactor", 16 * GB)).unwrap().report();
        let lines: Vec<&str> = report.lines().collect();
        assert_eq!(lines.len(), MemoryConsumer::ALL.len() + 3);
        assert_eq!(
            lines[0],
            "Memory budget: node memory 16.00 GB, budget 80% = 12.80 GB, roles: compactor"
        );
        for (line, consumer) in lines[2..].iter().zip(MemoryConsumer::ALL) {
            assert!(line.trim_start().starts_with(consumer.name()), "{line}");
        }
        let row = |name: &str| *lines.iter().find(|l| l.contains(name)).unwrap();
        assert!(row("memtable").contains(" no "), "{report}");
        assert!(
            row("datafusion_pool").contains("6.40 GB  per pool x2"),
            "{report}"
        );
        assert!(row("index_footer_cache").contains(" no "), "{report}");
        assert!(lines[lines.len() - 1].contains("   80 "), "{report}");
        assert!(
            lines[lines.len() - 1].ends_with("12.80 GB  80% of node memory"),
            "{report}"
        );
    }

    #[test]
    fn test_budget_error_shows_the_reason_and_the_list() {
        let error = allocate(&with(
            inputs("ingester", 16 * GB),
            MemoryConsumer::MemTable,
            "0",
            0,
        ))
        .unwrap_err()
        .to_string();
        assert!(error.starts_with("invalid memory budget: memtable cannot be off"));
        assert!(error.contains("Memory budget: node memory 16.00 GB"));
    }

    #[test]
    fn test_consumer_specs() {
        use MemoryConsumer::*;
        let ingester = NodeRoles::INGESTER_ONLY;
        let querier = NodeRoles::parse("querier");
        let cases = [
            (
                MemTable,
                80,
                80,
                Scope::Process,
                true,
                "ZO_MEM_TABLE_MAX_SIZE",
            ),
            (
                DataFusionPool,
                80,
                50,
                Scope::PerPool,
                true,
                "ZO_MEMORY_CACHE_DATAFUSION_MAX_SIZE",
            ),
            (FileMemoryCache, 0, 0, Scope::Process, false, ""),
            (DataFusionFileStat, 0, 0, Scope::Process, false, ""),
            (MetricsBlocksCache, 0, 0, Scope::Process, false, ""),
            (IndexFooterCache, 0, 0, Scope::Process, false, ""),
            (LabelCache, 0, 0, Scope::Process, false, ""),
            (BloomFooterCache, 0, 0, Scope::Process, false, ""),
            (MetricsResultCache, 0, 0, Scope::Process, false, ""),
            (IndexResultCache, 0, 0, Scope::Process, false, ""),
            (StreamingAggsCache, 0, 0, Scope::Process, false, ""),
            (MemoryQueue, 0, 0, Scope::Process, false, ""),
        ];
        assert_eq!(cases.len(), MemoryConsumer::ALL.len());
        for ((consumer, on_querier, on_ingester, scope, required, legacy_env), listed) in
            cases.into_iter().zip(MemoryConsumer::ALL)
        {
            let spec = consumer.spec();
            assert_eq!(consumer, listed);
            assert_eq!(
                spec.default_ratio.resolve(querier),
                on_querier,
                "{consumer:?}"
            );
            assert_eq!(
                spec.default_ratio.resolve(ingester),
                on_ingester,
                "{consumer:?}"
            );
            assert_eq!(spec.scope, scope, "{consumer:?}");
            assert_eq!(spec.required, required, "{consumer:?}");
            assert_eq!(spec.legacy_env, legacy_env, "{consumer:?}");
            assert_eq!(
                spec.ratio_env,
                format!("ZO_MEMORY_RATIO_{}", spec.name.to_uppercase())
            );
        }
    }
}
