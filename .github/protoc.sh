#! /bin/bash
set -e

PLATFORM=$(uname -p)

if [[ $PLATFORM == "x86_64" ]]; then
  curl -L --output protoc.zip "https://github.com/protocolbuffers/protobuf/releases/download/v21.12/protoc-21.12-linux-x86_64.zip"
elif [[ $PLATFORM == "aarch64" ]]; then
  curl -L --output protoc.zip "https://github.com/protocolbuffers/protobuf/releases/download/v21.12/protoc-21.12-linux-aarch_64.zip"
else
  echo "unsupported platform $PLATFORM"
  exit 1
fi

unzip protoc.zip -d protoc

sudo cp protoc/bin/protoc /usr/local/bin/
sudo cp -r protoc/include/google /usr/local/include/

echo "successfully installed protoc"
