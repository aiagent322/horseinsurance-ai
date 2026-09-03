import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTRACTION_QUALITY } from "./extraction-quality";

export type OcrRecognizeFn = (image: Buffer) => Promise<string>;

let testRecognize: OcrRecognizeFn | null = null;
let workerLock: Promise<unknown> = Promise.resolve();
let worker: import("tesseract.js").Worker | null = null;
let workerLoading: Promise<import("tesseract.js").Worker> | null = null;

export let ocrRecognizeCalls = 0;

export function resetOcrTestHooks(): void {
  testRecognize = null;
  ocrRecognizeCalls = 0;
}

export function setOcrRecognizeForTests(fn: OcrRecognizeFn | null): void {
  testRecognize = fn;
}

function tessdataDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "tessdata");
}

async function getWorker(): Promise<import("tesseract.js").Worker> {
  if (worker) return worker;
  if (workerLoading) return workerLoading;
  workerLoading = (async () => {
    const { createWorker } = await import("tesseract.js");
    const created = await createWorker("eng", 1, {
      langPath: tessdataDir(),
      gzip: false,
      cacheMethod: "none",
      logger: () => undefined
    });
    worker = created;
    return created;
  })();
  try {
    return await workerLoading;
  } finally {
    workerLoading = null;
  }
}

async function withOcrSlot<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prev = workerLock;
  workerLock = prev.then(() => gate);
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function tesseractRecognize(image: Buffer): Promise<string> {
  return withOcrSlot(async () => {
    const w = await getWorker();
    const result = await w.recognize(image);
    return (result.data.text || "").replace(/\u0000/g, "").trim();
  });
}

export async function recognizePageImage(image: Buffer): Promise<string> {
  ocrRecognizeCalls += 1;
  if (testRecognize) return testRecognize(image);
  return tesseractRecognize(image);
}

export function remainingOcrBudget(startedAt: number, timeoutMs: number): number {
  return timeoutMs - (Date.now() - startedAt);
}

export class OcrTimeoutError extends Error {
  constructor() {
    super("OCR timed out");
    this.name = "OcrTimeoutError";
  }
}

export async function recognizePageImageWithTimeout(image: Buffer, timeoutMs: number): Promise<string> {
  if (timeoutMs <= 0) throw new OcrTimeoutError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      recognizePageImage(image),
      new Promise<string>((_, reject) => {
        timer = setTimeout(() => reject(new OcrTimeoutError()), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function shutdownOcr(): Promise<void> {
  const current = worker;
  worker = null;
  workerLoading = null;
  if (current) {
    try {
      await current.terminate();
    } catch {
      /* ignore */
    }
  }
}

void EXTRACTION_QUALITY.OCR_MAX_CONCURRENCY;
