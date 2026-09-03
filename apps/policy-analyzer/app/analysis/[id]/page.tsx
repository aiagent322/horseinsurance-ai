import { notFound } from "next/navigation";
import { ReportView } from "@/components/report-view";
import { getSessionActor } from "@/lib/auth/session";
import { loadPolicyRecord } from "@/lib/original-document";

export const dynamic = "force-dynamic";

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = await loadPolicyRecord(id);
  if (!rec) notFound();
  const actor = await getSessionActor();
  return <ReportView record={rec} accountEmail={actor?.email} />;
}
