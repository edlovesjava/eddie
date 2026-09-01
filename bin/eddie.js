#!/usr/bin/env node
// eddie CLI — open files in the Eddie browser editor from the terminal.
//
//   eddie notes.md            open a file (starts the server if needed)
//   eddie a.md b.json         open several files, one tab each
//   eddie                     open the home screen (recent files + browser)
//   eddie upgrade             git pull + rebuild + restart the server
//   eddie restart             restart the server (picks up new code)
//   eddie status              is the server running?
//   eddie stop                stop the server
//   eddie --port 5000 f.md    use a non-default port (or set EDDIE_PORT)

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, "server", "server.js");
const COMMANDS = ["upgrade", "restart", "stop", "status"];

function parseArgs(argv) {
  const opts = { files: [], port: parseInt(process.env.EDDIE_PORT || "4517", 10) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") opts.port = parseInt(argv[++i], 10);
    else if (a.startsWith("--") && COMMANDS.includes(a.slice(2))) opts[a.slice(2)] = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    // Bare command words work too, unless a file by that name actually exists.
    else if (COMMANDS.includes(a) && !fs.existsSync(a)) opts[a] = true;
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

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd, stdio: "inherit" });
    c.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`))
    );
    c.on("error", reject);
  });
}

async function stopServer(port) {
  if (!(await health(port))) return false;
  await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: "POST" });
  for (let i = 0; i < 20 && (await health(port)); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}

async function restart(port) {
  const wasRunning = await stopServer(port);
  if (!(await ensureServer(port))) throw new Error(`could not start eddie server on port ${port}`);
  const h = await health(port);
  console.log(`eddie server v${h.version} ${wasRunning ? "restarted" : "started"} on port ${port}`);
  if (wasRunning) console.log("reload any open editor tabs to pick up the new frontend");
}

async function upgrade(port) {
  if (!fs.existsSync(path.join(ROOT, ".git"))) {
    throw new Error(`${ROOT} is not a git checkout — upgrade by reinstalling instead`);
  }
  console.log(`upgrading eddie in ${ROOT}`);
  await run("git", ["pull", "--ff-only"], ROOT);
  // npm ci, not npm install: install exactly what's committed and never
  // rewrite package-lock.json — an upgrade must leave the checkout clean,
  // or the next pull needs a stash. The prepare script rebuilds web/dist.
  await run("npm", ["ci"], ROOT);
  await restart(port);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(`usage: eddie [--port N] [upgrade | restart | status | stop] [file ...]`);
    return;
  }

  if (opts.upgrade) return upgrade(opts.port);
  if (opts.restart) return restart(opts.port);

  if (opts.status) {
    const h = await health(opts.port);
    console.log(h ? `eddie server v${h.version} running on port ${opts.port} (pid ${h.pid})` : "eddie server is not running");
    return;
  }

  if (opts.stop) {
    const stopped = await stopServer(opts.port);
    console.log(stopped ? "eddie server stopped" : "eddie server is not running");
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
