"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type JobStatus = {
  analysis_id: string;
  status: "queued" | "processing" | "completed" | "failed" | "needs_review" | "cancelled";
  stage: string;
  document_count: number;
  documents_processed: number;
  page_count: number | null;
  pages_processed: number;
  error_code: string | null;
  retryable: boolean;
};

const TERMINAL = new Set(["completed", "needs_review", "failed", "cancelled"]);

function stageCopy(status: JobStatus): string {
  if (status.status === "queued") return "The upload is queued. A dedicated worker will claim it next.";
  if (status.status === "processing") {
    switch (status.stage) {
      case "downloading":
        return "The worker is reading the uploaded PDF.";
      case "extracting":
        return "The worker is extracting text from the uploaded pages.";
      case "analyzing":
        return "The worker is reading coverage, limits, and exclusions.";
      case "finalizing":
        return "The worker is binding the cited report.";
      default:
        return "The worker is processing this upload.";
    }
  }
  if (status.status === "failed") {
    return "Analysis stopped. No report was published for this upload.";
  }
  if (status.status === "cancelled") {
    return "This analysis was cancelled. No report was published.";
  }
  return "The cited report is ready.";
}

export function JobStatusView({
  policyId,
  initial,
  accountEmail
}: {
  policyId: string;
  initial: JobStatus;
  accountEmail?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (TERMINAL.has(status.status) && status.status !== "failed" && status.status !== "cancelled") {
      router.refresh();
      return;
    }
    if (status.status === "failed" || status.status === "cancelled") return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/policies/${policyId}/status`, { cache: "no-store" });
        if (res.status === 404) {
          setError("This analysis is not available on this account.");
          window.clearInterval(timer);
          return;
        }
        if (!res.ok) return;
        const next = (await res.json()) as JobStatus;
        setStatus(next);
        if (next.status === "completed" || next.status === "needs_review") {
          window.clearInterval(timer);
          router.refresh();
        }
        if (next.status === "failed" || next.status === "cancelled") {
          window.clearInterval(timer);
        }
      } catch {
        /* next poll retries */
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [policyId, router, status.status]);

  async function onCancel() {
    if (cancelling) return;
    setCancelling(true);
    setError("");
    const res = await fetch(`/api/policies/${policyId}/cancel`, { method: "POST" });
    if (!res.ok) {
      setError("Could not cancel this analysis.");
      setCancelling(false);
      return;
    }
    setStatus({ ...status, status: "cancelled" });
    setCancelling(false);
  }

  const inFlight = status.status === "queued" || status.status === "processing";

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b8860b]">Analysis job</p>
      <h1 className="text-2xl font-semibold text-[#0b3c5d]">
        {status.status === "failed"
          ? "Analysis failed"
          : status.status === "cancelled"
            ? "Analysis cancelled"
            : "Analyzing the uploaded policy"}
      </h1>
      {accountEmail ? <p className="text-xs text-[#6b7280]">Signed in as {accountEmail}</p> : null}
      <section className="rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold capitalize text-[#0b3c5d]">{status.status.replace("_", " ")}</p>
        <p className="mt-2 text-sm leading-relaxed text-[#4a5568]">{stageCopy(status)}</p>
        {inFlight ? (
          <p className="mt-3 text-xs text-[#6b7280]">
            {status.documents_processed} of {status.document_count} document
            {status.document_count === 1 ? "" : "s"}
            {status.page_count != null
              ? ` · ${status.pages_processed} of ${status.page_count} pages`
              : ""}
          </p>
        ) : null}
        {status.error_code && (status.status === "failed" || status.status === "cancelled") ? (
          <p className="mt-3 text-xs text-[#6b7280]">Closed with code {status.error_code}.</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-[#b91c1c]">{error}</p> : null}
        {inFlight ? (
          <button
            type="button"
            onClick={() => void onCancel()}
            disabled={cancelling}
            className={cn(buttonVariants({ variant: "outline" }), "mt-4")}
          >
            {cancelling ? "Cancelling…" : "Cancel analysis"}
          </button>
        ) : (
          <a href="/" className={cn(buttonVariants({ variant: "outline" }), "mt-4 inline-flex")}>
            Back to upload
          </a>
        )}
      </section>
    </div>
  );
}
