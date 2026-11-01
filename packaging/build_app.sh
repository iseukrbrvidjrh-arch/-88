#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
APP="$ROOT/dist/SceneLingo.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
FRAMEWORKS="$CONTENTS/Frameworks"
PYTHON_CELLAR="/opt/homebrew/Cellar/python@3.14/3.14.7"
PYTHON_FRAMEWORK="$PYTHON_CELLAR/Frameworks/Python.framework"
SITE_PACKAGES="$ROOT/.venv/lib/python3.14/site-packages"

[[ "$(uname -m)" == "arm64" ]] || { echo "错误：当前构建配置仅支持 Apple Silicon。" >&2; exit 1; }
[[ -d "$PYTHON_FRAMEWORK" && -d "$SITE_PACKAGES" ]] || { echo "错误：未找到 Python 3.14 运行环境。" >&2; exit 1; }

mkdir -p "$ROOT/dist"
if [[ -e "$APP" ]]; then rm -rf "$APP"; fi
mkdir -p "$MACOS" "$RESOURCES/project" "$RESOURCES/site-packages" "$FRAMEWORKS/ThirdParty"

/usr/bin/ditto "$PYTHON_FRAMEWORK" "$FRAMEWORKS/Python.framework"
/bin/rm -rf "$FRAMEWORKS/Python.framework/Versions/3.14/bin" \
  "$FRAMEWORKS/Python.framework/Versions/3.14/include"
/bin/rm -f "$FRAMEWORKS/Python.framework/Versions/3.14/lib/python3.14/site-packages"
/bin/cp "$PYTHON_CELLAR/bin/python3.14" "$MACOS/python3.14"
/usr/bin/ditto "$SITE_PACKAGES" "$RESOURCES/site-packages"
/usr/bin/rsync -a --exclude '.DS_Store' "$ROOT/app/" "$RESOURCES/project/app/"
/bin/cp "$ROOT/THIRD_PARTY_NOTICES.md" "$RESOURCES/project/THIRD_PARTY_NOTICES.md"
/bin/cp "$ROOT/packaging/Info.plist" "$CONTENTS/Info.plist"

THIRD_PARTY=(
  /opt/homebrew/opt/mpdecimal/lib/libmpdec.4.dylib
  /opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib
  /opt/homebrew/opt/openssl@3/lib/libssl.3.dylib
  /opt/homebrew/opt/sqlite/lib/libsqlite3.dylib
  /opt/homebrew/opt/xz/lib/liblzma.5.dylib
  /opt/homebrew/opt/zstd/lib/libzstd.1.dylib
)
for library in $THIRD_PARTY; do /bin/cp -L "$library" "$FRAMEWORKS/ThirdParty/${library:t}"; done

/usr/bin/install_name_tool -change \
  "$PYTHON_CELLAR/Frameworks/Python.framework/Versions/3.14/Python" \
  "@rpath/Python.framework/Versions/3.14/Python" "$MACOS/python3.14"
/usr/bin/install_name_tool -add_rpath "@executable_path/../Frameworks" "$MACOS/python3.14"
/usr/bin/install_name_tool -add_rpath "@executable_path/../Frameworks/ThirdParty" "$MACOS/python3.14"
/usr/bin/install_name_tool -change \
  "$PYTHON_CELLAR/Frameworks/Python.framework/Versions/3.14/Python" \
  "@rpath/Python.framework/Versions/3.14/Python" \
  "$FRAMEWORKS/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python"
/usr/bin/install_name_tool -add_rpath "@executable_path/../../../../../../.." \
  "$FRAMEWORKS/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python"
/usr/bin/install_name_tool -id "@rpath/Python.framework/Versions/3.14/Python" \
  "$FRAMEWORKS/Python.framework/Versions/3.14/Python"

for binary in "$FRAMEWORKS"/Python.framework/Versions/3.14/lib/python3.14/lib-dynload/*.so; do
  for library in $THIRD_PARTY; do
    /usr/bin/install_name_tool -change "$library" \
      "@loader_path/../../../../../../ThirdParty/${library:t}" "$binary" 2>/dev/null || true
  done
done
for binary in "$FRAMEWORKS"/ThirdParty/*.dylib; do
  for library in $THIRD_PARTY; do
    /usr/bin/install_name_tool -change "$library" "@loader_path/${library:t}" "$binary" 2>/dev/null || true
  done
  /usr/bin/install_name_tool -change "/opt/homebrew/Cellar/openssl@3/3.6.4_1/lib/libcrypto.3.dylib" \
    "@loader_path/libcrypto.3.dylib" "$binary" 2>/dev/null || true
done
for library in "$FRAMEWORKS"/ThirdParty/*.dylib; do
  /usr/bin/install_name_tool -id "@rpath/${library:t}" "$library"
done

/usr/bin/xcrun swiftc -O -target arm64-apple-macos13.0 \
  "$ROOT/packaging/SceneLingoLauncher.swift" -o "$MACOS/SceneLingo" -framework AppKit
/bin/chmod 755 "$MACOS/SceneLingo" "$MACOS/python3.14"

# Ad-hoc signing does not use an Apple developer certificate and keeps relocated Mach-O files loadable.
while IFS= read -r -d '' binary; do
  if /usr/bin/file "$binary" | /usr/bin/grep -q 'Mach-O'; then
    /usr/bin/codesign --force --sign - "$binary"
  fi
done < <(/usr/bin/find "$CONTENTS" -type f -print0)
/usr/bin/codesign --force --sign - "$APP"
/usr/bin/codesign --verify --strict "$APP"
echo "已生成：$APP"
