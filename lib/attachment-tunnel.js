import { spawn } from "node:child_process";
import { createServer, connect, isIP } from "node:net";
import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";

const invalid = () => new Error("Invalid attachment tunnel configuration");
function port(value, fallback, minimum = 1024) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < minimum || n > 65535) throw invalid();
  return n;
}
function privateFile(path, secret) {
  if (!path || !isAbsolute(path) || /[\r\n\0]/.test(path)) throw invalid();
  if (!secret && process.platform !== "win32" && /[\s"'\\]/.test(path))
    throw invalid();
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw invalid();
  if (process.platform !== "win32") {
    if (stat.uid !== process.getuid()) throw invalid();
    if (stat.mode & (secret ? 0o077 : 0o022)) throw invalid();
  }
  return path;
}

export function tunnelConfig(env = process.env) {
  const host = env.ATTACHMENT_SSH_HOST || "";
  // Literal IPs or DNS names only: no URI, options, username or shell syntax.
  if (
    !isIP(host) &&
    !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)
  )
    throw invalid();
  const user = env.ATTACHMENT_SSH_USER || "";
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(user)) throw invalid();
  const config = {
    host,
    user,
    sshPort: port(env.ATTACHMENT_SSH_PORT, 22, 1),
    localPort: port(env.ATTACHMENT_CLAMD_PORT, 3310),
    forwardPort: port(env.ATTACHMENT_SSH_FORWARD_PORT, 3311),
    key: privateFile(env.ATTACHMENT_SSH_KEY_FILE, true),
    knownHosts: privateFile(env.ATTACHMENT_SSH_KNOWN_HOSTS_FILE, false),
  };
  if (config.localPort === config.forwardPort) throw invalid();
  return Object.freeze(config);
}

export function sshArguments(c) {
  return [
    "-F",
    "none",
    "-N",
    "-T",
    "-n",
    "-a",
    "-x",
    "-p",
    String(c.sshPort),
    "-l",
    c.user,
    "-i",
    c.key,
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "IdentityAgent=none",
    "-o",
    "PreferredAuthentications=publickey",
    "-o",
    "PasswordAuthentication=no",
    "-o",
    "KbdInteractiveAuthentication=no",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${c.knownHosts}`,
    "-o",
    "GlobalKnownHostsFile=/dev/null",
    "-o",
    "UpdateHostKeys=no",
    "-o",
    "HostKeyAlgorithms=ssh-ed25519",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ConnectTimeout=5",
    "-o",
    "ServerAliveInterval=10",
    "-o",
    "ServerAliveCountMax=2",
    "-o",
    "ControlMaster=no",
    "-o",
    "ControlPath=none",
    "-o",
    "PermitLocalCommand=no",
    "-o",
    "EscapeChar=none",
    "-o",
    "LogLevel=QUIET",
    "-L",
    `127.0.0.1:${c.forwardPort}:127.0.0.1:3310`,
    c.host,
  ];
}

export function freshSignatures(version, now = Date.now()) {
  if (!/^ClamAV [^/\r\n]+\/\d+\//.test(version)) return false;
  const date = Date.parse(version.split("/").slice(2).join("/"));
  return (
    Number.isFinite(date) &&
    date <= now + 86400000 &&
    now - date <= 14 * 86400000
  );
}

function versionThroughTunnel(port, sockets) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    sockets.add(socket);
    let answer = "",
      done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      socket.destroy();
      error ? reject(error) : resolve(answer.slice(0, answer.indexOf("\0")));
    };
    socket.on("close", () => {
      sockets.delete(socket);
      finish(new Error("Scanner unavailable"));
    });
    socket.on("error", () => finish(new Error("Scanner unavailable")));
    socket.setTimeout(2000, () => finish(new Error("Scanner unavailable")));
    socket.on("connect", () => socket.write("zVERSION\0"));
    socket.on("data", (chunk) => {
      answer += chunk.toString("utf8");
      if (answer.length > 4096)
        return finish(new Error("Invalid scanner response"));
      if (answer.includes("\0")) finish();
    });
  });
}

// Optional Linux deployment helper. The application still uses loopback only.
// No shell, customer payload logs, files, database handles or provider API calls.
export async function startAttachmentTunnel(config, { log = () => {} } = {}) {
  const sockets = new Set();
  let child,
    timer,
    stopping = false,
    failures = 0,
    active = 0;
  const dropConnections = () => {
    for (const socket of sockets) socket.destroy();
  };
  const relay = createServer({ pauseOnConnect: true }, async (client) => {
    if (active >= 4 || stopping || !child || child.exitCode !== null)
      return client.destroy();
    active++;
    sockets.add(client);
    client.on("error", () => {});
    client.once("close", () => {
      active--;
      sockets.delete(client);
    });
    client.setTimeout(10000, () => client.destroy());
    try {
      const processAtStart = child;
      const version = await versionThroughTunnel(config.forwardPort, sockets);
      if (
        stopping ||
        client.destroyed ||
        child !== processAtStart ||
        !freshSignatures(version)
      )
        return client.destroy();
      const upstream = connect({ host: "127.0.0.1", port: config.forwardPort });
      sockets.add(upstream);
      upstream.setTimeout(10000, () => upstream.destroy());
      upstream.on("error", () => client.destroy());
      upstream.once("close", () => {
        sockets.delete(upstream);
        client.destroy();
      });
      client.once("close", () => upstream.destroy());
      upstream.on("connect", () => {
        failures = 0;
        client.pipe(upstream).pipe(client);
        client.resume();
      });
    } catch {
      client.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    relay.once("error", reject);
    relay.listen(config.localPort, "127.0.0.1", resolve);
  });
  relay.on("error", () => log("attachment_tunnel_listener_error"));
  function launch() {
    if (stopping) return;
    child = spawn("ssh", sshArguments(config), {
      shell: false,
      stdio: "ignore",
      // Do not give the SSH client application, database or MFA credentials.
      env: { PATH: process.env.PATH || "/usr/bin:/bin", LANG: "C" },
    });
    let ended = false;
    const endedOnce = () => {
      if (ended) return;
      ended = true;
      dropConnections();
      if (stopping) return;
      log("attachment_tunnel_unavailable");
      timer = setTimeout(
        launch,
        Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)),
      );
    };
    child.once("error", endedOnce);
    child.once("exit", endedOnce);
  }
  launch();
  return {
    async stop() {
      if (stopping) return;
      stopping = true;
      clearTimeout(timer);
      dropConnections();
      const closed = new Promise((resolve) => relay.close(resolve));
      if (child && child.exitCode === null && child.pid) {
        await new Promise((resolve) => {
          const killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
          child.once("exit", () => {
            clearTimeout(killTimer);
            resolve();
          });
          child.kill("SIGTERM");
        });
      }
      await closed;
    },
  };
}
