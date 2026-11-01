import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import {
  tunnelConfig,
  startAttachmentTunnel,
} from "../lib/attachment-tunnel.js";
import { scanAttachment } from "../lib/attachment-scan.js";

// Disposable Linux CI only: generated SSH keys and synthetic scanner payloads.
// No hosting APIs, repository secrets, production files or application database.
assert.equal(process.platform, "linux");
assert.equal(process.env.CI, "true");
const dir = mkdtempSync(join(homedir(), ".synthetic-ssh-av-"));
let sshd, tunnel, scanner;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = Buffer.from("%PDF-1.7\nSynthetic tunnel document\n%%EOF");
const marker = Buffer.from(
  [
    "X5O!P%@AP[4",
    String.fromCharCode(92),
    "PZX54(P^)7CC)7}$",
    "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  ].join(""),
);
const sshdConfig = join(dir, "sshd_config"),
  known = join(dir, "known_hosts");
const key = join(dir, "client"),
  hostKey = join(dir, "host");
const env = {
  ATTACHMENT_SSH_HOST: "127.0.0.1",
  ATTACHMENT_SSH_USER: userInfo().username,
  ATTACHMENT_SSH_PORT: "22345",
  ATTACHMENT_CLAMD_PORT: "33310",
  ATTACHMENT_SSH_FORWARD_PORT: "33311",
  ATTACHMENT_SSH_KEY_FILE: key,
  ATTACHMENT_SSH_KNOWN_HOSTS_FILE: known,
};
const run = (program, args) => execFileSync(program, args, { stdio: "ignore" });
async function waitForScan(shouldWork, attempts = 45) {
  for (let i = 0; i < attempts; i++) {
    let okay = false;
    try {
      await scanAttachment(clean);
      okay = true;
    } catch (error) {
      assert.equal(error.status, 503);
    }
    if (okay === shouldWork) return;
    await sleep(1000);
  }
  assert.fail(`Scanner did not reach expected available=${shouldWork}`);
}
function startSshd() {
  sshd = spawn("sudo", ["-n", "/usr/sbin/sshd", "-D", "-e", "-f", sshdConfig], {
    stdio: "ignore",
  });
  sshd.on("error", () => {});
}
async function stopSshd() {
  // Kill only the process tree rooted in this fixture's private PID file.
  const root = Number(readFileSync(join(dir, "sshd.pid"), "utf8").trim());
  assert.ok(Number.isInteger(root) && root > 1);
  const rows = execFileSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((row) => row.trim().split(/\s+/).map(Number));
  const ids = [root];
  for (let i = 0; i < ids.length; i++)
    for (const [pid, parent] of rows)
      if (parent === ids[i] && !ids.includes(pid)) ids.push(pid);
  for (const pid of ids.reverse()) {
    try {
      run("sudo", ["-n", "kill", "-TERM", String(pid)]);
    } catch {}
  }
  await sleep(1000);
}
try {
  for (const target of [key, hostKey, join(dir, "wrong")])
    run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", target]);
  writeFileSync(
    join(dir, "authorized_keys"),
    `restrict,port-forwarding,permitopen="127.0.0.1:3310" ${readFileSync(key + ".pub", "utf8")}`,
    { mode: 0o600 },
  );
  writeFileSync(
    known,
    `[127.0.0.1]:22345 ${readFileSync(hostKey + ".pub", "utf8")}`,
    { mode: 0o600 },
  );
  writeFileSync(
    sshdConfig,
    [
      "Port 22345",
      "ListenAddress 127.0.0.1",
      `HostKey ${hostKey}`,
      `PidFile ${join(dir, "sshd.pid")}`,
      `AuthorizedKeysFile ${join(dir, "authorized_keys")}`,
      `AllowUsers ${env.ATTACHMENT_SSH_USER}`,
      "PasswordAuthentication no",
      "KbdInteractiveAuthentication no",
      "UsePAM yes",
      "AllowAgentForwarding no",
      "X11Forwarding no",
      "PermitTTY no",
      "AllowTcpForwarding local",
      "AllowStreamLocalForwarding no",
      "PermitOpen 127.0.0.1:3310",
      "GatewayPorts no",
      "MaxSessions 0",
      "LogLevel ERROR",
    ].join("\n") + "\n",
    { mode: 0o600 },
  );
  run("sudo", ["-n", "mkdir", "-p", "/run/sshd"]);
  run("sudo", ["-n", "/usr/sbin/sshd", "-t", "-f", sshdConfig]);
  process.env.ATTACHMENT_CLAMD_PORT = env.ATTACHMENT_CLAMD_PORT;
  startSshd();
  tunnel = await startAttachmentTunnel(tunnelConfig(env));
  await waitForScan(true, 180);
  console.log(
    "PASS authenticated SSH forwarding accepts clean bytes with fresh signatures",
  );
  await assert.rejects(scanAttachment(marker), (error) => error.status === 422);
  console.log(
    "PASS real ClamAV rejects standard benign AV marker through encrypted forwarding",
  );
  await new Promise((resolve, reject) => {
    const acceptance = spawn(
      process.execPath,
      ["tools/real-clamav-acceptance.mjs"],
      {
        stdio: "inherit",
        env: { ...process.env, WHATSAPP_NOTIFICATIONS_ENABLED: "0" },
      },
    );
    acceptance.once("error", reject);
    acceptance.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("API acceptance failed")),
    );
  });

  await stopSshd();
  await waitForScan(false, 1);
  startSshd();
  await waitForScan(true);
  console.log(
    "PASS listener outage fails closed and supervised connection recovers",
  );

  await tunnel.stop();
  writeFileSync(
    known,
    `[127.0.0.1]:22345 ${readFileSync(join(dir, "wrong.pub"), "utf8")}`,
  );
  tunnel = await startAttachmentTunnel(tunnelConfig(env));
  await sleep(2500);
  await waitForScan(false, 1);
  console.log("PASS incorrect pinned server identity cannot scan");

  await tunnel.stop();
  writeFileSync(
    known,
    `[127.0.0.1]:22345 ${readFileSync(hostKey + ".pub", "utf8")}`,
  );
  tunnel = await startAttachmentTunnel(
    tunnelConfig({ ...env, ATTACHMENT_SSH_KEY_FILE: join(dir, "wrong") }),
  );
  await sleep(2500);
  await waitForScan(false, 1);
  console.log("PASS unauthorized client key cannot scan");

  await tunnel.stop();
  // Stop only this job's disposable scanner before binding a protocol fixture.
  assert.match(process.env.CLAMAV_CONTAINER_ID || "", /^[a-f0-9]{12,64}$/);
  run("docker", ["stop", process.env.CLAMAV_CONTAINER_ID]);
  let signatureDate = new Date(Date.now() - 20 * 86400000),
    streams = 0;
  scanner = createServer((socket) => {
    let bytes = Buffer.alloc(0);
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 65536) return socket.destroy();
      if (bytes.equals(Buffer.from("zVERSION\0"))) {
        socket.end(`ClamAV 1.5.4/28164/${signatureDate.toUTCString()}\0`);
      } else if (
        bytes.subarray(0, 10).equals(Buffer.from("zINSTREAM\0")) &&
        bytes.length >= clean.length + 18
      ) {
        assert.deepEqual(bytes.subarray(14, 14 + clean.length), clean);
        streams++;
        socket.end("stream: OK\0");
      }
    });
  });
  await new Promise((resolve) => scanner.listen(3310, "127.0.0.1", resolve));
  tunnel = await startAttachmentTunnel(tunnelConfig(env));
  await sleep(2500);
  await waitForScan(false, 1);
  assert.equal(streams, 0);
  console.log(
    "PASS stale signature gate rejects before forwarding attachment bytes",
  );
  signatureDate = new Date();
  await waitForScan(true);
  signatureDate = new Date(Date.now() - 20 * 86400000);
  await waitForScan(false, 1);
  assert.equal(streams, 1);
  console.log(
    "PASS signatures are rechecked on every scan, including after becoming stale",
  );
  console.log("TUNNEL_ACCEPTANCE 7/7");
} finally {
  if (tunnel) await tunnel.stop();
  if (sshd) {
    try {
      await stopSshd();
    } catch {}
  }
  if (scanner) await new Promise((resolve) => scanner.close(resolve));
  chmodSync(dir, 0o700);
  rmSync(dir, { recursive: true, force: true });
}
