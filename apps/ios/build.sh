#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build/Payload/Medicine.app build/cache
IOS_SDK_PATH="$(xcrun --sdk iphoneos --show-sdk-path)"
xcrun --sdk iphoneos swiftc -parse-as-library -module-name Medicine App.swift -sdk "$IOS_SDK_PATH" -target arm64-apple-ios16.0 -framework UIKit -framework WebKit -module-cache-path build/cache -o build/Payload/Medicine.app/Medicine
cp Info.plist Icon*.png build/Payload/Medicine.app/
cd build
ditto -c -k --keepParent Payload ../吃药服务-iPhone-待签名.ipa
