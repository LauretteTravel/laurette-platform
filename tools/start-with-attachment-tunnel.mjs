import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  tunnelConfig,
  startAttachmentTunnel,
} from "../lib/attachment-tunnel.js";

// Explicit alternate start command only; normal server.js startup is unchanged.
try {
  if (process.platform !== "linux")
    throw new Error("Linux with OpenSSH required");
  if (spawnSync("ssh", ["-V"], { stdio: "ignore", shell: false }).status !== 0)
    throw new Error("OpenSSH required");
  const config = tunnelConfig();
  const tunnel = await startAttachmentTunnel(config, {
    log: (event) => console.error(event),
  });
  const app = spawn(
    process.execPath,
    [fileURLToPath(new URL("../server.js", import.meta.url))],
    {
      stdio: "inherit",
      env: { ...process.env, ATTACHMENT_CLAMD_PORT: String(config.localPort) },
      shell: false,
    },
  );
  let stopping = false;
  async function stop(code, signal = "SIGTERM") {
    if (stopping) return;
    stopping = true;
    const appClosed = new Promise((resolve) => {
      if (app.exitCode !== null || !app.pid || app.signalCode) return resolve();
      const timer = setTimeout(() => app.kill("SIGKILL"), 5000);
      app.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      app.kill(signal);
    });
    await Promise.all([tunnel.stop(), appClosed]);
    process.exitCode = code;
  }
  app.on("error", () => {
    console.error("attachment_application_start_failed");
    void stop(1);
  });
  app.on("exit", (code) => void stop(code ?? 1));
  process.once("SIGTERM", () => void stop(0));
  process.once("SIGINT", () => void stop(0, "SIGINT"));
} catch {
  console.error(
    "attachment_tunnel_start_failed: check private configuration and OpenSSH",
  );
  process.exitCode = 1;
}
