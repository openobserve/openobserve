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
LATEST_API="https://api.github.com/repos/openobserve/openobserve/releases/latest"

usage() {
    echo "Usage: sh downloadO2.sh [opensource|enterprise] [version]" >&2
    echo "Example: sh downloadO2.sh opensource v1.0.4" >&2
}

# 1. Edition (default: enterprise). An unknown value is an error, not a
#    silent fallback, so a typo never downloads the wrong edition.
RELEASE_TYPE=${1:-enterprise}
case "$RELEASE_TYPE" in
    opensource|oss)
        URL="${BASE_URL}/openobserve"
        BINARY_NAME="openobserve"
        ;;
    enterprise|o2-enterprise|ee)
        URL="${BASE_URL}/o2-enterprise"
        BINARY_NAME="openobserve-ee"
        ;;
    *)
        echo "Error: unknown edition '$RELEASE_TYPE'." >&2
        usage
        exit 1
        ;;
esac
echo "Edition: $RELEASE_TYPE"

# 2. Version (default: latest GitHub release)
VERSION=$2
if [ -z "$VERSION" ]; then
    echo "Resolving latest version..."
    VERSION=$(curl -fsSL "$LATEST_API" 2>/dev/null \
        | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
        | head -n 1)
    if [ -z "$VERSION" ]; then
        echo "Error: could not determine the latest version; pass one explicitly." >&2
        usage
        exit 1
    fi
fi
echo "Version: $VERSION"

# 3. Detect platform
echo "Detecting platform..."
case "$(uname -s)" in
    Linux*)     PLATFORM="linux" ;;
    Darwin*)    PLATFORM="darwin" ;;
    CYGWIN*|MINGW32*|MSYS*|MINGW*) PLATFORM="windows" ;;
    *)          echo "Unsupported platform"; exit 1 ;;
esac
echo "Platform: $PLATFORM"

# 4. Detect architecture
echo "Detecting architecture..."
ARCH=$(uname -m)
case "$ARCH" in
    x86_64|amd64)  ARCH="amd64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)             echo "Unsupported architecture"; exit 1 ;;
esac
echo "Architecture: $ARCH"

# 5. Construct file name and URL (Windows builds ship as .zip)
EXT="tar.gz"
[ "$PLATFORM" = "windows" ] && EXT="zip"
FILE_NAME="${BINARY_NAME}-${VERSION}-${PLATFORM}-${ARCH}.${EXT}"
DOWNLOAD_URL="${URL}/${VERSION}/${FILE_NAME}"
ARCHIVE="latest_release.${EXT}"

echo "Downloading: $DOWNLOAD_URL"
if ! curl -fLo "$ARCHIVE" "$DOWNLOAD_URL"; then
    echo "Error: Download failed. Make sure the file exists." >&2
    rm -f "$ARCHIVE"
    exit 1
fi

# 6. Extract and clean up
echo "Extracting..."
if [ "$EXT" = "zip" ]; then
    if command -v unzip >/dev/null 2>&1; then
        unzip -o -q "$ARCHIVE" || exit 1
    else
        tar -xf "$ARCHIVE" || exit 1
    fi
else
    tar -xzf "$ARCHIVE" || exit 1
fi
rm -f "$ARCHIVE"

echo "✅ Download and extraction complete!"
