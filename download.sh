#!/bin/bash

# Configuration
REPO="openobserve/openobserve"  # Replace with your GitHub repository in the format "owner/repository"

# Detect platform
echo "Detecting platform..."
case "$(uname -s)" in
    Linux*)     PLATFORM="linux";;
    Darwin*)    PLATFORM="darwin";;
    CYGWIN*|MINGW32*|MSYS*|MINGW*) PLATFORM="windows";;
    *)          PLATFORM="unknown";;
esac

if [ "$PLATFORM" = "unknown" ]; then
    echo "Error: Unsupported platform."
    exit 1
fi

echo "Platform detected: $PLATFORM"

# Detect architecture
echo "Detecting architecture..."
ARCH=$(uname -m)

case "$ARCH" in
    x86_64) ARCH="amd64";;
    arm64)  ARCH="arm64";;
    aarch64) ARCH="arm64";;
    *)      ARCH="unknown";;
esac

if [ "$ARCH" = "unknown" ]; then
    echo "Error: Unsupported architecture."
    exit 1
fi

echo "Architecture detected: $ARCH"

# Fetch the latest release information from GitHub API
echo "Fetching the latest release information..."
URL="https://api.github.com/repos/$REPO/releases/latest"
LATEST_RELEASE=$(curl -s $URL)

# Extract the download URL for the asset
DOWNLOAD_URL=$(echo "$LATEST_RELEASE" | grep -o '"browser_download_url": "[^"]*' | grep "$PLATFORM" | grep "$ARCH" | head -1 | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
    echo "Error: Could not find a release asset for platform $PLATFORM and architecture $ARCH."
    exit 1
fi

# Download the asset
echo "Downloading the latest release for $PLATFORM and $ARCH..."
curl -L -o latest_release.tar.gz "$DOWNLOAD_URL"

# Extract the downloaded asset
echo "Extracting the downloaded file..."
tar -xzf latest_release.tar.gz

# Cleanup
rm latest_release.tar.gz

echo "Download and extraction complete!"
