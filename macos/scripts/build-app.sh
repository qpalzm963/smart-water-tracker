#!/bin/bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
swift build -c release
BIN_DIR="$(swift build -c release --show-bin-path)"
APP_DIR="$PROJECT_DIR/build/小貓釣魚.app"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "$BIN_DIR/CatPond" "$APP_DIR/Contents/MacOS/CatPond"
cp "$PROJECT_DIR/Info.plist" "$APP_DIR/Contents/Info.plist"
ditto "$BIN_DIR/CatPond_CatPond.bundle" "$APP_DIR/Contents/Resources/CatPond_CatPond.bundle"
codesign --force --deep --sign - "$APP_DIR"
printf '%s\n' "$APP_DIR"
