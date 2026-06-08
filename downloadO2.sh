#!/bin/bash

# 1. Set release type based on first argument (default: o2-enterprise)
RELEASE_TYPE=$1
BASE_URL="https://downloads.openobserve.ai/releases"

# 2. Set base URL based on release type
if [ "$RELEASE_TYPE" == "opensource" ]; then
  URL="${BASE_URL}/openobserve"
  BINARY_NAME="openobserve"
else
  URL="${BASE_URL}/o2-enterprise"
  BINARY_NAME="openobserve-ee"
fi

# 3. Optional version argument (default: latest)
VERSION=$2

# 4. Detect platform
echo "Detecting platform..."
case "$(uname -s)" in
    Linux*)     PLATFORM="linux" ;;
    Darwin*)    PLATFORM="darwin" ;;
    CYGWIN*|MINGW32*|MSYS*|MINGW*) PLATFORM="windows" ;;
    *)          echo "Unsupported platform"; exit 1 ;;
esac
echo "Platform: $PLATFORM"

# 5. Detect architecture
echo "Detecting architecture..."
ARCH=$(uname -m)
case "$ARCH" in
    x86_64)   ARCH="amd64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)        echo "Unsupported architecture"; exit 1 ;;
esac
echo "Architecture: $ARCH"

# 6. Construct file name and URL
FILE_NAME="${BINARY_NAME}-${VERSION}-${PLATFORM}-${ARCH}.tar.gz"
DOWNLOAD_URL="${URL}/${VERSION}/${FILE_NAME}"

echo "Downloading: $DOWNLOAD_URL"
curl -fLo latest_release.tar.gz "$DOWNLOAD_URL"

if [ $? -ne 0 ]; then
    echo "Error: Download failed. Make sure the file exists."
    exit 1
fi

# 7. Extract and clean up
echo "Extracting..."
tar -xzf latest_release.tar.gz
rm latest_release.tar.gz

echo "✅ Download and extraction complete!"