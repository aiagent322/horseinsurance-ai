#!/usr/bin/env node
import { spawn } from "node:child_process";

const role = (process.argv[2] || process.env.POLICY_ANALYZER_PROCESS || "web").trim();
const shutdownMs = Number(process.env.POLICY_ANALYZER_WORKER_SHUTDOWN_MS || 20_000);

function fail(message) {
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), event: "startup_failed", error_code: "configuration", message })}\n`);
  process.exit(1);
}

if (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY) {
  fail("Service-role credentials must not be exposed through NEXT_PUBLIC_ variables.");
}

const memory = process.env.POLICY_ANALYZER_STORE === "memory";
const protectedEnv =
  process.env.POLICY_ANALYZER_ENV === "staging" ||
  process.env.POLICY_ANALYZER_ENV === "production" ||
  process.env.NODE_ENV === "production";
if (memory && protectedEnv) {
  fail("Memory store is not allowed in staging or production.");
}

let command;
let args;
if (role === "web") {
  command = "node";
  args = ["./node_modules/next/dist/bin/next", "start", "-p", process.env.PORT || "43147", "-H", "0.0.0.0"];
} else if (role === "worker") {
  if (!memory && (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL))) {
    fail("Worker requires a Supabase URL and service-role key.");
  }
  command = "node";
  args = ["./node_modules/tsx/dist/cli.mjs", "worker/main.ts"];
} else if (role === "worker-once") {
  if (!memory && (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL))) {
    fail("Worker requires a Supabase URL and service-role key.");
  }
  command = "node";
  args = ["./node_modules/tsx/dist/cli.mjs", "worker/once.ts"];
} else {
  fail("Unknown process role.");
}

const child = spawn(command, args, {
  stdio: "inherit",
  env: process.env
});

function stop(signal) {
  if (!child.killed) child.kill(signal);
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    process.exit(1);
  }, Number.isFinite(shutdownMs) ? shutdownMs : 20_000);
  timer.unref?.();
}

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
