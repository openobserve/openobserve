# Search crate 两 PR 原子迁移方案

## 1. 结论

建议采用两个 PR，但“第二个 PR 一次搬完”的对象应是完整的**查询引擎强连通单元**，而不是字面上的整个 `src/core/src/service/search` 目录。

两个 PR 的职责严格分开：

1. PR 1 在文件仍位于 core 时消除所有跨边界依赖，并把少量被引擎反向引用的共享状态、参数类型和 file-cache helper 放到最终所有者中。
2. PR 2 使用一次原子 `git mv`，同时移动 DataFusion、SQL、index、Tantivy 和它们的纯辅助模块；core 只保留普通 re-export 和业务编排。

第二个 PR 不再按 SQL、planner、optimizer、storage、Tantivy 分多次迁移。

不建议先单独移动 DataFusion。DataFusion 当前不是依赖图中的叶子：

- DataFusion 使用 `Sql`、`IndexCondition`、Tantivy execution、inspector 和 query 参数类型；
- SQL visitor 和 index parser 又使用 DataFusion UDF 常量与实现；
- Tantivy 当前反向使用 core gRPC storage 中的 `QueryParams`、分区计算和 cache download helper。

因此单独移动 DataFusion，要么形成 `search -> core -> search` 环，要么先人为拆出大量中间 types/provider。最终工作量不小于一次移动整个引擎单元，而且会产生临时边界。

命名约定：共享 VRL 集成层的目录为 `src/vrl`，Cargo package 名称为
`openobserve-vrl`，Rust 引用路径为 `openobserve_vrl`。不能直接把 package 命名为
`vrl`，因为 workspace 已依赖上游 `vrl` crate；同名会混淆依赖来源和代码路径。

## 2. 基线与已经完成的工作

原始设计基于：

```text
main @ 89e71fc05656c8e6466f0a53b3cb99fbed3c6e27
```

开始实施时必须从最新 main 重新确认 SHA、文件数和行数。

当前实施状态（2026-07-16）：

- PR 1：`openobserve/openobserve#13234`，基线 main 为
  `d6166aac49b1eaf76eb97456b3b489cd9b705d1d`；candidate SHA 以 PR body 为准；
- Enterprise companion：`openobserve/o2-enterprise#2196`；
- `src/vrl` / `openobserve-vrl` 已提取，负责 transform definition、enrichment table
  registry、VRL compiler configuration 和共享 runtime helper；
- 没有引入 `QueryExecutionContext`、`PreparedQueryTransform` 或
  `prepare_query_transforms`；DataFusion 使用 `Sql.org_id` 直接从
  `openobserve_vrl` 注册 UDF；
- cipher registry、`QueryParams`、file-cache helper 和通用 downloader 的所有权已按
  第 6 节收紧；
- PR 1 的性能基准和运行时 smoke test 尚未完成，不能据此声明性能验收通过。

`5dc22a0ee8 refactor: establish search crate boundary (#13217)` 已经完成原方案中的一部分前置工作：

- 创建 `src/search` workspace crate；
- 移动 search/cache 共享类型；
- 将 enrichment table 类型和 cache ownership 移入 `search`；
- 将 traces schema 常量移入 `config`；
- 将 enrichment 具体 DB read API 下沉到 `infra`；
- DataFusion enrichment exec 已直接依赖 `infra`；
- core 通过普通 `pub use` 保留旧路径。

所以新的 PR 1 不需要重复创建 crate 或再次移动上述内容。

当前规模：

| 范围 | Rust 文件 | Rust 行数 |
|---|---:|---:|
| 完整 `service/search` | 163 | 61,341 |
| `datafusion` | 98 | 30,642 |
| `sql` | 20 | 5,892 |
| `tantivy` | 7 | 4,024 |
| `bloom_pruner.rs`、`index.rs`、`inspector.rs`、`utils.rs` | 4 | 3,216 |
| 当前最小引擎单元 | 129 | 43,774 |
| 继续留在 core 的 search 编排 | 约 34 | 约 17,567 |

这里的 43,774 行是设计基线 main 上可直接核对的最小原子迁移集合，不包含后续可能单独提取的 partition 编排。PR 1 已把 planning context/histogram 纯 helper 从 cluster/cache 归入候选模块，并新增 `datafusion/context.rs`；PR 2 执行前应重新统计最终文件数和行数，不能继续把 129/43,774 当作固定值。

## 3. 最终边界

```text
openobserve / API / jobs
       │                  │
       │                  └──────────────┐
       ▼                                 ▼
┌─────────────────────────────────────────┐
│            openobserve-core             │
│                                         │
│ search entry / result cache policy      │
│ cluster / gRPC / streaming / partition  │
│ usage / audit / HTTP mapping            │
│ dashboard context / query management    │
└────────────────────┬────────────────────┘
                     │ concrete Rust calls
                     ▼
┌─────────────────────────────────────────┐
│                  search                 │
│                                         │
│ datafusion / sql / index / tantivy      │
│ udf / udaf / optimizer / planner        │
│ physical plan / engine inspector        │
│ bloom pruning / engine utilities        │
└───────────┬───────────┬───────────┬─────┘
            │           │           │
            ▼           ▼           └──────────────┐
          config      infra                         ▼
                                        wal/proto/flight

openobserve-core / search / jobs
              │
              ▼
       openobserve-vrl (`src/vrl`)
              │
              ▼
      config / vector-enrichment / upstream vrl
```

依赖规则：

- `openobserve-core -> search`；
- `search` 永远不能依赖 `openobserve-core`；
- `openobserve-core`、`search` 和 `jobs` 可以依赖 `openobserve-vrl`；
- `openobserve-vrl` 不能依赖 `openobserve-core`、`search`、API、jobs 或 enterprise；
- API、jobs 和 enterprise 现有 `openobserve_core::service::search::*` 路径先通过 core façade 兼容；
- VRL 状态由 `openobserve-vrl` 直接拥有；不引入跨 crate runtime locator、provider trait、callback、function table 或 `#[path]`；
- query UDF 注册直接使用 `Sql.org_id`，不增加 query-specific context wrapper 或 prepare 层。

## 4. 为什么不迁移整个 `service/search`

完整目录仍直接拥有或调用以下 core 业务能力：

| core 能力 | 当前 search 使用位置 | 原因 |
|---|---|---|
| usage/self-reporting | `mod.rs`、`cache`、`streaming` | 请求计费与指标副作用 |
| enterprise audit | `streaming` | 审计发布和 ingestion 回写 |
| HTTP error mapping | `streaming` | Axum/HTTP 协议职责 |
| file-list + dump 合并 | `cluster`、`grpc`、`partition`、`super_cluster` | core storage 编排 |
| pending-delete 状态 | `grpc/wal.rs` | compaction 生命周期 |
| dashboard lookup | `searcher.rs` | query status 展示增强 |
| max query range/user role | `partition`、`streaming` | 用户和组织策略 |
| top-level recursive search | `cardinality.rs` | orchestration recursion |
| query manager/work group | `searcher.rs`、`work_group.rs` | enterprise admission 状态 |

如果要求第二个 PR 把这 163 个文件全部搬走，PR 1 就必须同时：

- 再提取 reporting/audit crate；
- 重新划分 HTTP streaming ownership；
- 下沉 file-list dump、pending-delete 和 dashboard read API；
- 改造 user policy 和 enterprise query manager；
- 处理 core 内 PromQL、metrics、traces、compact 等模块对 search 的反向调用。

这不再是“先解决依赖、再机械移动”，而是一轮更大的 service 架构重写。它也会把 usage、audit 和 HTTP 责任错误地放进查询引擎 crate。

因此本方案明确把 orchestration 留在 core。这是目标边界，不是未完成状态。

## 5. 原子迁移集合

PR 2 一次移动以下文件：

```text
src/core/src/service/search/datafusion/
src/core/src/service/search/sql/
src/core/src/service/search/tantivy/
src/core/src/service/search/bloom_pruner.rs
src/core/src/service/search/index.rs
src/core/src/service/search/inspector.rs
src/core/src/service/search/utils.rs
```

目标路径：

```text
src/search/src/datafusion/
src/search/src/sql/
src/search/src/tantivy/
src/search/src/bloom_pruner.rs
src/search/src/index.rs
src/search/src/inspector.rs
src/search/src/utils.rs
```

第一轮不移动整个 `partition/`。当前 `partition/sql_context.rs` 同时调用 result-cache helper 和 enterprise streaming-aggregate 编排；`aggregate.rs` 又递归调用 cardinality search。为了把它一起搬走而新增临时抽象不值得。

partition 可以在本方案完成后另开小 PR，只移动经重新确认的纯计算模块，但它不是完成 search engine crate 的前置条件。

## 6. PR 1：消除全部反向依赖

建议标题：

```text
refactor: make search engine sources crate-independent
```

### 6.1 目标

PR 1 合入后，边界脚本 allowlist 中的候选文件虽然物理上仍在 core，但它们只能依赖：

- 候选集合内的其他模块；
- 已存在的 `search` 共享类型/support；
- `openobserve-vrl` 提供的 transform、enrichment 和 compiler/runtime 能力；
- `config`、`infra`、`wal`、`proto`、`flight`、`tantivy_utils` 等下层 crate；
- feature-gated `o2_enterprise`、`vortex`、`vortex-datafusion`。

不能再读取 core 的 `common`、`cipher` 或非 search service。

### 6.2 提取共享 VRL 集成层

当前阻塞点：

```text
datafusion/udf/transform_udf.rs
  -> core QUERY_FUNCTIONS
  -> core ingestion::compile_vrl_function
  -> core enrichment tables
```

将这组状态和逻辑提取为独立叶子 crate：

```text
src/vrl/
  Cargo package: openobserve-vrl
  Rust crate:    openobserve_vrl
```

`openobserve-vrl` 负责：

- `QUERY_FUNCTIONS` 的唯一 ownership；
- organization enrichment tables 和 process-wide GeoIP/MaxMind tables；
- `get_vrl_compiler_config(org_id)`、`compile_vrl_function(source, org_id)`；
- ingestion、jobs、core 和 search 共用的 VRL runtime helper。

依赖方向：

```text
openobserve-core / search / jobs
  -> openobserve-vrl
       -> config + vector-enrichment + upstream vrl

openobserve-vrl -/-> openobserve-core / search / jobs / enterprise
```

DataFusion 的 UDF 注册保持直接调用：`SearchContextBuilder::build` 已拥有 `Sql`，使用
`sql.org_id` 调用 `register_udf(&ctx, &sql.org_id)`。transform UDF 从
`openobserve_vrl::QUERY_FUNCTIONS` 读取定义，并用
`openobserve_vrl::compile_vrl_function` 完成当前逐行编译流程。

约束：

- 不增加 `QueryExecutionContext`、`PreparedQueryTransform` 或
  `prepare_query_transforms(org_id)`；
- 不复制 `QUERY_FUNCTIONS` 或 enrichment registry，不注册 callback；
- package 不能命名为 `vrl`，避免与上游 `vrl` dependency 冲突；
- DataFusion 仍按当前语义为每一行构造 row-specific VRL source 并编译，不改变编译时机；
- 编译错误、VRL warning、enrichment/GeoIP registry 行为必须与当前一致；
- core 的非 DataFusion transform 与 ingestion 通过普通 re-export 兼容旧路径，但最终实现只有 `openobserve-vrl` 一份。

这样 search 不需要反向访问 core，也不需要为了传递同一份全局 transform 状态而制造 query context/prepare API。

### 6.3 移动 cipher registry ownership

当前阻塞点：

```text
datafusion/udf/cipher_udf.rs
  -> openobserve_core::cipher::registry::REGISTRY
```

`REGISTRY` 是 DataFusion cipher UDF 执行期必须访问的具体状态。将 registry 实现和静态 ownership 移到：

```text
src/search/src/cipher/registry.rs
```

core 原路径保留普通 re-export：

```rust
pub use search::cipher::registry;
```

core 的 key DB/watch 代码继续向同一个 registry 写入；DataFusion UDF 从 search 内直接读取。不要复制 registry，也不要注册 callback。

PR 1 必须同步验证 private enterprise overlay 中不存在 `o2_enterprise -> search` 依赖环。

### 6.4 将 engine query 参数从 gRPC 模块移出

当前阻塞点：

```text
datafusion/plan/tantivy_optimize_exec.rs
datafusion/distributed_plan/rewrite.rs
tantivy/mod.rs
  -> core search::grpc::QueryParams
```

把 `QueryParams` 和纯函数 `calc_target_partitions` 移到 search support，例如：

```text
src/search/src/types.rs
src/search/src/file_cache.rs
```

core `search::grpc` 使用普通 re-export 保留：

```rust
pub use search::types::QueryParams;
pub use search::file_cache::calc_target_partitions;
```

`SearchTable` 和 `create_tables_from_files` 仍留在 core gRPC，因为它们属于 follower storage orchestration。

### 6.5 解除 Tantivy 对 core file downloader 的依赖

当前依赖链：

```text
TantivyOptimizeExec
  -> tantivy_search
  -> grpc::storage::cache_files
  -> core file_downloader::queue_download
```

改造：

1. 将 `cache_files` 这一层 query cache policy 移到 `search::file_cache`；
2. 将通用 background file downloader 移到 `infra::cache::file_downloader`；
3. core 启动逻辑以及旧的 `service::file_downloader` 路径使用普通 re-export；
4. core gRPC storage 和 Tantivy 同时调用 `search::file_cache::cache_files`。

file downloader 还被 API event handler 和 jobs 使用，但它当前只依赖 config、infra、proto、tonic 等下层能力，没有业务 service 依赖。因此 downloader/I/O queue 放入 infra，而“哪些 query 文件值得预取”的 `cache_files` policy 留在 search。这样不增加第三个 production crate，也不把 query policy 下沉到 infra。

### 6.6 收紧 DataFusion 到引擎内部的路径

当前还有三处候选代码调用 core orchestration：

```text
sql/visitor/group_by.rs
datafusion/plan/projections.rs
datafusion/plan/regex_projections.rs
  -> cluster::flight::SearchContextBuilder
  -> cluster::flight::register_table
```

把 `SearchContextBuilder` 和 `register_table` 从 `cluster/flight.rs` 原地归并到候选 DataFusion 模块，建议路径：

```text
src/core/src/service/search/datafusion/context.rs
```

PR 1 时文件仍在 core，但只能依赖候选引擎模块和下层 crate；PR 2 随 `datafusion/` 一起移动。

`SearchContextBuilder::build` 继续接收已有的 `Request` 和 `Sql`。它直接从 `Sql.org_id`
注册 VRL UDF，不增加 `QueryExecutionContext` 或额外 prepare 函数。cluster、super-cluster 和
partition 调用方不需要了解 transform/enrichment 的内部表示；这部分 ownership 已由第 6.2 节的
`openobserve-vrl` 解决。

`get_group_by_fields`、`get_result_schema` 和 `get_columns_from_projections` 保持只接收现有查询对象，
不能增加仅用于跨 crate 传递全局状态的 context wrapper，也不能通过 callback 回取 core 状态。

### 6.7 移动纯 histogram rewrite helper

当前：

```text
datafusion/plan/projections.rs
  -> cache::cacher::handle_histogram
```

`handle_histogram` 只是 SQL 字符串和 interval 的纯改写。PR 1 将它移动到现有候选模块：

```text
service/search/sql/histogram.rs
```

result cache 和 DataFusion projection 同时调用新位置，core cache 不再拥有这段 SQL engine 逻辑。

### 6.8 收紧剩余内部路径

在仍位于 core 时完成这些改造：

- `TantivyOptimizeExec` 直接使用候选集合中的 `tantivy::tantivy_search`，不通过 `grpc::storage` re-export；
- DataFusion 使用 search-owned `QueryParams`；
- DataFusion/Tantivy 使用 search-owned `file_cache`；
- `utils.rs` 直接使用 search crate 已拥有的 `CAPPED_RESULTS_MSG`；
- 所有候选模块不再使用 `crate::common::*`、`crate::cipher::*` 或 `crate::service::<non-search>`；
- 所有候选模块不再使用 `service::search::{cache,cluster,grpc,partition,streaming,...}` 中未纳入原子迁移集合的模块；
- 候选集合内部暂时保留 `crate::service::search::*` 路径，PR 2 统一机械改成 `crate::*`。

### 6.9 feature 和 private overlay

PR 1 先建立最终 feature 透传，PR 2 不再设计 feature：

```text
search/enterprise
search/vectorscan
search/vortex
```

core 对应 feature 必须转发给 search：

```text
openobserve-core enterprise -> search/enterprise
openobserve-core vectorscan -> search/vectorscan
openobserve-core vortex     -> search/vortex
```

要求：

- community stub 可以解析依赖；
- enterprise、cloud overlay 使用同一份 `src/search/Cargo.toml`；
- Enterprise overlay 把 `src/vrl` 注册为 workspace member，并声明
  `openobserve-vrl = { path = "src/vrl" }`；
- 不维护第二份 search manifest；
- `search` 不依赖 core；
- `openobserve-vrl` 不依赖 core、search 或 enterprise；
- `o2_enterprise` 不依赖 search，避免 feature 下的 Cargo 环。

### 6.10 增加边界守卫

新增一个可由 CI 执行的脚本，检查候选集合：

```text
scripts/check-search-engine-boundary.sh
```

至少验证：

```bash
# search manifest 不能依赖 core
cargo metadata --no-deps --format-version 1 \
  | jq -e '.packages[] | select(.name == "search") | all(.dependencies[]; .name != "openobserve-core")'

# openobserve-vrl 必须是 leaf integration crate，不能反向依赖 core/search
cargo metadata --no-deps --format-version 1 \
  | jq -e '.packages[] | select(.name == "openobserve-vrl") | all(.dependencies[]; .name != "openobserve-core" and .name != "search")'

candidate_paths=(
  src/core/src/service/search/datafusion
  src/core/src/service/search/sql
  src/core/src/service/search/tantivy
  src/core/src/service/search/{bloom_pruner,index,inspector,utils}.rs
)

# 候选代码不能访问 core 外部模块或仍留在 core 的 search orchestration。
# 第一条覆盖直接 import；第二条使用 multiline 模式覆盖 Rust grouped import。
deny_direct='crate::(common|cipher)::|crate::service::(db|file_list|file_downloader|ingestion|self_reporting|dashboards|http)::|crate::service::search::(cache|cluster|grpc|partition|streaming|super_cluster|work_group|cardinality|searcher)::'
deny_grouped='crate::\{[^;]*\b(common|cipher)\b|crate::\{[^;]*\bservice::(db|file_list|file_downloader|ingestion|self_reporting|dashboards|http)\b|crate::service::\{[^;]*\b(db|file_list|file_downloader|ingestion|self_reporting|dashboards|http)\b|crate::service::search::\{[^;]*\b(cache|cluster|grpc|partition|streaming|super_cluster|work_group|cardinality|searcher)\b'

if rg "$deny_direct" "${candidate_paths[@]}" || \
   rg -U "$deny_grouped" "${candidate_paths[@]}"; then
  echo 'search engine boundary violation' >&2
  exit 1
fi

# 禁止临时桥和 query preparation wrapper；匹配到任意一项即失败
if rg 'SearchRuntime|CoreSearchRuntime|set_search_runtime|QueryExecutionContext|PreparedQueryTransform|prepare_query_transforms|#\[path|include!' src; then
  echo 'temporary search bridge is forbidden' >&2
  exit 1
fi
```

脚本必须同时覆盖直接 import 和跨行 grouped import，并使用明确 allowlist；不能用会把
DataFusion 自身 `datafusion::common` 误判为 core common 的宽泛表达式。

### 6.11 PR 1 验收

静态验收：

- PR 2 最终 allowlist 中的候选文件对 core 外部模块的引用为零；
- `cargo tree -p search` 中没有 `openobserve-core`；
- `cargo tree -p openobserve-vrl` 中没有 `openobserve-core` 或 `search`；
- core 旧路径仍可编译；
- 没有复制源文件；
- 没有 query context/prepare wrapper、callback、provider 或 runtime locator。

行为验收：

- query transform UDF 注册、编译错误和执行结果不变；
- organization enrichment 和 MaxMind/Enterprise GeoIP registry 行为不变；
- enterprise encrypt/decrypt UDF 和 key watch 行为不变；
- Tantivy index cache hit/miss、后台 download queue 和 metrics 不变；
- local、distributed Flight query 各通过一个 smoke test。

建议命令：

```bash
cargo fmt --all -- --check
cargo clippy -p openobserve-vrl --all-targets -- -D warnings
cargo clippy -p search --all-targets -- -D warnings
cargo clippy -p openobserve-core --all-targets -- -D warnings
cargo test -p openobserve-vrl --lib
cargo test -p search --lib
cargo test -p openobserve-core --lib
cargo check -p openobserve --features mimalloc
cargo check -p openobserve --no-default-features --features enterprise,mimalloc
cargo check -p openobserve --no-default-features --features cloud,mimalloc
cargo check -p openobserve --no-default-features --features enterprise,vortex,mimalloc
cargo deny --all-features check licenses
```

enterprise/cloud/vortex 命令必须使用 private overlay；无法运行时要明确记录，不得视为已通过。

PR 1 是行为重构 PR，不期待构建提速，但固定语义冷构建不能回退超过 2%。

## 7. PR 2：一次原子移动整个查询引擎

建议标题：

```text
refactor: move search engine into search crate
```

### 7.1 PR 内容

使用 `git mv` 一次移动第 5 节的完整集合。PR 1 已新增 `datafusion/context.rs`，设计基线下
候选数因此由 129 变为约 130 个文件；执行 PR 2 前必须根据最新 main 和边界脚本重新统计。
执行时以 PR 1 合入后的 allowlist 为唯一清单，不能漏文件或拆成多个迁移阶段。

统一做以下机械修改：

- 候选集合内部的 `crate::service::search::*` 改为 `crate::*`；
- `super` 路径按新目录层级修正；
- 单测随源文件一起移动；
- 依赖从 `openobserve-core/Cargo.toml` 移到 `search/Cargo.toml`；
- core 删除已移动模块的 `mod` 声明；
- core 增加 façade re-export；
- core 删除已不再直接使用的 DataFusion/Tantivy/Arrow 等 dependency；
- 将边界脚本的候选路径切换到 `src/search/src`，继续禁止任何 core import；
- API/jobs/enterprise 调用方先不做大规模路径替换。

core façade 示例：

```rust
pub use ::search::{
    bloom_pruner, datafusion, index, inspector, sql, tantivy, utils,
};
```

这样下列旧路径在兼容期内继续有效：

```text
openobserve_core::service::search::datafusion
openobserve_core::service::search::sql
openobserve_core::service::search::index
openobserve_core::service::search::tantivy
openobserve_core::service::search::inspector
```

PR 2 不顺便迁移调用方到 `search::*`。调用方路径清理可以在后续无行为 PR 中逐步完成。

### 7.2 PR 2 的提交策略

PR 可以包含 review-friendly 的准备说明，但最终建议 squash 为一个可编译的原子提交。不要保留“只移动一半、仓库不能编译”的中间 commit。

推荐最终 commit：

```text
refactor: move search engine into search crate
```

### 7.3 PR 2 结构验收

```bash
test ! -d src/core/src/service/search/datafusion
test ! -d src/core/src/service/search/sql
test ! -d src/core/src/service/search/tantivy

rg 'pub mod (datafusion|sql|tantivy);' src/core/src/service/search
cargo metadata --no-deps --format-version 1 \
  | jq -e '.packages[] | select(.name == "search") | all(.dependencies[]; .name != "openobserve-core")'
rg '#\[path|include!' src/search src/core/src/service/search
```

预期：

- 三个旧目录不存在；
- core 只有 façade re-export，没有第二份实现；
- `search -> core` 依赖为零；
- Git 能把大部分变更识别为 rename；
- 逻辑 diff 主要集中在 PR 1 已定义的 support API 和路径修正。

### 7.4 PR 2 正确性验收

除 PR 1 的命令外，至少补充：

- DataFusion、SQL、Tantivy 全部迁移单测；
- query transform UDF；
- enrichment table query；
- cipher UDF；
- Tantivy、Bloom、WAL、object storage 查询；
- local mode 和 distributed Flight；
- enterprise streaming aggregate codec；
- vortex feature；
- API 普通 search、streaming search、PromQL 各一个 smoke test；
- query cancel/status 和 background file downloader 生命周期。

启动 smoke test 时：

```bash
export ZO_COMPACT_ENABLED=false
```

## 8. 构建与运行时性能验收

两个 PR 都要按 `CRATE_SPLIT_BUILD_PERFORMANCE_PLAN.md` 的固定语义协议测量，且使用独立 target 目录。

需要三组比较：

1. PR 1 vs PR 1 的 main parent；
2. PR 2 vs 已合入 PR 1；
3. PR 2 最终结果 vs 两 PR 开始前的原始 main。

场景：

- release 冷构建；
- `debug=1 + unpacked` release-profiling 冷构建；
- 修改一个 moved DataFusion/SQL 文件后的增量构建；
- 修改一个 core orchestration 文件后的增量构建；
- `touch src/main.rs`；
- peak RSS、binary size、target size；
- `search` 和 `openobserve-core` 的 frontend/codegen timing。

接受条件：

- 最终冷构建至少降低 3%，或 search engine 增量构建至少降低 20%；
- peak RSS 不出现明显回退；
- binary size 增长不超过 2%，否则必须解释重复单态化来源；
- query throughput、P50/P95、CPU 回退不超过 3%；
- write throughput 不回退超过 3%。

如果冷构建没有收益但增量构建达到阈值，PR 描述必须把收益准确写成增量隔离，不能宣称冷构建提速。

## 9. 停止条件

PR 1 出现以下任一情况时停止并重新评审：

- private `o2_enterprise` 需要依赖 `search`，形成环；
- `openobserve-vrl` 需要反向依赖 core、search、jobs 或 enterprise；
- 为共享 VRL 状态仍需要 `QueryExecutionContext`、prepare wrapper 或 callback；
- file downloader 只能通过 callback 才能保持行为；
- 候选集合仍需要 usage、audit、HTTP 或 dashboard service；
- 为了移动 DataFusion 必须把 core gRPC orchestration 一起带走；
- 需要复制 registry/cache/source；
- PR 1 的行为修改显著超过本文列出的六个依赖面。

PR 2 出现以下任一情况时停止：

- 除路径/visibility/manifest 外出现新的业务逻辑改写；
- search manifest 需要依赖 core；
- 旧路径只能通过 `#[path]` 或 `include!` 保留；
- enterprise/cloud/vortex 无法使用同一个 search crate；
- runtime benchmark 回退超过 3%。

## 10. DataFusion-first 路线的最终判断

不把 DataFusion 单独作为一个先行 PR。

原因不是 DataFusion 外部 core 调用很多；它目前剩余的直接 core 访问其实已经很少。真正的问题是引擎内部模块互相引用：

```text
SQL/index ───────► DataFusion UDF
   ▲                   │
   │                   ▼
   └──────── DataFusion planner/optimizer
                         │
                         ▼
                 TantivyOptimizeExec
                         │
                         ▼
                 Tantivy + file cache
```

把这组关系切成多个 PR，需要新增临时 shared types、跨 crate public surface 或反向 dependency。把它作为 PR 2 的一个原子迁移单元，逻辑改动最少，也最符合“一次性把 search engine 移出去”的目标。

实施时可以在本地按 DataFusion、SQL、Tantivy 的顺序处理编译错误，但评审和合并单元仍然是一个 PR、一个最终可编译 commit。

## 11. 推荐执行顺序

1. PR 1 从最新 main 创建并重新记录规模（已完成）。
2. 提取 `src/vrl` / `openobserve-vrl`，直接共享 transform/enrichment/compiler state；不增加 query context 或 prepare wrapper（已完成）。
3. 完成 cipher registry、QueryParams、file-cache/downloader、DataFusion context 和 histogram helper 的 ownership 收紧（已完成）。
4. 完成 community + private overlay 验证、边界脚本、smoke test 和性能基准；未测项目继续在 PR body 中明确标记（进行中）。
5. PR 1 与 Enterprise companion 一起合入。
6. 从新的 main 创建 PR 2 分支。
7. 按 PR 1 的最终 allowlist 一次 `git mv` 约 130 个引擎文件，修正内部路径和 manifest。
8. 通过 core façade 保留旧路径，不批量修改 API/jobs 调用方。
9. 完成所有 feature、smoke、runtime 和 build benchmark。
10. 达到接受条件后合入 PR 2。

最终评审决策建议：

- 批准“两 PR：先清边，再原子移动”的方向；
- 批准一次移动约 4.39 万行查询引擎；
- 不批准字面上清空 `service/search`；
- 不批准 DataFusion 单独先行；
- 不引入临时 query context、prepare wrapper、runtime locator、provider 或 callback 架构；
- 批准以 `src/vrl` / `openobserve-vrl` 作为共享 VRL 集成层的最终所有者。
