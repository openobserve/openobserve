#!/bin/sh
# tests running at the same time must not share a meta database, sqlite file or disk-cache tmp dir
slot_dsn() {
    case "${1#*://}" in
    */*) ;;
    *)
        echo "$1"
        return
        ;;
    esac
    path="${1%%\?*}"
    echo "${path}_slot_${NEXTEST_TEST_GLOBAL_SLOT}${1#"$path"}"
}

if [ -n "${NEXTEST_TEST_GLOBAL_SLOT:-}" ]; then
    if [ -n "${ZO_DATA_DIR:-}" ]; then
        export ZO_DATA_DIR="${ZO_DATA_DIR%/}/slot-${NEXTEST_TEST_GLOBAL_SLOT}/"
    fi
    for var in ZO_META_POSTGRES_DSN ZO_META_POSTGRES_RO_DSN ZO_META_DDL_DSN; do
        eval "dsn=\${$var:-}"
        if [ -n "$dsn" ]; then
            export "$var=$(slot_dsn "$dsn")"
        fi
    done
fi
exec "$@"
