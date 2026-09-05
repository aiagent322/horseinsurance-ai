import { notFound } from "next/navigation";
import { JobStatusView } from "@/components/job-status-view";
import { ReportView } from "@/components/report-view";
import { getSessionActor } from "@/lib/auth/session";
import { loadPolicyRecord, loadPolicyStatus } from "@/lib/original-document";

export const dynamic = "force-dynamic";

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getSessionActor();
  if (!actor) notFound();

  const status = await loadPolicyStatus(id);
  if (!status) notFound();

  if (status.status === "completed" || status.status === "needs_review") {
    const rec = await loadPolicyRecord(id);
    if (!rec) notFound();
    return <ReportView record={rec} accountEmail={actor.email} />;
  }

  return <JobStatusView policyId={id} initial={status} accountEmail={actor.email} />;
}
