# OpenObserve crate 拆分与构建性能优化计划

## 1. 目标

在不改变 OpenObserve 对外行为的前提下，继续缩短带 `mimalloc` 的 release 冷构建和常用增量构建时间，并降低峰值内存。

本计划重点解决：

- 将仍处于关键路径上的大型 production crate 拆成可以并行编译、可以独立失效的边界。
- 将 OpenAPI 宏生成从默认 production 编译图中隔离，同时保持 Swagger 和 rate-limit 路径映射一致。
- 用相同 profile、相同机器状态和独立 target 目录比较每一个 PR，避免把符号策略变化误算成 crate 拆分收益。
- 每个阶段形成一个可独立审核、可独立回滚的 commit/PR。

非目标：

- 不在 crate 拆分 PR 中顺便修改业务行为。
- 不为了编译速度删除 Swagger、rate-limit、enterprise/cloud 等功能。
- 不把 `debug=2`、`debug=1`、packed `.dSYM` 和 unpacked 符号的结果直接相互比较。
- 大规模机械迁移可以作为一个原子 PR 供评审和测量，但在性能收益与运行时回退未经验证前不合入。

## 2. 当前状态与基线

当前拆分基线 commit：`2650525e34cb4c834517e8e18fb4e2ea3764147a`

当前结构：

```text
openobserve-core
  common / service / cipher

openobserve-api
  handler / router / OpenAPI

openobserve-jobs
  background jobs

search
  shared search types/support; PR 2 target for the search engine SCC

openobserve-vrl (`src/vrl`)
  transform definitions / enrichment registry / VRL compiler and runtime helpers

openobserve
  main / cli / migration / compatibility re-exports
```

Search 原子迁移当前状态（2026-07-16）：

- OSS PR 1：`openobserve/openobserve#13234`；Enterprise companion：
  `openobserve/o2-enterprise#2196`；
- PR 1 基线 main：`d6166aac49b1eaf76eb97456b3b489cd9b705d1d`；candidate SHA
  持续以 PR body 为准；
- 共享 VRL 集成层目录为 `src/vrl`，Cargo package 为 `openobserve-vrl`，Rust 路径为
  `openobserve_vrl`；不能命名为 `vrl`，因为该名称已由上游 dependency 使用；
- PR 1 的正确性和 feature 定向检查已部分完成，但冷构建、增量构建、RSS、binary size
  和运行时 benchmark 尚未完成，因此当前没有性能验收结论。

已测结果：

| 场景 | main | 当前版本 | 变化 |
|---|---:|---:|---:|
| 普通 release 冷构建 | 1405.13 秒 | 951.27 秒 | -32.30% |
| 普通 release 峰值 RSS | 16.29 GiB | 6.40 GiB | -60.68% |
| release-profiling 冷构建 | 1667.55 秒 | 929.53 秒 | -44.26% |
| release-profiling 峰值 RSS | 15.17 GiB | 9.95 GiB | -34.40% |
| `touch src/main.rs` 增量构建 | 用户原始结果 732 秒 | 131.36 秒 | -82.05% |

注意：release-profiling 的最终结果同时包含 crate 拆分、`debug=1` 和 unpacked debug info 的收益，不能作为纯 crate 拆分结果。保持原来的完整 packed debug info 时，拆分版本为 1744.30 秒，反而比 main 的 1667.55 秒慢 4.60%。

当前 release-profiling 关键 crate：

| 单元 | 总耗时 | frontend | codegen |
|---|---:|---:|---:|
| `openobserve-core` | 235.45 秒 | 72.15 秒 | 163.30 秒 |
| `openobserve-api` | 214.74 秒 | 59.73 秒 | 155.01 秒 |
| `openobserve-jobs` | 74.36 秒 | 5.28 秒 | 69.08 秒 |
| 根 library | 76.64 秒 | 5.14 秒 | 71.50 秒 |
| 最终 binary | 104.97 秒 | 未单列 | 未单列 |

当前 `openobserve-api` 约有 69,917 行 Rust，包含 424 个 `#[utoipa::path]`；全仓库约有 814 处 `ToSchema`。`openobserve-core` 中 `service` 约有 179,953 行，其中 `service/search` 约有 60,672 行。

由 timing 可见：

- `openobserve-api` 是下一步最适合拆分的 production 关键路径。
- `openobserve-jobs` 已经与 API 并行且完成得更早，继续拆 jobs 不会明显降低冷构建墙钟时间。
- 根 library 已经很薄；最终 binary 的约 105 秒主要是链接和最终产物生成，继续拆根 crate 很难消除。
- 仅靠继续拆 OpenObserve 自身 crate，冷构建的理论下限约为 10 分 42 秒；实际阶段目标应先设为 13 至 14 分钟。

## 3. 所有 PR 使用的统一测量协议

### 3.1 固定环境

每次比较都必须记录：

```bash
git rev-parse HEAD
rustc -Vv
cargo -V
sysctl -n hw.model
sysctl -n hw.ncpu
```

要求：

- 接通电源。
- 使用 `caffeinate` 防止睡眠和关闭屏幕导致测量失真。
- 关闭明显占用 CPU、内存或磁盘的应用。
- main 和 candidate 使用相同 Rust toolchain、相同 feature、相同环境变量。
- 每次冷构建使用全新的 `CARGO_TARGET_DIR`，不复用另一次测试的 artifact 或 sccache。
- 如果 sccache 开启，main 和 candidate 都必须关闭；如果要测 sccache，则另开一组结果，不能混合。
- 每个冷构建至少运行两次；差异超过 5% 时运行第三次，采用中位数。

### 3.2 两条独立基准线

#### A. 生产 release

用于验证 crate 拆分对真实 production build 的影响：

```bash
export CARGO_TARGET_DIR=/tmp/openobserve-build-bench/<commit>-release
/usr/bin/time -l caffeinate -dimsu \
  cargo build --features mimalloc --profile release --timings
```

#### B. 固定语义的 release-profiling

用于隔离架构变化，main 和 candidate 都强制使用同样的 `debug=1 + unpacked`：

```bash
export CARGO_TARGET_DIR=/tmp/openobserve-build-bench/<commit>-profiling
export CARGO_PROFILE_RELEASE_PROFILING_DEBUG=1
export CARGO_PROFILE_RELEASE_PROFILING_STRIP=false
export CARGO_PROFILE_RELEASE_PROFILING_SPLIT_DEBUGINFO=unpacked
/usr/bin/time -l caffeinate -dimsu \
  cargo build --features mimalloc --profile release-profiling --timings
```

需要衡量可搬运完整符号时，单独测试 packed profile，不与上述结果合并：

```bash
export CARGO_TARGET_DIR=/tmp/openobserve-build-bench/<commit>-packed
/usr/bin/time -l caffeinate -dimsu \
  cargo build --features mimalloc --profile release-profiling-packed --timings
```

如果需要完全复现旧的完整 DWARF 行为，应使用 `debug=2 + packed`，而不是当前继承 `debug=1` 的 `release-profiling-packed`。

### 3.3 每个 PR 都要测的场景

1. 普通 release 冷构建。
2. 固定语义 release-profiling 冷构建。
3. 无修改的 warm build。
4. 修改该 PR 目标领域中的一个 handler 后的增量构建。
5. 修改一个 core service 文件后的增量构建。
6. `touch src/main.rs` 后的最终 binary 重建。
7. 峰值 RSS、最终 binary 大小、target 目录大小。
8. timing 中各 OpenObserve crate 的 frontend、codegen、开始时间和结束时间。

### 3.4 接受和停止条件

满足以下任一条件可以接受拆分 PR：

- 冷构建中位数至少降低 3%，并且没有明显运行时或维护性回退。
- 目标领域增量构建至少降低 15%。
- 峰值 RSS 至少降低 10%，且墙钟时间没有超过 2% 的回退。

默认拒绝或回滚：

- 冷构建回退超过 2%，且增量构建收益不足 15%。
- 引入新的双向依赖或需要用不安全的全局状态绕过 crate 边界。
- Swagger、OpenAPI extensions 或 rate-limit 路径映射发生非预期变化。
- 写入或查询基准回退超过 3%，且不能证明是测量噪声。

所有百分比都同时保留绝对秒数，不能只报告百分比。

## 4. 分阶段实施计划

## 阶段 0：冻结基线和结果记录格式

目标：确保后续每个 PR 的数据可比较。

工作项：

- 在 main 和当前拆分分支上按第 3 节各跑至少两次冷构建。
- 保存 `cargo-timing.html`、完整 `/usr/bin/time -l` 输出和构建日志。
- 记录机器温度异常、前台负载、失败重试等情况。
- 创建统一结果表，后续每个 PR 追加一行。
- 对当前 packed、unpacked、完整 DWARF 三种符号语义做清晰标记。

交付物：

- 一个只包含 benchmark 文档和原始结果索引的 commit。
- 不修改 production 代码。

验收：

- 同一 commit 的两次冷构建差异不超过 5%；否则增加第三次测量。

建议 commit：

```text
docs: record crate split build performance baseline
```

## 阶段 1：收紧现有 crate 的直接依赖和共享边界

目标：让各 crate 只等待真正使用的直接依赖，并为 API 领域拆分准备无环共享层。

工作项：

- 审计 `openobserve-core`、`openobserve-api`、`openobserve-jobs` 的直接 dependencies。
- 删除未使用或只应由下游 crate 持有的依赖。
- 输出 API handler 之间的跨模块引用清单。
- 将纯 HTTP 通用能力收敛为明确的 shared 层，包括：
  - 认证上下文和 extractor。
  - 通用错误/响应转换。
  - request metadata。
  - 不属于业务领域的分页、路径和 header 工具。
- 领域 DTO 优先放在拥有它的领域 crate；不要把所有模型都堆入 shared。
- 保持原模块路径 re-export，避免一次性修改全仓库调用方。

设计约束：

- shared 只能依赖 core 和基础库。
- 领域 crate 可以依赖 shared；shared 不能依赖任何领域 crate。
- 不在这一阶段引入 OpenAPI 生成行为变化。

验收：

- dependency graph 无环。
- 普通 release 冷构建不回退超过 2%。
- API 现有路由和 OpenAPI 快照不变。

建议 commit：

```text
refactor: establish shared API crate boundary
```

## 阶段 2：提取 query API crate

目标：先拆出最大、边界相对明确、修改频率高的查询领域，使其与其他 handler 并行 codegen。

初始范围：

```text
search
traces query/session
promql
query-side logs endpoints
```

建议 crate：

```text
openobserve-api-query
```

工作项：

- 将 query handler 和专属模型纳入新 crate。
- 新 crate 依赖 `openobserve-core` 和 API shared，不依赖 API 聚合 crate。
- `openobserve-api` 继续拥有顶层 router，并依赖 query crate。
- 保留旧的 `handler::http::request::*` re-export 路径。
- `utoipa::path` 暂时保留，OpenAPI 聚合继续引用拆出后的公开 path 类型。
- 不在该 PR 中修改业务 SQL、DataFusion plan 或查询语义。

重点验证：

- search、traces、PromQL 的全部路由方法和路径。
- OpenAPI 中相应 paths、parameters、security、extensions 不变。
- rate-limit 能把具体请求路径还原到相同模板路径。
- 修改 query handler 时不会重编 management handler crate。

接受条件：

- 冷构建降低至少 3%，或 query handler 增量构建降低至少 20%。

建议 commit：

```text
refactor: extract query API crate
```

## 阶段 3：提取 management API crate

前置条件：阶段 2 达到接受条件；如果阶段 2 没有收益，先分析 timing，不机械继续。

初始范围：

```text
alerts
organization
dashboards
authz
users
folders
templates
destinations
```

建议 crate：

```text
openobserve-api-management
```

工作项：

- 移动领域 handler 和专属 DTO。
- 解除 management handler 对 query handler 实现细节的引用。
- 跨领域调用通过 core service 或窄接口完成，不允许领域 crate 相互依赖。
- 顶层 router 和 OpenAPI 聚合仍在 `openobserve-api`。
- 保留原模块路径的兼容 re-export。

重点验证：

- alert、dashboard、organization、authz 的 API contract。
- enterprise/cloud 条件编译路径。
- 修改 management handler 时 query crate 不重编。

接受条件：

- 相对阶段 2，冷构建再降低至少 3%，或 management handler 增量构建降低至少 20%。

建议 commit：

```text
refactor: extract management API crate
```

### 阶段 3 实测结果（2026-07-15）

#### 测试对象和环境

- baseline：`main` @ `cd8610cafa`
- candidate：`split-crates-api-management` @ `1e53a62e14`
- candidate 主要拆分提交：`5e50224090 refactor: extract management API crate`
- 机器：Apple M4，10 CPU，32 GiB 内存
- Rust：`rustc 1.97.0-nightly (e50aa6fba 2026-05-19)`
- Cargo：`cargo 1.97.0-nightly (4d1f98451 2026-05-15)`
- features：`mimalloc`
- 防休眠：所有冷构建均通过 `caffeinate -dimsu` 运行
- artifact 隔离：每个冷构建使用独立、全新的 `CARGO_TARGET_DIR`
- sccache：未启用，构建进程直接调用 `rustc`
- 运行时负载：本次只测构建性能，没有启动 OpenObserve，没有运行写入或查询负载，因此 `ZO_COMPACT_ENABLED=false` 不适用

#### 实际 manifest 配置对比

先按两个 commit 各自 manifest 的真实配置运行一次：

```bash
CARGO_TARGET_DIR=/tmp/<independent-target> \
/usr/bin/time -lp caffeinate -dimsu \
  cargo build --features mimalloc --profile release-profiling --timings
```

这组结果的符号语义不同：

- main：`debug=true + split-debuginfo=packed`
- candidate：`debug=true`，删除了显式的 packed dSYM

| 场景 | main | candidate | 变化 |
|---|---:|---:|---:|
| 冷构建 real time | 1564.29 秒（26:04） | 1188.93 秒（19:48） | -375.36 秒（-24.00%） |
| `touch src/main.rs` real time | 718.01 秒（11:58） | 145.81 秒（2:25） | -572.20 秒（-79.69%） |
| 冷构建 max RSS | 14.10 GiB | 14.10 GiB | 基本持平 |

这组结果只能说明取消 packed dSYM 显著改善最终链接后的串行尾部，不能作为 management crate 拆分收益。main 的冷构建中，最终 `dsymutil` 单独持续超过 8 分钟；`touch src/main.rs` 后也会重新支付相同类型的 dSYM 成本。

#### 固定符号语义的冷构建

为了隔离 crate 边界变化，两边都强制使用相同的 `debug=1 + unpacked`：

```bash
export CARGO_PROFILE_RELEASE_PROFILING_DEBUG=1
export CARGO_PROFILE_RELEASE_PROFILING_STRIP=false
export CARGO_PROFILE_RELEASE_PROFILING_SPLIT_DEBUGINFO=unpacked
export CARGO_TARGET_DIR=/tmp/<independent-target>

/usr/bin/time -lp caffeinate -dimsu \
  cargo build --features mimalloc --profile release-profiling --timings
```

测试采用交叉顺序降低温度和顺序偏差：

- 第 1 轮：candidate -> main
- 第 2 轮：main -> candidate

| 指标 | main run 1 | main run 2 | candidate run 1 | candidate run 2 | 两次中位数/平均值变化 |
|---|---:|---:|---:|---:|---:|
| 冷构建 real time | 799.00 秒 | 790.27 秒 | 829.40 秒 | 793.08 秒 | +16.61 秒（+2.09%） |
| max RSS | 9.662 GiB | 9.635 GiB | 8.562 GiB | 9.963 GiB | -0.386 GiB（-4.00%） |
| user CPU time | 5635.46 秒 | 5621.65 秒 | 5766.91 秒 | 5694.53 秒 | +102.17 秒（+1.82%） |

两次 main 相差 1.10%，两次 candidate 相差 4.49%，均未超过协议规定的 5%，因此没有运行第三次。candidate 的 RSS 波动较大，平均降低约 4%，不能视为稳定达到 10% 的 RSS 接受条件。

固定语义下，阶段 3 的冷构建平均从 794.64 秒变为 811.24 秒，回退 16.61 秒，即 2.09%。

#### OpenObserve crate timing

以下为两轮固定语义冷构建的平均值。各 crate 会重叠并行，不能把总耗时直接相加：

| 编译单元 | main 总耗时 | main frontend | main codegen | candidate 总耗时 | candidate frontend | candidate codegen |
|---|---:|---:|---:|---:|---:|---:|
| `openobserve-core` | 221.26 秒 | 62.34 秒 | 158.92 秒 | 223.17 秒 | 62.34 秒 | 160.83 秒 |
| `openobserve-jobs` | 96.81 秒 | 5.08 秒 | 91.73 秒 | 131.20 秒 | 5.57 秒 | 125.63 秒 |
| `openobserve-api-query` | 51.31 秒 | 4.26 秒 | 47.05 秒 | 65.83 秒 | 4.70 秒 | 61.13 秒 |
| `openobserve-api-management` | 不存在 | 不存在 | 不存在 | 50.17 秒 | 4.74 秒 | 45.43 秒 |
| `openobserve-api` | 185.87 秒 | 50.57 秒 | 135.30 秒 | 199.11 秒 | 54.37 秒 | 144.74 秒 |
| 根 library | 53.92 秒 | 4.03 秒 | 49.89 秒 | 73.15 秒 | 5.37 秒 | 67.78 秒 |
| 最终 binary | 91.26 秒 | 未单列 | 未单列 | 92.00 秒 | 未单列 | 未单列 |

`openobserve-api-management` 和 `openobserve-api-query` 能够并行编译，说明依赖边界生效；但新增并行单元会与 core、jobs 和 API 争用 CPU/内存。更重要的是，顶层 `openobserve-api` 仍然聚合所有 router 和 OpenAPI path/schema，平均耗时没有下降，反而从 185.87 秒上升到 199.11 秒，仍是项目 crate 尾部的关键路径。

#### Management handler 增量构建

在已经完成固定语义冷构建的 target 上，分别触碰同一个 alerts handler：

```bash
# main
touch src/api/src/handler/http/request/alerts/mod.rs

# candidate
touch src/api_management/src/request/alerts/mod.rs

cargo build --features mimalloc --profile release-profiling --timings
```

环境变量继续保持 `debug=1 + unpacked`。

| 指标 | main | candidate | 变化 |
|---|---:|---:|---:|
| 完整 binary 增量构建 | 226.51 秒（3:46） | 210.05 秒（3:30） | -16.46 秒（-7.27%） |
| max RSS | 9.530 GiB | 8.814 GiB | -0.716 GiB（-7.52%） |
| `openobserve-api-management` | 不存在 | 22.58 秒 | 新增独立单元 |
| `openobserve-api` | 133.26 秒 | 123.61 秒 | -9.65 秒（-7.24%） |
| 根 library | 41.53 秒 | 36.97 秒 | -4.56 秒（-10.98%） |
| 最终 binary | 90.61 秒 | 80.80 秒 | -9.81 秒（-10.83%） |

management 自身已经变成较小的独立单元，但其 rlib 发生变化后仍会触发聚合 `openobserve-api`、根 library 和最终 binary 重编，因此完整增量构建只改善 7.27%，未达到通用协议的 15%，也未达到阶段 3 的 20% 接受条件。

无修改 warm build 基本一致：main 为 0.76 秒，candidate 为 0.77 秒。

#### 产物大小

| 指标 | main | candidate | 变化 |
|---|---:|---:|---:|
| 最终 binary | 370,098,704 bytes（352.954 MiB） | 370,876,704 bytes（353.696 MiB） | +778,000 bytes（+0.21%） |
| target 目录 | 约 9.2 GiB | 约 9.3 GiB | 约 +0.1 GiB |

target 大小来自 APFS 上的 `du -sh`，只作为近似值使用。

#### 剩余瓶颈证据

阶段 3 后，production 编译图中仍然存在：

- 424 个 `utoipa::path`
- 814 处 `ToSchema`
- 中央 `ApiDoc` 中 225 个 request path 引用
- Swagger 对 `ApiDoc::openapi()` 的运行时调用
- rate-limit resource extractor 对 `ApiDoc::openapi()` 的运行时调用

因此，物理移动 handler 并没有把 OpenAPI 宏生成移出 production 编译图；`openobserve-api` 仍依赖 query、management 和其余 handler 的 schema/path，并在领域 crate 修改后重新编译。

#### 决策

- [ ] 接受为已验证的冷构建优化
- [x] 需要调整/重新定位收益
- [ ] 仅根据本次数据继续机械拆分 data API crate

阶段 3 没有达到性能接受条件：

- 固定语义冷构建回退 2.09%，没有降低 3%。
- management handler 完整增量构建只改善 7.27%，没有达到 15% 或阶段要求的 20%。
- 平均 RSS 只降低约 4%，且 candidate 两轮波动较大。
- binary 增长约 0.21%。

如果保留该 PR，应把收益描述为代码边界、领域所有权和独立 crate 测试能力，不能描述为已经验证的完整构建提速。严格按照第 3.4 节的性能规则，该 PR 当前不满足接受条件。

阶段 4 的第一个执行条件成立：`openobserve-api` 仍位于关键路径且超过 120 秒；但停止条件也已出现：顶层 OpenAPI/router 聚合和跨 crate codegen 抵消了 handler 拆分收益。因此暂停机械提取 `openobserve-api-data`，下一步优先执行阶段 5 的 OpenAPI 隔离设计。

另外，符号配置本身仍有独立且显著的优化空间：candidate 的真实 `debug=true + unpacked` 冷构建为 1188.93 秒，而固定 `debug=1 + unpacked` 两轮平均为 811.24 秒，约减少 377.69 秒（-31.77%）。如果采样 profiling 只需要符号名和行表，应把日常 `release-profiling` 固定为 `debug=1 + unpacked`，并为需要完整可搬运符号的场景保留独立 packed profile。该配置变化必须作为独立 PR/结果记录，不能算入 crate 拆分收益。

#### 未运行项目和限制

- 没有运行普通 `release` 冷构建。
- 没有运行 core service 增量场景。
- 没有启动 OpenObserve，因此没有运行 health、Swagger、rate-limit、写入或查询 smoke test。
- 没有运行写入/查询吞吐和延迟 benchmark；本次仅改变 API crate 边界，不用于得出运行时性能结论。
- 实际 manifest 配置对比只运行一次，且符号语义不同，只用于解释 dSYM 尾部成本。
- 固定语义冷构建按交叉顺序各运行两次；candidate 是顺序中的第二个或第一个，仍可能受到机器温度和前台桌面负载影响。
- timing HTML 已临时保存在 `/tmp/openobserve-build-benchmark-20260715`；该目录不是仓库中的永久 artifact。

## 阶段 4：评估是否继续拆 data/ingestion API

此阶段不是强制执行。先根据阶段 2 和阶段 3 的 timing 决定。

候选范围：

```text
ingestion
stream
pipeline
enrichment table
metrics/logs/traces ingestion endpoints
```

建议 crate：

```text
openobserve-api-data
```

执行条件：

- `openobserve-api` 在阶段 3 后仍位于关键路径，且总耗时超过 120 秒。
- 候选模块可以形成单向依赖。
- 预计能够让至少 30 秒 codegen 与其他 API crate 并行。

停止条件：

- 需要让 query、management、data 三个 crate 相互依赖。
- 顶层聚合 crate 因泛型实例化或 OpenAPI 聚合而抵消拆分收益。

建议 commit：

```text
refactor: extract data API crate
```

## 阶段 5：把 OpenAPI 宏生成移出 production 编译图

目标：默认 production build 不再展开 424 个 `utoipa::path` 和大量 `ToSchema`，但 Swagger 与 rate-limit 继续使用同一份规范数据。

关键原则：

- 只创建一个仍被 production 依赖的 `openobserve-openapi` crate 不足以实现目标；宏依然会被编译。
- generator 不能放入 production `build.rs`，否则每次冷构建仍会支付宏生成成本。
- generator 必须是单独执行的 workspace 工具，生成结果提交到仓库或作为有明确缓存键的构建 artifact。

建议结构：

```text
openobserve-openapi-gen
  仅生成时编译
  启用 openapi-gen feature
  输出 OpenAPI JSON 和 rate-limit route map

production crates
  默认不启用 openapi-gen
  include/embed 已生成的规范和路径映射
```

实施步骤：

1. 为 `utoipa::path` 和 `ToSchema` 增加非默认 `openapi-gen` 条件编译入口。
2. 创建独立 generator 命令，启用 `openapi-gen` 后生成规范。
3. 从同一个 OpenAPI 对象生成：
   - Swagger 使用的 OpenAPI JSON。
   - rate-limit 使用的 method、template path、group/resource 映射。
4. production Swagger endpoint 返回嵌入的规范；动态 base URI 等小型配置在运行时补丁处理。
5. production rate-limit 不再调用 `ApiDoc::openapi()`，改为读取生成的紧凑映射。
6. CI 单独运行 generator，并通过 `git diff --exit-code` 验证生成文件没有过期。
7. generator 不作为 production dependency，避免 Cargo feature unification 把宏重新带回默认构建。

一致性测试：

- 对 main 和 candidate 的 OpenAPI JSON 做规范化后比较。
- 比较所有 path、method、operation id、parameters、security 和自定义 extensions。
- 遍历实际 router，确认每个受 rate-limit 管理的路由都存在生成映射。
- 验证静态路径、单参数路径、多参数路径和不同 HTTP method。
- 验证 Swagger UI 和 `/api-doc/openapi.json`。
- 验证 enterprise/cloud 条件路由分别生成正确 artifact。

artifact 策略必须在实现前确定：

- 如果不同 feature 的 OpenAPI 不同，应分别生成 community、enterprise/cloud artifact。
- 生成文件必须包含生成命令和源 commit 信息，便于判断是否过期。
- 不允许启动时静默使用与当前 router 不匹配的 artifact。

接受条件：

- production 编译图中不再出现 utoipa proc-macro 展开。
- Swagger 和 rate-limit contract 测试全部通过。
- 普通 release 冷构建至少降低 5%，或 API 相关增量构建至少降低 25%。

建议 commit：

```text
build: isolate OpenAPI generation from production crates
```

## 阶段 6：评估 core/search 拆分

前置条件：API 和 OpenAPI 阶段完成后，`openobserve-core` 仍是明显关键路径。当前实施允许提前完成依赖清理 PR，但在重新采集完整 timing 前不能宣称 search 拆分带来构建收益。

现状：完整 `service/search` 同时包含纯查询引擎与 usage、audit、HTTP、file-list、dashboard、query manager 等业务编排。字面上移动整个目录会扩大重写范围；单独先移动 DataFusion 又会切断 SQL/index/Tantivy 的强连通单元。

采用两个 PR：

```text
PR 1: refactor: make search engine sources crate-independent
  - 提取 src/vrl / openobserve-vrl
  - 收紧 cipher registry、QueryParams、file cache/downloader、DataFusion context、histogram ownership
  - 建立 search/openobserve-vrl 反向依赖守卫
  - 保持实现仍位于 core，可独立回滚

PR 2: refactor: move search engine into search crate
  - 一次 git mv DataFusion + SQL + index + Tantivy + pure engine helpers
  - core 只保留 façade re-export 和业务 orchestration
  - 不按 DataFusion/SQL/Tantivy 拆成多个中间 PR
```

最终依赖方向：

```text
openobserve-core -> search
openobserve-core / search / jobs -> openobserve-vrl
openobserve-vrl -> config + vector-enrichment + upstream vrl

search -/-> openobserve-core
openobserve-vrl -/-> openobserve-core / search / jobs / enterprise
```

`openobserve-vrl` 直接拥有 `QUERY_FUNCTIONS`、organization enrichment tables、全局
GeoIP/MaxMind tables、VRL compiler config 和共享 runtime helper。DataFusion 使用已有的
`Sql.org_id` 直接注册 UDF；禁止为了传递这些状态增加 `QueryExecutionContext`、
`PreparedQueryTransform`、`prepare_query_transforms`、provider 或 callback。

PR 1 工作项：

- 将共享 VRL 状态和编译逻辑提取到 `src/vrl`，package 名为 `openobserve-vrl`；
- 将 cipher registry、query 参数、file-cache policy 放到 `search`，通用 downloader 放到 `infra`；
- 将 `SearchContextBuilder`/`register_table` 与 histogram rewrite 收入最终会随 PR 2 移动的引擎模块；
- 在 OSS 和 Enterprise overlay 中建立相同 workspace package/dependency；
- CI 同时禁止 `search -> openobserve-core` 和 `openobserve-vrl -> openobserve-core/search`；
- 完成 community、enterprise、cloud、vectorscan、vortex 的 feature matrix；
- 使用第 3 节协议测量 PR 1，未运行项必须保留在 PR body，不能写成通过。

PR 2 工作项：

- 以 PR 1 边界脚本 allowlist 为唯一迁移清单，一次移动完整查询引擎 SCC；
- 只做路径、visibility、manifest 和 façade re-export 的机械修改；
- 不顺便迁移 API/jobs 调用路径，不修改 SQL/DataFusion 查询语义；
- 分别比较 PR 2 与 PR 1、以及两 PR 最终结果与原始 main；
- 检查跨 crate 后内联、泛型单态化和最终链接对查询吞吐与 binary size 的影响。

接受条件：

- core/search 依赖严格单向。
- `openobserve-vrl` 是不依赖 core/search 的叶子集成层。
- 冷构建至少降低 3%，或修改 search 实现时增量构建至少降低 20%。
- 写入吞吐、查询吞吐和查询延迟回退不超过 3%。

停止条件：

- 需要大范围业务重写才能消除环。
- 需要 query-specific context/prepare wrapper、runtime locator 或 callback 才能共享 VRL 状态。
- 产生比当前更多的重复单态化，导致冷构建或 binary size 明显回退。
- API/OpenAPI 优化后 core 已不在关键路径。

建议 commit/PR：

```text
refactor: make search engine sources crate-independent
refactor: move search engine into search crate
```

详细迁移集合、边界与停止条件见 `SEARCH_CRATE_TWO_PR_ATOMIC_MOVE_PLAN.md`。两个 PR 都必须独立编译、测试和 benchmark；PR 1 不满足边界或行为条件时不开始 PR 2，PR 2 不满足性能条件时回滚原子移动。

## 阶段 7：停止 crate 拆分并转向其他瓶颈

出现以下情况时停止增加 crate：

- OpenObserve crate 已经不在冷构建关键路径。
- 新拆分只能改善累计 CPU 时间，不能改善墙钟时间。
- 最终 binary/link 阶段成为主要瓶颈。
- 新 crate 导致重复泛型实例化、binary 膨胀或维护复杂度超过收益。

后续候选方向：

- 缩减 DataFusion、VRL、Chromiumoxide 等大型依赖的 feature 集。
- 检查是否有只在特定运行模式使用、但默认始终编译的依赖。
- 评估 macOS 可用的更快 linker；生产和本地 profile 分开验证。
- 为本地开发提供不改变 production artifact 的快速 link/profile 配置。
- 分析最终 binary 约 105 秒中 linker、符号和代码生成的占比。

这些优化应进入新的计划和独立 PR，不与 crate 边界修改混合。

## 5. 每个阶段的正确性验证

### 5.1 编译和静态检查

至少运行：

```bash
cargo fmt --all -- --check
cargo check --workspace
cargo test --workspace
cargo build --features mimalloc --profile release
cargo build --features mimalloc --profile release-profiling
```

按环境能力补充：

```bash
cargo check -p openobserve --features enterprise
cargo check -p openobserve --features cloud
cargo check -p openobserve --features vectorscan
cargo check -p openobserve --features vortex
```

如果某个 feature 需要外部私有依赖或专用环境，PR 必须明确记录“未运行”的原因，不能写成已验证。

### 5.2 API 与运行时 smoke test

启动时强制：

```bash
export ZO_COMPACT_ENABLED=false
```

至少验证：

- `/healthz`
- `/api-doc/openapi.json`
- Swagger UI
- 一个写入请求
- 一个普通查询
- 一个 PromQL 查询
- 一个带 path parameter 的 rate-limit 路由
- 一个后台 job 的启动和关闭路径

### 5.3 运行时性能保护

crate 边界可能改变跨 crate 内联和泛型单态化。涉及 core/search、ingestion 或 hot path 的 PR 必须比较 main 与 candidate：

- 写入吞吐量和 CPU。
- 查询吞吐量、P50/P95 延迟和 CPU。
- 峰值 RSS。
- binary 大小。

测试时始终设置 `ZO_COMPACT_ENABLED=false`，main 和 candidate 使用相同数据、相同配置、相同持续时间和相同预热过程。

## 6. Commit 和 PR 规则

- 每个计划阶段至少对应一个独立 commit/PR。
- 一个 commit 只做一个边界变化，不混入格式化全仓库、依赖升级或业务修复。
- benchmark 完成后，把结果补充进该 PR 的结果文档；合并前 commit 历史必须能够独立回滚。
- 每个 PR 描述必须包含：
  - 拆分前后的依赖图。
  - 修改的模块所有权。
  - main/candidate commit SHA。
  - 完整构建命令。
  - 冷构建、增量构建、RSS、binary size 数据。
  - 正确性和 feature 验证清单。
  - 未运行项目和剩余风险。
- 如果 PR 没达到第 3.4 节阈值，应关闭或回滚，而不是以“架构更整洁”为由合并性能 PR。

## 7. Benchmark 结果记录模板

```markdown
## <PR/commit title>

- main commit:
- candidate commit:
- rustc:
- cargo:
- machine:
- power/sleep protection:
- features:
- profile/debug/split-debuginfo:

| 场景 | main run 1 | main run 2 | candidate run 1 | candidate run 2 | 中位数变化 |
|---|---:|---:|---:|---:|---:|
| release cold | | | | | |
| release-profiling cold | | | | | |
| target handler incremental | | | | | |
| core service incremental | | | | | |
| main.rs incremental | | | | | |

| 指标 | main | candidate | 变化 |
|---|---:|---:|---:|
| max RSS | | | |
| binary size | | | |
| target size | | | |
| target crate frontend | | | |
| target crate codegen | | | |

Correctness:

- [ ] fmt
- [ ] workspace check
- [ ] workspace tests
- [ ] feature checks
- [ ] health/OpenAPI/Swagger smoke
- [ ] rate-limit mapping
- [ ] write/query smoke
- [ ] runtime benchmark when required

Decision:

- [ ] accept
- [ ] revise
- [ ] rollback/close

Reason:
```

## 8. 推荐执行顺序

严格按以下顺序推进：

1. 冻结可重复基线。
2. 收紧依赖并建立 API shared 单向边界。
3. 提取 query API crate，测量后决定是否继续。
4. 提取 management API crate，测量后决定是否继续。
5. 仅在 timing 仍支持时提取 data API crate。
6. 独立设计和实现 OpenAPI generator 隔离。
7. 重新采集完整 timing。
8. 完成 search PR 1 的依赖清理与 `src/vrl` / `openobserve-vrl` 叶子边界，但在重新采集 timing 前不声明性能收益。
9. 只有 core 仍在关键路径、且 PR 1 正确性与性能保护通过时，才执行 PR 2 的一次性 search engine 原子移动。
10. 当 linker 或第三方依赖成为主瓶颈时，停止 crate 拆分。

每一步都遵循：实现一个边界、创建一个 commit、完成正确性验证、重新测量、根据数据决定下一步。
