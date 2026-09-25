# MIDX 索引读取与 PromQL 查询设计

本文说明 [PR #14658](https://github.com/openobserve/openobserve/pull/14658) 的读取路径，文件格式以已合并的 [PR #14860](https://github.com/openobserve/openobserve/pull/14860)（MIDX v3）为准。配套的[文件布局与写入文档](metrics-index-design.zh-CN.md)说明 block、label、directory、JSON header 和 trailer 如何生成。本文描述当前读取分支的行为；在 #14658 合并前，不应把它当作 main 已启用的查询路径。

## 1. 两种读取结果

MIDX 服务于两层不同的优化。**标签裁剪**读取 directory 和过滤需要的标签，给原 Parquet/Vortex 文件附上物理行范围；即使不走 sample blocks，仍由原文件读取样本。**Block 读取**在满足更严格条件时，从同一份 MIDX 的 sample 区域读取 timestamp/value，跳过原文件的样本读取。SQL 查询仍使用 Parquet/Vortex。

```text
候选原文件、PromQL matcher 与查询形态
          │
          ▼
先选当前文件集合的样本读取路径
          ├─ 全部有 MIDX、matcher 可由 identity labels 解释、可 streaming
          │      → 每文件读取 MIDX 一次 → 标签过滤得 block 编号
          │      → preflight → 按范围读取 MIDX sample blocks
          │      → preflight 失败则带原始 matcher 回退原文件
          └─ 混合文件或不支持 block 的查询
                 → 有 MIDX 的文件各解析一次，生成原文件 row ranges
                 → 其余文件保留完整扫描 → Parquet/Vortex 读取样本
```

这里的“整体”指当前注册给这个 selector 的文件集合，不是每个文件独立选一种样本执行器。若 100 个候选文件有 99 个具备 MIDX、1 个没有，原文件路径仍可利用前 99 个索引生成 row ranges，但不会与 block 执行器混跑。路径在解析 MIDX **之前**选定，因此关闭缓存也不需要为同一文件先算 row ranges、再解析一次目录去找 blocks。

## 2. 定位并解码 v3 metadata

从 `FileKey.key` 的 `indexed-v1-*.parquet` 或 `indexed-v1-*.vortex` 推导 `.midx` 路径。索引与原文件保持相同的组织、stream、日期、小时和文件 stem，只把目录 `metrics` 换成 `mindex`、扩展名换成 `.midx`：

```text
files/org/metrics/stream/2026/09/22/10/indexed-v1-abc.parquet
                         ↓
files/org/mindex/stream/2026/09/22/10/indexed-v1-abc.midx
```

文件名里的 `v1` 是**原数据文件布局标记**，与 MIDX v3 容器版本无关。`FileMeta.mindex_size > 0` 表示 file-list 记录了 sidecar 大小；值为 0 时不尝试打开 MIDX。读取器不查找旧的 `/midx/` 目录：改名前已存放在该目录的索引不会自动迁移，原文件仍可扫描，但无法使用旧索引加速。

```text
MIDX = [sample blocks][label frames][8 个 directory frames][JSON header][32 B trailer]
F = MIDX 文件大小
header_start    = F - 32 - trailer.header_len
directory_start = header_start - trailer.directory_len
blocks_end      = directory_start - trailer.label_len
```

读取器先用 `mindex_size` 从文件末尾取 **64 KiB**（文件更短则取整个文件），读取最后 32 字节的 `O2MIDX03` trailer，验证版本、长度和区域边界，再解析 JSON header。header 记录 parent 行数/大小、源 Arrow schema、Parquet row-group 大小、block 数、各 label frame 的名字及 raw/compressed 长度，以及八个 directory frame 的长度。Label frame 在文件中先于 directory；按 header 的长度前缀和计算各列的绝对位置，不存在独立的列 offset 表。

读取器按 trailer 先安排还需读取的范围：

1. `label_len + directory_len ≤ 1 MiB` 时，把 metadata 区域一起读入，随后复用已在尾部探测中取得的字节。
2. 区域较大且 JSON header 超出 64 KiB 探测范围时，补读 header 剩余部分及 directory；标签仍按需读取。
3. 其他情况只批量读取未覆盖的 directory 范围和本次要求的 label frames。尾部已取得的片段直接复用。

已知的 `mindex_size` 若读到无效尾部，读取器对存储执行一次 HEAD；若实际大小不同，就用实际大小重试。若大小未变仍解析失败，则返回错误。`infra::cache::file_data` 对完整 `.midx` 的校验也使用 v3 trailer，而非旧 Arrow IPC 或 v2 footer。v2 `O2MIDX02` 不受支持；其校验失败后，标签裁剪保留原文件进行扫描。

`decode_index` 把连续的 directory 字节按固定八列边界拆开，逐列验证 Zstd frame、声明的 raw 长度和数据类型，然后构建紧凑目录；只解码要求的标签列。directory 第 `i` 行和每个 label 第 `i` 行共同描述第 `i` 个 block，不按 hash 再做一次 join。标签列从源 schema 取类型；sidecar 缺失的 matcher 标签不作为已索引列参与裁剪，源 schema 中存在却未作为 identity label 存储的字段也不能被误当作已索引标签。

## 3. 原文件路径：row selection

只有选定 Parquet/Vortex 样本路径时，才调用 `metrics_index::search` 生成 row selection。它仅尝试 `MetricsFileLayout::Indexed` 且 `mindex_size > 0` 的文件，从 PromQL matcher 中找出源 schema 已知、并可由 MIDX identity labels 解释的字段。没有可用 matcher 标签时，不产生索引裁剪；OR matcher 留给原文件读取器处理。

对每个可用文件，读取器把目录的 `row_count` 按顺序累加为原文件的全局 `[start, end)` 行范围，并对 matcher 计算布尔掩码。相邻命中范围会合并；没有匹配行的索引文件从候选文件列表删除。Parquet 扫描阶段再把全局行范围拆到相应 row group；Vortex 不使用 Parquet row group。

若 sidecar 不含某个 matcher 标签，该 matcher 不会凭空删除 series：先保留可能匹配的行，最终在原文件上执行剩余过滤。索引读取、格式校验或筛选失败时记录 `warn`，该文件仍留在候选列表做完整原文件扫描。只有所有相关 matcher 都被准确覆盖、所有候选文件的索引裁剪都成功，才允许把 `keep_filters` 设为 false；不完整结果仅是**安全的超集**。

`ZO_METRICS_INDEX_SELECTION_CACHE_ENABLED` 默认关闭。在原文件路径中，它保存一次筛选得到的**原文件行范围**及 Parquet row-group 大小，而非目录或样本：

```text
key   = storage account + MIDX 路径 + 原文件行数
        + 本次参与过滤的标签名 + 完整 matcher 集合
value = Arc<Vec<Range<usize>>> + 可选 row-group 大小
```

只有 sidecar 覆盖本次请求的全部可索引标签时，才缓存该文件的 selection。命中可以跳过同一筛选条件的 MIDX 解码和 matcher 计算；整个查询是否 `exact` 还要检查其他 matcher 和文件。

在 block 路径中，同一个 selection cache 改为保存**匹配的 block 编号**，不计算 row ranges。Block-selection key 包含 storage account、原文件 key/行数/压缩大小、`mindex_size` 和完整 matcher；标签筛选结果不含时间窗口，所以可复用于不同查询时间段。缓存命中只省去 matcher 的重复计算；仍需目录和查询输出标签时，可由解析后 block cache 提供，或在本次查询中读取 MIDX。

## 4. 解析后 block cache

`metrics_index::block_cache` 是另一层按文件计费的 LRU。key 包含 storage account、原文件 key、原文件行数和压缩大小；entry 保存校验过的 MIDX 大小与 trailer，以及 `Arc<Index>`：源 schema、JSON header、紧凑 directory 和已经投影的标签列。它**不保存压缩 sample payload、解码后的 timestamp/value 或查询结果**。

原文件路径的标签裁剪，以及 block 路径的过滤和 preflight，都可以把解码后的 `Index` 放进 block cache；两条路径对同一查询互斥。Block 路径一次加载同一文件所需的 matcher、分组和输出标签列，使用这份 `Index` 完成过滤、preflight 与样本定位，**不靠全局 cache 才能避免二次解析**。缓存命中时可复用目录和已有标签列；若还需要别的标签，会从 v3 header 定位新增 label frames。按列请求不包含 directory，且只解码新增列；64 KiB 尾部探测或小 metadata 的合并读取仍可能顺带读到 directory 字节。读取中的同一文件通过 flight registry 合并并发 metadata 加载；缓存条目按文件而非按 matcher/投影组合淘汰。

`ZO_METRICS_INDEX_BLOCKS_CACHE_MAX_SIZE=0` 在配置初始化时选择节点内存的 2%，限制在 128–1024 MiB；非零且小于 10 关闭缓存；10 及以上直接指定 MiB。超过预算的单个条目不进入缓存。`used_bytes`、`evictions_total`、`hits_total` 统计的是解析后 metadata 缓存，不应拿它们与 MIDX 压缩文件总大小直接比较。底层文件缓存和操作系统页缓存另算。

## 5. 何时使用 sample blocks

候选 block 计划要求：指标索引和 streaming aggregation 功能启用；所选原文件均未删除、格式受支持、是 `indexed-v1-*` 布局，且 `records`、`compressed_size`、`mindex_size` 均为正；文件整体按 hash/time 排序。入口必须是可尝试 streaming 的 selector，matcher 必须由 identity labels 精确解释；OR 和每点附加字段等不支持的过滤留给原文件路径。文件列表和查询形态决定候选路径时还没有解析 MIDX，过滤查询的原始 matcher 会一直传到 block preflight。

这些是**整个候选文件集合**的条件。较新小时尚未完成合并、无 MIDX 的文件，或读取失败的 v2/损坏 sidecar，都可能使该集合改走原文件路径；已有 MIDX 的其他文件仍可在此前标签裁剪阶段提供行范围。这里没有“每小时一定走 block”或“匹配比例达到某阈值才走 block”的规则。

`blocks::prepare` 在输出任何样本之前做 preflight：

1. 对每份 MIDX 的标签列应用 matcher，得到递增且不重复的 block 编号；未过滤则选择所有 block。这里不计算原文件 row ranges。命中 block selection cache 时仍检查编号在当前目录界内。
2. 按目标分片数形成 hash 区间，把选中的 block 分配给相应分片。
3. 检查时间窗口、offset 溢出、block 时间戳严格递增；同一 hash 跨文件出现时，要求投影标签一致且各片段时间区间不重叠。重复时间戳或重叠片段需要原文件读取器的并列语义，不能直接走 block。
4. 只保留与实际读取窗口相交的 block，构造各分片的游标。

任何步骤失败时，`execute_partitioned` 记录 `metrics blocks fallback before execution`，带**原始 matcher** 改用 DataFusion 的 Parquet/Vortex 扫描；所需的原文件仍可按需读取，也不会为了 fallback 再解析一次 MIDX。尚未产生 block 样本，因此不会把两条读取路径的部分结果拼接。

## 6. 样本范围读取与失败边界

每个游标按目录中的绝对 `block_offset`、`block_length` 定位 MIDX 压缩字节。一次预取最多处理 **128 个选中 block**，目标字节数最多 **4 MiB**；相邻读取范围可在 **16 KiB gap**、**1 MiB span** 和总字节限制内合并。通过 `infra::storage::get_ranges` 读取后，按原 block 边界切出 payload。当前实现对本地和远端均走这条有界范围读取路径，不使用 mmap；样本 payload 不进入解析后 block cache。

`BlockDecoder` 对每个 payload 验证压缩长度、单个完整 Zstd frame 和 `row_count × 16` 的解压长度。前 `8 × N` 字节是首个 i64 时间戳及后续 i64 差值；后 `8 × N` 字节是 Float64 原始位模式的八个字节平面。Reader 还核对解出的最小/最大时间戳与 `strictly_increasing` 标志。它不会把解压出错的 payload 当作“没有样本”。

游标按 hash 汇合同一 series 在各文件中的 block，只输出实际时间窗口内的样本，应用 offset，按时间戳排序，并从 MIDX 标签构建结果标签和分组键。**preflight 成功后**发生的 payload 读取或解码错误会返回查询错误，不再回退原文件，否则已经输出的部分结果无法安全重放。

| 情况 | 标签裁剪 | 样本路径 |
|---|---|---|
| 无 MIDX、`mindex_size=0` 或仍在合并的文件 | 该文件不裁剪 | 当前集合使用原 Parquet/Vortex |
| MIDX 缺少部分 matcher 标签 | 原文件路径可保留可能匹配的行并继续原过滤 | block preflight 执行前回退原文件 |
| MIDX 匹配结果为空 | 删除该文件 | 不读取该文件样本 |
| 当前集合 99 个文件有 MIDX、1 个没有 | 有索引的文件生成 row ranges | 当前集合整体使用原文件 |
| `mindex_size>0`，但索引仍在旧 `/midx/` 目录 | 新路径打不开，该文件不裁剪 | preflight 执行前回退原文件 |
| block preflight 失败 | block 路径没有计算 row ranges | 带原始 matcher 执行前回退原文件 |
| block payload 读取或解码失败 | 已进入 block 执行 | 返回错误，不拼接部分结果 |

## 7. 原文件与 MIDX 的删除关联

默认 `ZO_COMPACT_FILE_LIST_DELETED_MODE=deleted`。合并淘汰旧文件或按保留策略删除文件时，原文件 key 进入 `file_list_deleted`；延迟删除任务默认等待 120 分钟，再按队列记录删除对象。删除器先删除 Parquet/Vortex，随后对 `indexed-v1-*` 指标文件用与读取、写入相同的路径函数推导 `files/{org}/mindex/.../*.midx` 并调用删除，最后移除队列记录。`FileListDeleted` 不存 `mindex_size`，所以即使索引从未生成，也会尝试删除推导出的路径。本地整条 stream 删除和 CLI GC 也使用新的 `/mindex/` 目录。

**当前可靠性限制：**底层 `storage::del` 对部分对象存储删除错误只记录日志，仍返回成功；因此删除器可能移除队列记录，而对应的原文件或 MIDX 实际未删。现有逻辑只能确认会调用两次删除，不能保证失败后重试。旧 `/midx/` 目录中的对象也不在新路径的删除与 GC 范围内；升级前已有旧对象需另行迁移或清理。

## 8. 代码入口与观测

| 职责 | 代码 |
|---|---|
| v3 trailer、路径与 block-scan 上下文 | `src/config/src/meta/promql/index.rs` |
| header 定位、按列读取、metadata 解码 | `src/metrics_index/src/reader.rs`、`src/metrics_index/src/block/{header,reader}.rs` |
| 标签裁剪、selection cache | `src/metrics_index/src/pruner.rs`、`src/metrics_index/src/selection_cache.rs` |
| 解析后 metadata LRU | `src/metrics_index/src/block_cache.rs` |
| 整体 block 资格、原文件注册 | `src/promql_service/src/search/grpc/storage.rs` |
| preflight、范围读取、样本 stream 与回退 | `src/promql/src/series_stream/{blocks,plan}.rs` |
| 原文件/MIDX 联动删除、延迟任务 | `src/compaction/src/deleted.rs`、`src/compaction/src/lib.rs` |
| 对象删除错误处理、整条 stream 删除、GC | `src/infra/src/storage/mod.rs`、`src/compaction/src/retention.rs`、`src/cli/basic/gc.rs` |

运行时主要观察 `promql->metrics-index` 的命中文件、失败文件、`exact` 和 selection-cache hits，`metrics blocks preflight phases` 的 metadata/selection/bucketing/validation 耗时，`metrics blocks read` 的 read batches/ranges/bytes、decoded blocks，以及 `metrics blocks fallback before execution` 的原因。`read_bytes` 是本次通过范围接口返回的字节数，不等于物理磁盘 I/O、对象存储计费字节或解析缓存占用。
