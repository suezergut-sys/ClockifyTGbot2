const dotenv = require("dotenv");
const path = require("path");
const { spawn } = require("child_process");
const axios = require("axios");
const localtunnel = require("localtunnel");

dotenv.config();

const port = Number(process.env.PORT || 3010);
const botToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const tunnelProvider = String(process.env.TUNNEL_PROVIDER || "ngrok").trim().toLowerCase();
const tunnelSubdomain = String(process.env.TUNNEL_SUBDOMAIN || "").trim();
const deleteWebhookOnExit = String(process.env.DELETE_WEBHOOK_ON_EXIT || "").toLowerCase() === "true";
const reconnectDelayMs = Number(process.env.TUNNEL_RECONNECT_DELAY_MS || 5000);

const ngrokAuthToken = String(process.env.NGROK_AUTHTOKEN || "").trim();
const ngrokRegion = String(process.env.NGROK_REGION || "").trim();
const ngrokDomain = String(process.env.NGROK_DOMAIN || "").trim();
const ngrokApiAddr = String(process.env.NGROK_API_ADDR || "127.0.0.1").trim();
const ngrokApiPort = Number(process.env.NGROK_API_PORT || 4040);

if (!botToken) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN in .env");
}

let tunnel = null;
let server = null;
let isShuttingDown = false;
let reconnectTimer = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await axios.get(`http://127.0.0.1:${port}/api/health`, { timeout: 1500 });
      return;
    } catch (_err) {
      await sleep(500);
    }
  }
  throw new Error(`Local server did not start on port ${port} within ${timeoutMs}ms`);
}

async function setWebhook(baseUrl) {
  const webhookUrl = `${String(baseUrl).replace(/\/$/, "")}/api/webhook`;
  const url = `https://api.telegram.org/bot${botToken}/setWebhook`;
  const res = await axios.post(url, {
    url: webhookUrl,
    drop_pending_updates: false
  }, { timeout: 20000 });

  if (!res.data || !res.data.ok) {
    throw new Error(`setWebhook failed: ${JSON.stringify(res.data)}`);
  }
  return webhookUrl;
}

async function deleteWebhook() {
  const url = `https://api.telegram.org/bot${botToken}/deleteWebhook`;
  await axios.post(url, {
    drop_pending_updates: false
  }, { timeout: 20000 });
}

function startServer() {
  server = spawn(process.execPath, [path.resolve(__dirname, "..", "server.js")], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(port) },
    stdio: "inherit"
  });

  server.on("exit", (code, signal) => {
    if (isShuttingDown) {
      return;
    }
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[local-bot] server stopped unexpectedly (${reason})`);
    process.exit(code || 1);
  });
}

function scheduleReconnect() {
  if (isShuttingDown || reconnectTimer) {
    return;
  }
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await reconnectTunnel();
  }, reconnectDelayMs);
  console.log(`[local-bot] reconnect scheduled in ${reconnectDelayMs}ms`);
}

async function waitForNgrokPublicUrl(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await axios.get(`http://${ngrokApiAddr}:${ngrokApiPort}/api/tunnels`, { timeout: 1500 });
      const tunnels = Array.isArray(res.data && res.data.tunnels) ? res.data.tunnels : [];
      const hit = tunnels.find((item) => {
        const publicUrl = String(item && item.public_url ? item.public_url : "");
        const addr = String(item && item.config && item.config.addr ? item.config.addr : "");
        return publicUrl.startsWith("https://") && addr.includes(String(port));
      });
      if (hit && hit.public_url) {
        return String(hit.public_url);
      }
    } catch (_err) {
      // Keep waiting.
    }
    await sleep(500);
  }
  throw new Error(`Could not read ngrok public URL from http://${ngrokApiAddr}:${ngrokApiPort}/api/tunnels`);
}

async function createNgrokTunnel() {
  const args = ["http", String(port), "--log=stdout", "--log-format=json"];
  if (ngrokRegion) {
    args.push("--region", ngrokRegion);
  }
  if (ngrokDomain) {
    args.push("--domain", ngrokDomain);
  }

  const env = { ...process.env };
  if (ngrokAuthToken) {
    env.NGROK_AUTHTOKEN = ngrokAuthToken;
  }

  const proc = spawn("ngrok", args, {
    cwd: path.resolve(__dirname, ".."),
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const created = {
    provider: "ngrok",
    url: "",
    close: async () => {
      if (proc.exitCode != null) {
        return;
      }
      proc.kill("SIGTERM");
      await sleep(300);
      if (proc.exitCode == null) {
        proc.kill("SIGKILL");
      }
    }
  };

  proc.stdout.on("data", (chunk) => {
    const text = String(chunk || "").trim();
    if (!text) return;
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.lvl === "eror" || parsed.lvl === "error") {
          console.error("[local-bot] ngrok:", parsed.msg || line);
        }
      } catch {
        if (/error/i.test(line)) {
          console.error("[local-bot] ngrok:", line);
        }
      }
    }
  });

  proc.stderr.on("data", (chunk) => {
    const text = String(chunk || "").trim();
    if (text) {
      console.error("[local-bot] ngrok:", text);
    }
  });

  proc.on("exit", (code, signal) => {
    if (isShuttingDown) return;
    if (tunnel !== created) return;
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[local-bot] ngrok exited unexpectedly (${reason})`);
    scheduleReconnect();
  });

  const publicUrl = await waitForNgrokPublicUrl(30000);
  created.url = publicUrl;
  return created;
}

async function createLocalTunnel() {
  const instance = await localtunnel({
    port,
    subdomain: tunnelSubdomain || undefined
  });

  const created = {
    provider: "localtunnel",
    url: instance.url,
    close: async () => {
      await instance.close();
    }
  };

  instance.on("error", (err) => {
    if (isShuttingDown) return;
    if (tunnel !== created) return;
    console.error("[local-bot] tunnel error:", err && err.message ? err.message : err);
    scheduleReconnect();
  });

  instance.on("close", () => {
    if (isShuttingDown) return;
    if (tunnel !== created) return;
    console.error("[local-bot] tunnel closed unexpectedly");
    scheduleReconnect();
  });

  return created;
}

async function createTunnel() {
  if (tunnelProvider === "ngrok") {
    return createNgrokTunnel();
  }
  if (tunnelProvider === "localtunnel") {
    return createLocalTunnel();
  }
  throw new Error(`Unsupported TUNNEL_PROVIDER=${tunnelProvider}`);
}

async function closeTunnel() {
  if (!tunnel) return;
  const current = tunnel;
  tunnel = null;
  try {
    await current.close();
    console.log("[local-bot] tunnel closed");
  } catch (_err) {
    // Ignore close errors.
  }
}

async function reconnectTunnel() {
  if (isShuttingDown) {
    return;
  }

  try {
    await closeTunnel();

    const nextTunnel = await createTunnel();
    const webhookUrl = await setWebhook(nextTunnel.url);
    tunnel = nextTunnel;

    console.log("[local-bot] tunnel provider:", nextTunnel.provider);
    console.log("[local-bot] public tunnel:", nextTunnel.url);
    console.log("[local-bot] telegram webhook:", webhookUrl);
  } catch (err) {
    console.error("[local-bot] reconnect failed:", err.response?.data || err.message);
    scheduleReconnect();
  }
}

async function shutdown(exitCode) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    if (deleteWebhookOnExit) {
      await deleteWebhook();
      console.log("[local-bot] webhook deleted");
    }
  } catch (err) {
    console.error("[local-bot] failed to delete webhook:", err.response?.data || err.message);
  }

  await closeTunnel();

  if (server && !server.killed) {
    server.kill("SIGTERM");
  }

  process.exit(exitCode);
}

async function main() {
  if (tunnelProvider === "ngrok" && !ngrokAuthToken) {
    console.log("[local-bot] NGROK_AUTHTOKEN is not set; ngrok anonymous limits may apply");
  }

  startServer();
  await waitForServerReady(30000);
  console.log("[local-bot] local server:", `http://127.0.0.1:${port}`);
  await reconnectTunnel();
  console.log("[local-bot] press Ctrl+C to stop");
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

main().catch(async (err) => {
  console.error("[local-bot] startup failed:", err.response?.data || err.message);
  await shutdown(1);
});
