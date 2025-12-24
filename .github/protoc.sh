#! /bin/bash
#

PLATFORM=$(uname -p)

if [[ $PLATFORM -eq "x86_64" ]]; then
  wget https://github.com/protocolbuffers/protobuf/releases/download/v21.12/protoc-21.12-linux-x86_64.zip
  unzip protoc-21.12-linux-x86_64.zip -d protoc
elif [[ $PLATFORM -eq "aarch64" ]]; then
  wget https://github.com/protocolbuffers/protobuf/releases/download/v21.12/protoc-21.12-linux-aarch_64.zip
  unzip protoc-21.12-linux-aarch_64.zip -d protoc
else
  echo "unsupported platform $PLATFORM"
fi

sudo cp protoc/bin/protoc /usr/local/bin/
sudo cp -r protoc/include/google /usr/local/include/

echo "successfully installed protoc"
