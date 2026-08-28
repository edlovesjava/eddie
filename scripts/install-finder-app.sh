#!/usr/bin/env bash
# Build "Eddie.app" so files can be opened from Finder ("Open With → Eddie").
# Run this once on your Mac: bash scripts/install-finder-app.sh
set -euo pipefail

EDDIE_BIN="$(command -v eddie || true)"
if [ -z "$EDDIE_BIN" ]; then
  # Fall back to running the CLI straight out of this checkout.
  EDDIE_BIN="$(cd "$(dirname "$0")/.." && pwd)/bin/eddie.js"
fi

APP_DIR="$HOME/Applications"
mkdir -p "$APP_DIR"

TMP_SCRIPT="$(mktemp -t eddie-app).applescript"
cat > "$TMP_SCRIPT" <<EOF
on open theFiles
  repeat with f in theFiles
    set p to POSIX path of f
    do shell script "PATH=/opt/homebrew/bin:/usr/local/bin:\$PATH '$EDDIE_BIN' " & quoted form of p
  end repeat
end open

on run
  do shell script "PATH=/opt/homebrew/bin:/usr/local/bin:\$PATH '$EDDIE_BIN'"
end run
EOF

osacompile -o "$APP_DIR/Eddie.app" "$TMP_SCRIPT"
rm -f "$TMP_SCRIPT"

echo "Installed $APP_DIR/Eddie.app"
echo "In Finder: right-click a .md file → Open With → Other… → Eddie (check 'Always Open With' if you like)."
