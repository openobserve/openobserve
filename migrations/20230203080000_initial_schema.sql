CREATE TABLE IF NOT EXISTS file_list
(
    id      INTEGER not null primary key autoincrement,
    stream  VARCHAR not null,
    date    VARCHAR not null,
    file    VARCHAR not null,
    deleted BOOLEAN default false not null,
    min_ts  BIGINT not null,
    max_ts  BIGINT not null,
    records BIGINT not null,
    original_size   BIGINT not null,
    compressed_size BIGINT not null
);

CREATE INDEX IF NOT EXISTS file_list_stream_idx
    on file_list (stream);

CREATE INDEX IF NOT EXISTS file_list_stream_ts_idx
    on file_list (stream, min_ts, max_ts);

CREATE UNIQUE INDEX IF NOT EXISTS file_list_file_idx
    on file_list (stream, date, file);
