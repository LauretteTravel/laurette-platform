# Laurette OpenWA service

OpenWA 5.9.7 is installed in this isolated service folder. The official Easy API starter is in `runtime/`.

## Current state

- The Easy API can start on `127.0.0.1:8080` locally.
- This Windows environment blocked Chromium from launching under its security sandbox, so WhatsApp did not connect and no QR code was produced.
- The service is not connected to the public Laurette website and has not sent messages.
- Runtime dependencies are declared in `runtime/package.json`; install them from that directory on the target host.

## Requirements

Node.js 22.21.1 or newer and a persistent host that can run Chromium. Keep WhatsApp session/profile data and API keys private; do not commit them.

OpenWA is unofficial WhatsApp Web automation and may result in account restrictions. Use only with a number you control and customer opt-in. See the official [Easy API setup guide](https://openwa.dev/docs/getting-started/easy-api).
