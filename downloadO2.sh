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
RELEASES_API="https://api.github.com/repos/openobserve/openobserve/releases?per_page=20"

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

# 2. Detect platform
echo "Detecting platform..."
case "$(uname -s)" in
    Linux*)     PLATFORM="linux" ;;
    Darwin*)    PLATFORM="darwin" ;;
    CYGWIN*|MINGW32*|MSYS*|MINGW*) PLATFORM="windows" ;;
    *)          echo "Error: unsupported platform '$(uname -s)'." >&2; exit 1 ;;
esac
echo "Platform: $PLATFORM"

# 3. Detect architecture
echo "Detecting architecture..."
ARCH=$(uname -m)
case "$ARCH" in
    x86_64|amd64)  ARCH="amd64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)             echo "Error: unsupported architecture '$ARCH'." >&2; exit 1 ;;
esac
echo "Architecture: $ARCH"

# Windows builds ship as .zip, everything else as .tar.gz.
EXT="tar.gz"
[ "$PLATFORM" = "windows" ] && EXT="zip"

artifact_url() {
    echo "${URL}/$1/${BINARY_NAME}-$1-${PLATFORM}-${ARCH}.${EXT}"
}

# 4. Version (default: newest stable release with a build for this
#    edition/platform/arch). The newest tag is not always installable: GitHub
#    publishes a release before its enterprise build is uploaded, and release
#    candidates are not marked as pre-releases.
VERSION=$2
[ "$VERSION" = "latest" ] && VERSION=""
if [ -z "$VERSION" ]; then
    echo "Resolving latest version..."
    TAGS=$(curl -fsSL "$RELEASES_API" 2>/dev/null \
        | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    if [ -z "$TAGS" ]; then
        echo "Error: could not list releases from GitHub (offline or rate-limited?); pass a version explicitly." >&2
        usage
        exit 1
    fi
    for TAG in $TAGS; do
        case "$TAG" in *-*) continue ;; esac
        if curl -fsI "$(artifact_url "$TAG")" >/dev/null 2>&1; then
            VERSION=$TAG
            break
        fi
    done
    if [ -z "$VERSION" ]; then
        echo "Error: no recent release has a $RELEASE_TYPE build for $PLATFORM-$ARCH; pass a version explicitly." >&2
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

echo "Downloading: $DOWNLOAD_URL"
if ! curl -fLo "$ARCHIVE" "$DOWNLOAD_URL"; then
    echo "Error: Download failed. Check that $VERSION has a $RELEASE_TYPE build for $PLATFORM-$ARCH." >&2
    rm -f "$ARCHIVE"
    exit 1
fi

# 6. Extract and clean up
echo "Extracting..."
if [ "$EXT" = "zip" ]; then
    # GNU tar (first on Git Bash/Cygwin's PATH) cannot read zips; Windows' own tar can.
    if command -v unzip >/dev/null 2>&1; then
        unzip -o -q "$ARCHIVE"
    elif [ -x /c/Windows/System32/tar.exe ]; then
        /c/Windows/System32/tar.exe -xf "$ARCHIVE"
    elif [ -x /cygdrive/c/Windows/System32/tar.exe ]; then
        /cygdrive/c/Windows/System32/tar.exe -xf "$ARCHIVE"
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
