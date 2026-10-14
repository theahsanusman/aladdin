#!/bin/sh
set -eu
# No argument forwarding: the browser endpoint cannot be overridden by callers.
if [ "$#" -ne 0 ]; then
  echo "Agent Chrome MCP accepts no custom arguments" >&2
  exit 1
fi
/opt/homebrew/bin/python3 "$(dirname "$0")/launcher.py"
export CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS=1
export CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1
exec /opt/homebrew/opt/node@22/bin/node \
  "$HOME/.npm/_npx/15c61037b1978c83/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js" \
  --browserUrl http://127.0.0.1:9222 \
  --no-usage-statistics \
  --no-performance-crux
