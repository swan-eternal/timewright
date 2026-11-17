#!/usr/bin/env bash
# Start the Timewright Studio and open it in your browser.
#
#   ./start-studio.sh                # a world in this folder, or the example
#   ./start-studio.sh ~/my-world     # a world folder
#   ./start-studio.sh ~/my-world 5176  # ...on a different port
#
# The first run installs the dependencies and builds the tool (a minute or
# two). After that it is a second. Ctrl-C stops it.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

port="${2:-5175}"

# --- which world ---------------------------------------------------------
world="${1:-}"
if [ -z "$world" ]; then
  if [ -f "world.yaml" ] || [ -f "world.yml" ]; then
    world="$here"
  else
    world="$(find examples -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort | head -1 || true)"
  fi
fi
if [ -z "$world" ]; then
  echo "No world folder found. Try: ./start-studio.sh <world-folder>"
  exit 1
fi
world="$(cd "$world" && pwd)"

# --- the tool ------------------------------------------------------------
if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)..."
  npm install
fi
if [ ! -f dist/cli/index.js ]; then
  echo "Building the Studio..."
  npm run build
elif [ -n "$(find src -name '*.ts' -newer dist/cli/index.js -print -quit 2>/dev/null)" ]; then
  echo "The source is newer than the build - rebuilding..."
  npm run build
fi

url="http://127.0.0.1:$port/"

open_browser() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 &
  fi
}

# --- already up? ---------------------------------------------------------
if node --input-type=module -e '
  const http = await import("node:http");
  const request = http.get(process.argv[1], (response) => { response.resume(); process.exit(0); });
  request.on("error", () => process.exit(1));
  request.setTimeout(1000, () => request.destroy());
' "$url" >/dev/null 2>&1; then
  echo "The Studio is already running at $url"
  open_browser
  exit 0
fi

node dist/cli/index.js edit --world "$world" --port "$port" &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT INT TERM

# Wait for the server to answer before opening a browser at it.
node --input-type=module -e '
  const http = await import("node:http");
  const url = process.argv[1];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ok = await new Promise((resolve) => {
      const request = http.get(url, (response) => { response.resume(); resolve(true); });
      request.on("error", () => resolve(false));
      request.setTimeout(1000, () => { request.destroy(); resolve(false); });
    });
    if (ok) process.exit(0);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  process.exit(1);
' "$url" >/dev/null 2>&1 || echo "The server has not answered yet - open the address below yourself."

echo ""
echo "  Studio: $url"
echo "  World:  $world"
echo "  Stop:   Ctrl-C"
echo ""

open_browser
wait "$server"
