# MIDX v3 文件布局与写入设计

本文以已合并的 [PR #14711](https://github.com/openobserve/openobserve/pull/14711) 写入实现和 [PR #14860](https://github.com/openobserve/openobserve/pull/14860) 的 **MIDX v3 布局**为准，说明文件格式、生成流程、原文件关联方式及内存/磁盘边界。[PR #14658](https://github.com/openobserve/openobserve/pull/14658) 中的 PromQL 读取流程另见[读取设计文档](metrics-index-read-design.zh-CN.md)；在 #14658 合并前，它尚不是 main 的查询路径。

## 1. 一个数据文件，一份 MIDX

MIDX 是 Parquet/Vortex 指标数据文件的配套索引。新写入只生成一种包含 sample blocks 的 MIDX，不再生成旧格式索引作为回退。

一份 MIDX 包含五个连续区域：

| 部分 | 内容 | 用途 |
|---|---|---|
| sample blocks | timestamp 和 value，按 block 编码压缩 | 保存时序样本 |
| label frames | 每个 block 的 identity 标签值 | 标签过滤和分组 |
| directory frames | 每个 block 的 hash、行范围、时间范围和字节位置 | 定位 block，映射原文件行范围 |
| JSON header | 父文件身份、源 schema、block 数与各列长度 | 解释并定位 label/directory frames |
| 32 字节 trailer | 三个区域长度、版本和完成标记 | 从文件末尾定位各区域 |

这些区域属于同一个 `.midx` 文件。Label 和 directory 各列是独立 Zstd frame；JSON header 与 trailer 不压缩。trailer 的长度信息可在解析 JSON 前定位区域。

原 Parquet/Vortex 文件继续保留，供 SQL 查询和 PromQL 回退读取。#14658 为满足条件的 PromQL 查询增加了直接读取 MIDX sample blocks 的路径；其条件和回退边界见[读取设计](metrics-index-read-design.zh-CN.md)。

## 2. 磁盘布局

```text
文件起点，offset = 0
┌─────────────────────────────────────────────┐
│ Sample block 0：Zstd(timestamp + value)      │
│ Sample block 1：Zstd(timestamp + value)      │
│ …                                           │
├─────────────────────────────────────────────┤ ← blocks_end / labels_start
│ label 0 的 Zstd frame                    变长 │
│ label 1 的 Zstd frame                    变长 │
│ …                                           │
├─────────────────────────────────────────────┤ ← directory_start
│ directory 第 0～7 列的 Zstd frame         变长 │
├─────────────────────────────────────────────┤ ← header_start
│ JSON header（不压缩）                    变长 │
├─────────────────────────────────────────────┤
│ trailer：区域长度、版本、O2MIDX03        32 B │
└─────────────────────────────────────────────┘
文件末尾，长度 F
```

v3 不再有 v2 的 `O2META01` metadata magic、metadata 起点字段或 `O2MIDX02` footer。文件尾部的 trailer 给出三个区域长度。已知文件长度 `F` 后，即使尚未解析 JSON，也能计算：

```text
header_start    = F - 32 - header_len
directory_start = header_start - directory_len
blocks_end      = directory_start - label_len
```

Sample blocks 占 `[0, blocks_end)`，label frames 占 `[blocks_end, directory_start)`，directory frames 占 `[directory_start, header_start)`，JSON header 占 `[header_start, F-32)`。压缩列没有单独的 offset 表；其起点由所在区域起点加上前面各列的 `compressed` 长度之和得到。

### 2.1 Sample block

一个 block 只属于一个 series，最多 **8192 个样本**。切换 series、达到样本数上限或结束输出文件时，writer 将当前 block 编码、压缩并追加到临时文件。Sample 区域没有文件头，单个 block 也没有独立 header；directory 给出该 block 的绝对 `block_offset`、压缩 `block_length` 和样本 `row_count`。

一个 block 压缩前为连续的 `16 × N` 字节：前 `8 × N` 字节是小端 i64 时间列，首值为原时间戳，后续为相邻时间戳差值（每个差值仍占 8 字节）；后 `8 × N` 字节是 Float64 原始位模式的八个字节平面。第 0 平面依次保存 N 个 value 的第 0 字节，直到第 7 平面。两部分拼接后整体使用 Zstd level 1，不是两个独立压缩流。value 不采用差分或 XOR 编码；当前格式没有逐 block checksum。

### 2.2 Directory 与内存结构

Directory 有八列，磁盘字段名和类型由格式代码中的固定列顺序隐含，**JSON header 不再存储八个 Arrow directory Field 名称**。每列按相应类型编码后独立使用 Zstd level 1。

| 下标 | 逻辑字段 | 类型 | 含义 |
|---:|---|---|---|
| 0 | hash | UInt64 | series 的 `__hash__` |
| 1 | row_start | UInt64 | 原 Parquet/Vortex 文件的 0 起算行号 |
| 2 | row_count | UInt32 | block 的样本数 |
| 3 | min_timestamp | Int64 | block 首个时间戳 |
| 4 | max_timestamp | Int64 | block 最后一个时间戳 |
| 5 | block_offset | UInt64 | 压缩 block 相对整个 MIDX 文件起点的字节位置 |
| 6 | block_length | UInt32 | 压缩 block 字节数 |
| 7 | strictly_increasing | Boolean | 时间戳是否严格递增 |

`row_start` 用于原文件的行范围裁剪，`block_offset` 用于 MIDX sample 字节读取，不能混用。磁盘上是八列压缩 frame，不是一条条 40 字节记录。读取后的 `PackedBlock` 才是 **40 字节**的紧凑结构：保存 hash、row_start、min/max timestamp、block_offset 五个 64 位值；row_count 和 block_length 由下一个条目或父文件/样本区域尾边界推导，strict 标志单独放在位图中。

排序允许同一 block 的时间戳非递减，因此 `10, 20, 20` 可写入，但 `strictly_increasing=false`。#14658 的 block preflight 会拒绝这种 block，回退原文件读取器处理重复时间戳语义；decoder 也会核对目录标志与实际样本。

### 2.3 Labels 与 block 的关联

每个 directory 列和每个 label 列都有相同的 **block 行数**，第 `i` 行共同描述第 `i` 个 block。例如 `hash[1]`、`block_offset[1]`、`path[1]` 一起属于 block 1，不需按 hash 重新 join。同一 series 分成多个 block 时，这些 block 各有一行标签；writer 在收尾之前于内存中保留每个 block 的标签值。

标签列压缩前采用自定义字典编码：先写字典项数 u32；每项写 UTF-8 长度 u32 和字节；最后按 block 顺序写 N 个 u32 字典 ID。`u32::MAX` 表示 NULL，空字符串有自己的字典项。每列整体再经 Zstd level 1 压缩。读取时依据源 Arrow schema 的字段类型解码；可为节省内存构建更窄的 Arrow 字典 ID 数组，正则需要的列则可以展平为源字符串类型。这里使用 Arrow Array/RecordBatch 作为内存结构，磁盘文件并非 Arrow IPC。

`__hash__` 只存于 directory，`_timestamp` 与 `value` 存于 sample blocks。源 schema 中的 `__name__` 若是 identity label，则与 `path`、`service` 一样保存在 label 区域。OTLP `start_time`、`flag` 等每点附加字段不作为 series identity label；源 schema 的字段名出现在 header 不代表其值也存进 MIDX。

### 2.4 JSON header

JSON header 是不压缩的 `HeaderData` 序列化结果。其逻辑结构如下；`source_schema` 是完整 Arrow Schema 的 JSON 表示，下方 `...` 和长度变量仅用于示意，不是实际 JSON 字面值：

```json
{
  "parent": {"rows": 12, "compressed_size": 3456},
  "row_group_size": 8192,
  "source_schema": {"fields": ["..."], "metadata": {}},
  "blocks": 3,
  "labels": [
    {"name": "path", "raw": 36, "compressed": 25}
  ],
  "directory": [
    {"raw": 24, "compressed": 18},
    {"raw": 24, "compressed": 17},
    {"raw": 12, "compressed": 14},
    {"raw": 24, "compressed": 17},
    {"raw": 24, "compressed": 18},
    {"raw": 24, "compressed": 17},
    {"raw": 12, "compressed": 14},
    {"raw": 3,  "compressed": 12}
  ]
}
```

`parent.rows` 是原文件**样本行数**，`blocks` 是 MIDX **block 数**。`parent.compressed_size` 是原文件大小，不是 MIDX 大小，也不参与 sample block 定位。`row_group_size` 只有 Parquet 有值，Vortex 为 `null`。`labels` 的顺序就是磁盘 label frame 的顺序；各项的 `name` 由源 schema 解释数据类型。`directory` 固定八项，按 2.2 节的顺序确定类型。`raw` 是列编码后、压缩前的字节数；`compressed` 是完整 Zstd frame 的字节数。上例的具体数字仅供说明，不表示这些值一定符合完整字典内容。

Reader 要求 label 的 `compressed` 之和等于 trailer 的 `label_len`，八个 directory 的 `compressed` 之和等于 `directory_len`，并逐列校验解压长度和行数。Header 本身没有固定 1 MiB 上限；超过 64 KiB 尾部探测长度时 writer 只记录警告，冷读可能多一次范围请求。身份标签超过 128 列也只警告内存占用，不跳过生成。

### 2.5 32 字节 trailer 与完成边界

| trailer 内偏移 | 长度 | 内容 |
|---|---:|---|
| `[0, 8)` | 8 字节 | `label_len`，全部 label frames 的压缩字节数 |
| `[8, 16)` | 8 字节 | `directory_len`，八个 directory frames 的压缩字节数 |
| `[16, 20)` | 4 字节 | `header_len`，JSON header 字节数 |
| `[20, 24)` | 4 字节 | 小端格式版本，当前为 3 |
| `[24, 32)` | 8 字节 | 最后写入的 magic `O2MIDX03` |

Writer 写入 JSON header 和 trailer 前 24 字节并 flush，最后写 magic 并再次 flush。Reader 从文件末尾校验 magic、版本、各区域长度及溢出，再验证 header、列边界、Zstd frame 和目录行数。尾部完成标记可以发现常见的未完成写入或截断，但**不是整文件 checksum**，不保证内部字节未被静默篡改；Zstd 或结构解码失败仍会拒绝使用索引。

## 3. 原文件与 MIDX 如何关联

最终文件名由 compactor 在发布时生成。通过已有路径规则从原文件名推导 MIDX 路径，例如：

```text
files/org/metrics/stream/2026/09/22/10/indexed-v1-abc.parquet
                         ↓
files/org/mindex/stream/2026/09/22/10/indexed-v1-abc.midx
```

Vortex 使用相同关联规则，原文件扩展名为 `.vortex`。

MIDX 内部不保存原文件完整 key，也不需要 `file_key_prefix` 或提前保留最终文件名。Reader 已经知道原文件路径，直接推导 MIDX 路径，不需要通过 MIDX 反查原文件。

当前仍保留 `ParentMetadata { rows, compressed_size }`。查询时将 file_list 中的原文件行数和压缩大小，与 MIDX header 中记录的对应值比较；不一致就拒绝该索引。这不是读取原文件重新计算大小，也不参与 block 定位。MIDX 自身的长度由其对象大小及 v3 trailer 校验，和原文件的 `compressed_size` 是两件事。

文件名中的 `indexed-v1-` 是现有数据文件布局标记，和 trailer 中的 MIDX v3 容器版本是不同概念。

## 4. 如何写入

开启 `ZO_METRICS_INDEX_ENABLED` 后，符合条件的 closed-hour 指标合并会生成 MIDX。Ingester 不生成 sample blocks，open-hour 合并也不生成 MIDX。

```text
按 (__hash__, _timestamp) 排序的输入 RecordBatch
                     │
          检查文件大小与 series 切分边界
                     │
             同一批或同一切片数据
              ┌──────┴──────┐
              ↓             ↓
      Parquet/Vortex    MIDX BlockWriter
      编码并写临时文件   编码并追加 sample block
              │             │
              │         在内存累计 directory/labels
              ↓             │
      完成原文件，取得行数/大小/schema
              └──────┬──────┘
                     ↓
        依次写 label frames、directory frames
             与 JSON header
                     ↓
           写 32 B trailer，最后写 magic
                     ↓
             上传原文件与 MIDX
```

### 4.1 调度和批次消费

正常生产路径由 `MergeWorker` 的 worker 数限制同时运行的文件合并任务，对应 `ZO_FILE_MERGE_THREAD_NUM`。每个 worker 等待当前 `merge_files()` 完成后再取下一批任务。

Closed-hour 合并按同一 stream、同一小时、同一 partition 路径组织文件。这里的“合并整小时文件”不是将整小时数据一次性载入内存。DataFusion 可以并行读取和排序；已有 hash/time 顺序的输入可以有序归并，最后输出单个 RecordBatch 流。

```text
上游调度多个合并批次
        ↓
固定数量的 MergeWorker
        ↓ 每个活跃 worker
DataFusion 读取/排序
        ↓
一个 mpsc channel，容量为 2 个 RecordBatch
        ↓
顺序消费 batch / slice
        ↓
当前 Parquet/Vortex writer.write(...).await
        ↓
当前 MIDX Blocks::write(...).await
        ↓
下一批，或 finish 后开始下一对文件
```

上面的双输出图表示同一批数据写入两种文件，不表示两套 series worker 并行写出。一个合并任务同一时刻只有一条输出流水线；不会为每个 series 创建一个编码任务，也不会并发写多个输出文件。

`EncodingJob` 仍通过 `spawn_blocking(work)` 执行同步编码、压缩和文件写入，并等待完成，避免阻塞异步执行线程。Vortex 使用自己的 runtime，但 batch 消费也保持顺序。

`BLOCK_ENCODING_JOBS` 及其额外的 CPU/32 上限已经删除。正常流水线中，一个合并任务最多等待一个编码或收尾任务，因此编码任务并发受外层 merge worker 数控制。取消时已经开始的 blocking 工作可能继续运行到结束；闭包保有文件等资源，`EncodingJob::Drop` 仍保留 abort 处理。这不是固定 OS 线程与 worker 的一一对应关系。

### 4.2 切分

保留现有 `ZO_COMPACT_MAX_FILE_SIZE` 文件大小切分条件，series 数由静态常量 `MAX_SERIES_PER_FILE = 1_000_000` 限制，不提供独立环境配置。

两个条件是 OR 关系。每次准备写下一片数据时，先检查当前文件的 size 条件，再通过 `SeriesSplit::take(hashes, start)` 确定本轮可以接收多少行。

Size 沿用已有的原始大小估算：

```text
估算大小 = 本次合并输入 original_size 总和
           × 当前输出已写行数 ÷ 本次合并输入总行数
```

它与 `ZO_COMPACT_MAX_FILE_SIZE` 比较，默认配置为 2048 MB。该判断不使用正在生成的压缩文件字节数，也不是逐字节的硬截断；会在写入下一批或下一片前检查。

Series 根据已有排序字段 `__hash__` 计数：

1. 遇到新 hash，当前文件的 series 计数加一。
2. `last_hash` 跨 batch 保留，同一 series 的后续样本不重复计数。
3. 已达到 100 万时，仍接受最后一个 series 的后续样本；在下一个新 series 之前停止取行。
4. `take()` 返回正数时，写入对应的 batch 切片；返回 0 时，当前文件一行也不能再接收。
5. 返回 0 后，先 finish 当前数据文件及 MIDX，重置计数，保持 `start` 不变，下一轮创建新 writer 写入剩余数据。

输入结束后，最后一个未满文件也正常 finish。空 batch 不产生文件；正好达到上限不会额外创建空文件。Size 条件可能将同一 series 分到不同文件，series 条件本身不会因为计数达到上限而切断最后一个 series。

按 series 切分适用于 hash-ordered 的 closed-hour/open-hour compactor 输出；只有 closed-hour 的 indexed 输出生成 MIDX。原有文件大小判断沿用现有估算及批次写出方式，不是新增的逐字节硬截断。

MIDX 不再使用 100 万 block、256 MiB writer metadata 估算和 128 MiB metadata 字节数作为生成上限。每个 block 的 8192 样本结构约束、schema 支持范围及长度/溢出校验仍保留。当前源 schema 要求 `__hash__` 为 UInt64、`_timestamp` 为 Int64、`value` 为 Float64；writer 不接受这些样本列中的 NULL。标签仅支持当前实现的字符串类型；超过 128 个 identity label 是内存占用警告，**不是拒绝生成的硬限制**。Series 数与标签列数是不同维度。

### 4.3 格式对应的收尾入口

`SourceMetadata::finish()` 分别调用：

- Parquet：`BlockWriter::finish_for_parquet(parent, metadata)`，从实际 Parquet metadata 中校验行数并取得 schema、row-group 大小。
- Vortex：外层先通过 `verify_vortex_source()` 验证文件，再调用 `BlockWriter::finish_for_vortex(parent, schema)`。

两者最后调用私有的 `finish_for_source()`，完成共同的行数/schema 检查，再由 writer 写出 label frames、directory frames、JSON header 和 trailer。Vortex 入口固定不传 Parquet row-group 信息，`metrics_index::block` 无须依赖 Vortex crate。

### 4.4 失败处理

正常路径只构建一次包含 block 的 MIDX。OTLP 的 `start_time`、`flag` 等每点附加列不作为 series 标签写入 MIDX。只有在源 schema 确定不受 MIDX 支持时，closed-hour 合并才发布没有 sidecar 的 `indexed-v1-*` 原文件，令 `mindex_size=0`，并以 `warn` 记录完整文件 key。不再使用 `final-unindexed-v1-*`，也不重新扫描原文件构建旧格式索引。临时文件初始化、block 写入或收尾失败会让合并返回错误，输入文件保留给调度器重试；样本 NULL、同一 hash 标签变化等确定性数据错误也会返回错误，需要排查，不能指望仅靠重试恢复。原数据文件写入失败同样向上传递错误。

上传原文件和 MIDX 都成功，发布函数才返回成功。这不是两个对象之间的原子事务；后一个上传失败时，前一个对象可能已经上传。

## 5. 哪些在内存，哪些在磁盘

| 阶段/内容 | 当前实现 |
|---|---|
| 输入 RecordBatch | 在内存中，由合并查询逐批提供 |
| 当前 block 的 timestamps/values | 在内存中，最多 8192 对 |
| block 编码、压缩临时缓冲 | 当前 block 的额外内存，写完后释放或复用 |
| 已完成的 sample blocks | 追加到 MIDX 临时文件，不在 writer 中保留全部样本 |
| directory | 当前输出文件所有 block 的 `BlockMeta` 暂存内存 |
| labels | 当前输出文件所有 block 的标签暂存内存，重复 block 标签也会复制 |
| 收尾时的 label/directory/header | 构建 Arrow 列、标签字典、列压缩 frame 和 JSON header，存在额外中间内存 |
| 已完成 MIDX | 临时文件中保存 sample blocks、label frames、directory frames、JSON header、trailer |
| Parquet 数据输出 | 指标 compactor 合并始终写入磁盘临时文件；Parquet 内部仍有 page/row-group 缓冲 |
| Vortex 数据输出 | 该指标合并路径使用磁盘临时文件 |
| 上传 | 将完整原文件和 MIDX 读回内存，再调用现有 storage 上传接口 |

MIDX 的 `flush_block()` 在 series 改变或 block 满时压缩并 `write_all()`，随后清空 timestamps/values 的有效长度；目录项和标签则继续累计。

收尾时，label/directory frames 和 JSON header 写完，再写 trailer 前 24 字节并 flush；最后写入 `O2MIDX03` magic，再次 flush。这里没有新增 `fsync` 持久化协议；“已经追加到临时文件”不等于每个 block 都同步完成了物理介质落盘。

指标 compactor 的 indexed 和 open-hour hash-merged 输出不再读取 `ZO_COMPACT_MERGE_OUTPUT` 选择内存写入：Parquet、Vortex 与 MIDX writer 均直接写入 `data_tmp_dir` 下的临时文件。Ingester 的 hash-sorted 单文件输出仍走原有 ingester 路径。发布阶段仍会将完整输出文件读回内存再上传；本次改动只移除合并写出阶段的内存 sink。

**因此，当前是 sample blocks 流式写文件、directory 与标签暂存内存并在收尾时编码，不是端到端常量内存。** 40 字节紧凑读取目录也不能用于估算 writer 的全部内存。内存峰值还受标签内容、block 数、编码中间数据、原文件 writer 缓冲和上传读回影响。Series 切分限制了单个输出的基数，但不是精确的内存预算。

本文记录现状，不引入 metadata 临时文件或分块 metadata 格式改造。

## 6. 读取入口与存储统计

v3 读取器从已知 `mindex_size` 读取 64 KiB 尾部、校验 trailer，再按 header 的列长度选择所需 label 和 directory 范围；不再读取 v2 的整块 metadata。标签裁剪可为原文件生成行范围；满足更严格条件的 PromQL streaming selector 还可直接读取 MIDX sample blocks。两级缓存、混合文件集合、preflight 和回退边界见[索引读取设计](metrics-index-read-design.zh-CN.md)。

`FileMeta.mindex_size` 是完整上传 MIDX 的大小，即 sample blocks、label frames、directory frames、JSON header 和 trailer 的总字节数，并传播到 file_list、history、dump、stream_stats、RPC/API 和跨集群统计。

| 字段 | 含义 |
|---|---|
| `compressed_size` | 原 Parquet/Vortex 文件大小 |
| `index_size` | Tantivy 索引大小 |
| `mindex_size` | MIDX 文件大小；没有生成 MIDX 时为 0 |

旧记录缺少 `mindex_size` 时默认 0；当前查询不会仅凭同名对象存在就猜测 MIDX，而是跳过 sidecar、保留原文件扫描，不扫描存储回填。`mindex_size` 记录的大小若过期，读取器会 HEAD 对象并以实际大小重试。v2 sidecar 不符合 `O2MIDX03`，不能作为 v3 解析；失败时标签裁剪保留原文件，block preflight 不能用该 sidecar。

## 7. 模块职责

| 模块 | 当前职责 |
|---|---|
| `config::meta::promql::index` | 公共 v3 trailer、MIDX 路径推导及 block-scan 上下文；infra 可据此校验完成标记而不依赖 index crate |
| `metrics_index::block` | sample 编解码、label/directory 列编码、JSON header、结构校验及 `BlockWriter` |
| `metrics_index::reader` / `pruner` | 从存储定位所需 v3 列、标签筛选与原文件行范围计算 |
| `metrics_index::selection_cache` / `block_cache` | 分别缓存筛选后的行范围、解析后的目录与标签列；后者属于 #14658 读取分支 |
| `search::datafusion::merge` | 原文件与 MIDX 的写入组织、大小/series 切分和临时文件 |
| `compaction` | 调度合并、上传原文件与 MIDX、记录 `mindex_size` 并发布 file-list |
| `promql_service` / `promql::series_stream` | 在 #14658 中决定整体 block 资格、执行 preflight、读取 sample blocks 与回退 |

## 8. 代码入口

已合并的 v3 写入与格式基线见 [PR #14860](https://github.com/openobserve/openobserve/pull/14860)：

- [Trailer 与 MIDX 路径](../src/config/src/meta/promql/midx.rs)：main 合并时的路径；#14658 将模块整理为 `index.rs`。
- [Writer 与 v3 header](../src/metrics_index/src/block/writer.rs)、[header 结构](../src/metrics_index/src/block/header.rs)。
- [样本和 metadata 列编码](../src/metrics_index/src/block/compact.rs)、[紧凑目录](../src/metrics_index/src/block/directory.rs)。
- [指标合并输出](../src/search/src/datafusion/merge/metrics.rs)、[MIDX 写入协调](../src/search/src/datafusion/merge/metrics_index.rs)、[上传与 `mindex_size`](../src/compaction/src/merge/file.rs)。

[PR #14658](https://github.com/openobserve/openobserve/pull/14658) 的读取分支在上述格式上增加解析后 block cache、PromQL block preflight 和样本范围读取。具体执行链路与代码路径在[读取设计文档](metrics-index-read-design.zh-CN.md)第 7 节。
