#!/bin/sh
set -eu
SOURCE_DIR=${1:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
RELEASE_ROOT=${2:-/srv/voidsmith/torn-platform/reviverelay/releases/client}
DIST="$SOURCE_DIR/dist"
MANIFEST="$DIST/release-manifest.json"

[ -d "$SOURCE_DIR/.git" ] || git -C "$SOURCE_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo 'Source must be a Git worktree' >&2; exit 1; }
[ -z "$(git -C "$SOURCE_DIR" status --porcelain)" ] || { echo 'Release requires a clean Git tree' >&2; exit 1; }
[ -f "$MANIFEST" ] || { echo 'release-manifest.json is missing' >&2; exit 1; }
for file in reviverelay-auto.user.js reviverelay-auto.meta.js reviverelay-manual.user.js; do [ -f "$DIST/$file" ] || { echo "Missing artifact: $file" >&2; exit 1; }; done

VERSION=$(node -e "const m=require(process.argv[1]); if(!/^\\d+\\.\\d+\\.\\d+$/.test(m.latestVersion||'')) process.exit(2); process.stdout.write(m.latestVersion)" "$MANIFEST")
AUTO_EXPECTED=$(node -e "const m=require(process.argv[1]); process.stdout.write(String(m.automatic&&m.automatic.sha256||''))" "$MANIFEST")
MANUAL_EXPECTED=$(node -e "const m=require(process.argv[1]); process.stdout.write(String(m.manual&&m.manual.sha256||''))" "$MANIFEST")
AUTO_ACTUAL=$(sha256sum "$DIST/reviverelay-auto.user.js" | awk '{print $1}')
MANUAL_ACTUAL=$(sha256sum "$DIST/reviverelay-manual.user.js" | awk '{print $1}')
[ "$AUTO_EXPECTED" = "$AUTO_ACTUAL" ] || { echo 'Automatic artifact SHA-256 mismatch' >&2; exit 1; }
[ "$MANUAL_EXPECTED" = "$MANUAL_ACTUAL" ] || { echo 'Manual artifact SHA-256 mismatch' >&2; exit 1; }

mkdir -p "$RELEASE_ROOT"
FINAL="$RELEASE_ROOT/$VERSION"
[ ! -e "$FINAL" ] || { echo "Release $VERSION already exists" >&2; exit 1; }
TMP="$RELEASE_ROOT/.staging-$VERSION-$$"
cleanup(){ rm -rf "$TMP" "$RELEASE_ROOT/.current-$$" "$RELEASE_ROOT/.manifest-$$"; }
trap cleanup EXIT HUP INT TERM
mkdir "$TMP"
cp "$DIST/reviverelay-auto.user.js" "$DIST/reviverelay-auto.meta.js" "$DIST/reviverelay-manual.user.js" "$MANIFEST" "$TMP/"
[ "$(sha256sum "$TMP/reviverelay-auto.user.js" | awk '{print $1}')" = "$AUTO_EXPECTED" ] || { echo 'Staged automatic artifact SHA-256 mismatch' >&2; exit 1; }
[ "$(sha256sum "$TMP/reviverelay-manual.user.js" | awk '{print $1}')" = "$MANUAL_EXPECTED" ] || { echo 'Staged manual artifact SHA-256 mismatch' >&2; exit 1; }
chmod -R a-w "$TMP"
mv "$TMP" "$FINAL"
ln -s "$VERSION" "$RELEASE_ROOT/.current-$$"
mv -Tf "$RELEASE_ROOT/.current-$$" "$RELEASE_ROOT/current"
cp "$FINAL/release-manifest.json" "$RELEASE_ROOT/.manifest-$$"
chmod a-w "$RELEASE_ROOT/.manifest-$$"
mv -f "$RELEASE_ROOT/.manifest-$$" "$RELEASE_ROOT/manifest.json"
trap - EXIT HUP INT TERM
printf 'Published immutable ReviveRelay client release %s\n' "$VERSION"
