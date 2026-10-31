import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  tunnelConfig,
  sshArguments,
  freshSignatures,
} from "../lib/attachment-tunnel.js";

test("tunnel rejects stale, future, missing and malformed signature dates", () => {
  const now = Date.UTC(2026, 9, 31, 12);
  const version = (date) =>
    `ClamAV 1.5.4/28164/${new Date(date).toUTCString()}`;
  assert.equal(freshSignatures(version(now - 86400000), now), true);
  assert.equal(freshSignatures(version(now - 15 * 86400000), now), false);
  assert.equal(freshSignatures(version(now + 2 * 86400000), now), false);
  for (const input of [
    "",
    "PONG",
    "ClamAV 1.5.4/28164/garbage",
    "other/1/Oct 31 2026",
  ])
    assert.equal(freshSignatures(input, now), false);
});

test("tunnel configuration confines forwarding, requires pinned host identity and ignores injected SSH settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "synthetic-tunnel-"));
  try {
    const key = join(dir, "key"),
      known = join(dir, "known_hosts");
    writeFileSync(key, "synthetic placeholder, not a credential", {
      mode: 0o600,
    });
    writeFileSync(known, "synthetic placeholder, not a host key", {
      mode: 0o600,
    });
    const env = {
      ATTACHMENT_SSH_HOST: "scanner.example.invalid",
      ATTACHMENT_SSH_USER: "attachment_scan",
      ATTACHMENT_SSH_KEY_FILE: key,
      ATTACHMENT_SSH_KNOWN_HOSTS_FILE: known,
    };
    const config = tunnelConfig(env),
      args = sshArguments(config);
    assert.ok(args.includes("127.0.0.1:3311:127.0.0.1:3310"));
    for (const setting of [
      "StrictHostKeyChecking=yes",
      "IdentityAgent=none",
      "PasswordAuthentication=no",
      "ExitOnForwardFailure=yes",
      "ControlPath=none",
    ])
      assert.ok(args.includes(setting));
    assert.equal(args.at(-1), "scanner.example.invalid");
    assert.deepEqual(args.slice(0, 2), ["-F", "none"]);
    for (const host of [
      "-oProxyCommand=bad",
      "user@host",
      "host;echo bad",
      "host\nother",
      "ssh://host",
    ])
      assert.throws(() => tunnelConfig({ ...env, ATTACHMENT_SSH_HOST: host }));
    for (const changes of [
      { ATTACHMENT_SSH_USER: "root;bad" },
      { ATTACHMENT_SSH_PORT: "0" },
      { ATTACHMENT_SSH_FORWARD_PORT: "3310" },
      { ATTACHMENT_SSH_KEY_FILE: "relative" },
      { ATTACHMENT_SSH_KNOWN_HOSTS_FILE: dir },
    ])
      assert.throws(() => tunnelConfig({ ...env, ...changes }));
    if (process.platform !== "win32") {
      chmodSync(key, 0o644);
      assert.throws(() => tunnelConfig(env));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
