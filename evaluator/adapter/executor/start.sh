#!/bin/sh
# Fetch the registered package, refuse to start if it is not the expected file, then serve it.
set -e
: "${PACKAGE_URL:?set PACKAGE_URL to the public URL of the .safetensors package}"
: "${PACKAGE_SHA256:?set PACKAGE_SHA256 to its sha256}"
curl -fsSL "$PACKAGE_URL" -o /app/package.safetensors
echo "$PACKAGE_SHA256  /app/package.safetensors" | sha256sum -c -
exec /app/adapterexec --package /app/package.safetensors --listen "0.0.0.0:${PORT:-8080}"
