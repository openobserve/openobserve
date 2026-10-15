#!/bin/sh
# Downloads an OpenObserve release binary.
#
#   curl -L https://raw.githubusercontent.com/openobserve/openobserve/main/downloadO2.sh | sh -s [edition] [version]
#
#   edition: opensource | enterprise   (default: enterprise)
#   version: e.g. v1.0.4               (default: latest release)
#
# Kept to POSIX sh: the documented one-liner pipes into `sh`, which is dash on
# Debian/Ubuntu, so bash-only syntax (e.g. `==` inside `[ ]`) silently misbehaves.

BASE_URL="https://downloads.openobserve.ai/releases"
REPO_URL="https://github.com/openobserve/openobserve"
RELEASES_API="https://api.github.com/repos/openobserve/openobserve/releases?per_page=30"
# Bounded network calls, so a dropped connection fails fast instead of hanging.
NET="--connect-timeout 10 --max-time 30"

usage() {
    echo "Usage: sh downloadO2.sh [opensource|enterprise] [version]" >&2
    echo "Example: sh downloadO2.sh opensource v1.0.4" >&2
}

# 1. Edition (default: enterprise). An unknown value is an error, not a
#    silent fallback, so a typo never downloads the wrong edition.
case "${1:-enterprise}" in
    opensource|oss)
        EDITION="opensource"
        URL="${BASE_URL}/openobserve"
        BINARY_NAME="openobserve"
        ;;
    enterprise|o2-enterprise|ee)
        EDITION="enterprise"
        URL="${BASE_URL}/o2-enterprise"
        BINARY_NAME="openobserve-ee"
        ;;
    *)
        echo "Error: unknown edition '$1'." >&2
        usage
        exit 1
        ;;
esac
echo "Edition: $EDITION"

# 2. Detect platform
echo "Detecting platform..."
case "$(uname -s)" in
    Linux*)     PLATFORM="linux" ;;
    Darwin*)    PLATFORM="darwin" ;;
    CYGWIN*|MINGW32*|MSYS*|MINGW*) PLATFORM="windows" ;;
    *)          echo "Error: unsupported platform '$(uname -s)'." >&2; exit 1 ;;
esac
echo "Platform: $PLATFORM"

# 3. Detect architecture (and musl libc, e.g. Alpine, which needs its own build)
echo "Detecting architecture..."
ARCH=$(uname -m)
case "$ARCH" in
    x86_64|amd64)  ARCH="amd64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)             echo "Error: unsupported architecture '$ARCH'." >&2; exit 1 ;;
esac
LIBC=""
if [ "$PLATFORM" = "linux" ] && { ls /lib/ld-musl-* >/dev/null 2>&1 || ldd --version 2>&1 | grep -qi musl; }; then
    LIBC="-musl"
fi
echo "Architecture: $ARCH$LIBC"

# Builds that are never published: say so, rather than probing every release.
case "$EDITION/$PLATFORM/$ARCH$LIBC" in
    enterprise/darwin/amd64|*/windows/arm64|enterprise/linux/arm64-musl)
        echo "Error: no $EDITION build is published for $PLATFORM-$ARCH$LIBC." >&2
        [ "$EDITION" = "enterprise" ] && echo "The opensource edition may be available: sh -s opensource" >&2
        exit 1
        ;;
esac

# Windows builds ship as .zip, everything else as .tar.gz.
EXT="tar.gz"
[ "$PLATFORM" = "windows" ] && EXT="zip"

artifact_url() {
    echo "${URL}/$1/${BINARY_NAME}-$1-${PLATFORM}-${ARCH}${LIBC}.${EXT}"
}

# 4. Version (default: the newest stable release with a build for this
#    edition/platform). The first release GitHub lists is not always it:
#    backports of older lines can be published after a newer release, release
#    candidates are not marked as pre-releases, and the enterprise build is
#    uploaded some time after the release is published.
VERSION=$2
[ "$VERSION" = "latest" ] && VERSION=""
if [ -z "$VERSION" ]; then
    echo "Resolving latest version..."
    # Split on commas so parsing works whether or not GitHub pretty-prints.
    # shellcheck disable=SC2086
    TAGS=$(curl -fsSL $NET -A downloadO2.sh "$RELEASES_API" 2>/dev/null \
        | tr ',' '\n' \
        | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\(v[0-9][0-9.]*\)".*/\1/p' \
        | sed 's/^v//' | sort -u -t. -k1,1nr -k2,2nr -k3,3nr | sed 's/^/v/')
    if [ -z "$TAGS" ]; then
        # API unreachable or rate-limited: fall back to the "latest release" redirect.
        # shellcheck disable=SC2086
        TAGS=$(curl -fsSI $NET "$REPO_URL/releases/latest" 2>/dev/null \
            | tr -d '\r' | sed -n 's#^[Ll]ocation:.*/tag/\(v[0-9][0-9.]*\)$#\1#p')
    fi
    if [ -z "$TAGS" ]; then
        echo "Error: could not determine the latest release (offline or rate-limited?); pass a version explicitly." >&2
        usage
        exit 1
    fi
    for TAG in $TAGS; do
        # shellcheck disable=SC2086
        if curl -fsIL $NET "$(artifact_url "$TAG")" >/dev/null 2>&1; then
            VERSION=$TAG
            break
        fi
    done
    if [ -z "$VERSION" ]; then
        echo "Error: none of the recent releases has a $EDITION build for $PLATFORM-$ARCH$LIBC yet; pass a version explicitly." >&2
        exit 1
    fi
fi
# Release tags are v-prefixed; accept "1.0.4" and "V1.0.4" as well as "v1.0.4".
case "$VERSION" in
    v*) ;;
    V*) VERSION="v${VERSION#V}" ;;
    *)  VERSION="v$VERSION" ;;
esac
echo "Version: $VERSION"

# 5. Download
DOWNLOAD_URL=$(artifact_url "$VERSION")
ARCHIVE="latest_release.${EXT}"
trap 'rm -f "$ARCHIVE"' INT TERM

echo "Downloading: $DOWNLOAD_URL"
if ! curl -fLo "$ARCHIVE" "$DOWNLOAD_URL"; then
    echo "Error: Download failed. Check that $VERSION has a $EDITION build for $PLATFORM-$ARCH$LIBC." >&2
    rm -f "$ARCHIVE"
    exit 1
fi

# 6. Extract and clean up
echo "Extracting..."
if [ "$EXT" = "zip" ]; then
    # GNU tar (first on Git Bash/Cygwin's PATH) cannot read zips; Windows' own tar can.
    WIN_TAR=""
    if command -v cygpath >/dev/null 2>&1 && [ -n "$SYSTEMROOT" ]; then
        WIN_TAR="$(cygpath -u "$SYSTEMROOT")/System32/tar.exe"
    fi
    if command -v unzip >/dev/null 2>&1; then
        unzip -o -q "$ARCHIVE"
    elif [ -n "$WIN_TAR" ] && [ -x "$WIN_TAR" ]; then
        "$WIN_TAR" -xf "$ARCHIVE"
    else
        echo "Error: extracting the .zip needs 'unzip'; install it and retry." >&2
        false
    fi
else
    tar -xzf "$ARCHIVE"
fi
STATUS=$?
rm -f "$ARCHIVE"
if [ "$STATUS" -ne 0 ]; then
    echo "Error: extraction failed." >&2
    exit 1
fi

echo "✅ Download and extraction complete!"
