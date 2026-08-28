#!/usr/bin/env node
// eddie CLI — open files in the Eddie browser editor from the terminal.
//
//   eddie notes.md            open a file (starts the server if needed)
//   eddie a.md b.json         open several files, one tab each
//   eddie                     open the home screen (recent files + browser)
//   eddie --status            is the server running?
//   eddie --stop              stop the server
//   eddie --port 5000 f.md    use a non-default port (or set EDDIE_PORT)

const path = require("path");
const { spawn } = require("child_process");

const SERVER = path.join(__dirname, "..", "server", "server.js");

function parseArgs(argv) {
  const opts = { files: [], port: parseInt(process.env.EDDIE_PORT || "4517", 10) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") opts.port = parseInt(argv[++i], 10);
    else if (a === "--stop") opts.stop = true;
    else if (a === "--status") opts.status = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else opts.files.push(a);
  }
  return opts;
}

async function health(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(700),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function startServer(port) {
  const child = spawn(process.execPath, [SERVER], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, EDDIE_PORT: String(port) },
  });
  child.unref();
}

async function ensureServer(port) {
  if (await health(port)) return true;
  startServer(port);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await health(port)) return true;
  }
  return false;
}

function openBrowser(url) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const child = spawn(cmd, [url], { detached: true, stdio: "ignore" });
  child.on("error", () => console.log(`open this in your browser: ${url}`));
  child.unref();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(`usage: eddie [--port N] [--status] [--stop] [file ...]`);
    return;
  }

  if (opts.status) {
    const h = await health(opts.port);
    console.log(h ? `eddie server v${h.version} running on port ${opts.port} (pid ${h.pid})` : "eddie server is not running");
    return;
  }

  if (opts.stop) {
    const h = await health(opts.port);
    if (!h) return console.log("eddie server is not running");
    await fetch(`http://127.0.0.1:${opts.port}/api/shutdown`, { method: "POST" });
    console.log("eddie server stopped");
    return;
  }

  if (!(await ensureServer(opts.port))) {
    console.error(`could not start eddie server on port ${opts.port}`);
    process.exit(1);
  }

  const base = `http://127.0.0.1:${opts.port}/`;
  if (opts.files.length === 0) {
    openBrowser(base);
  } else {
    for (const f of opts.files) {
      const abs = path.resolve(f);
      openBrowser(`${base}?file=${encodeURIComponent(abs)}`);
    }
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
