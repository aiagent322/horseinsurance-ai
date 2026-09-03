import { notFound } from "next/navigation";
import { ReportView } from "@/components/report-view";
import { loadPolicy } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const rec = await loadPolicy(id);
  if (!rec) notFound();
  return <ReportView record={rec} />;
}
