// scripts/dev.cjs
// 跨平台 dev 启动器：直接用 node 拉起 vite 与 electron，不经 npm.cmd / .cmd 批处理。
// 这样 Windows 下 Ctrl+C 不再触发 cmd.exe 的 "终止批处理操作吗(Y/N)?" 提示，
// 也就没有该提示因 GBK 码页被终端按 UTF-8 解码而产生的乱码。
// 顺带省掉 concurrently / wait-on / cross-env 这条链路。
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = 5173;
const ROOT = path.resolve(__dirname, "..");
const viteBin = path.join(ROOT, "node_modules/vite/bin/vite.js");
const electronBin = path.join(ROOT, "node_modules/electron/cli.js");

let rendererChild = null;
let electronChild = null;
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    rendererChild?.kill();
  } catch {}
  try {
    electronChild?.kill();
  } catch {}
  process.exit(code ?? 0);
}

function waitForPort(host, port, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const probe = () => {
      const socket = new net.Socket();
      socket.setTimeout(1500);
      const retry = () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`等待 ${host}:${port} 超时，请检查 vite 是否启动成功`));
        } else {
          setTimeout(probe, 300);
        }
      };
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", retry);
      socket.once("timeout", retry);
      socket.connect(port, host);
    };
    probe();
  });
}

async function main() {
  rendererChild = spawn(process.execPath, [viteBin, "--host", HOST], {
    stdio: "inherit",
    cwd: ROOT,
  });
  rendererChild.on("exit", (code) => {
    if (!shuttingDown) shutdown(code ?? 1);
  });

  try {
    await waitForPort(HOST, PORT);
  } catch (error) {
    console.error(error.message);
    shutdown(1);
  }

  electronChild = spawn(process.execPath, [electronBin, "."], {
    stdio: "inherit",
    cwd: ROOT,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: `http://${HOST}:${PORT}`,
    },
  });
  electronChild.on("exit", (code) => {
    if (!shuttingDown) shutdown(code ?? 0);
  });
}

// Ctrl+C：控制台内子进程也会同时收到中断；统一走 shutdown 一起退出，避免批处理提示。
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

main();
