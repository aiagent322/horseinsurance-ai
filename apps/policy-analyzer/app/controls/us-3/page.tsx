import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-static";

export default function Control3DownloadPage() {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b8860b]">U.S. Control Policy #3</p>
        <h1 className="text-3xl font-semibold tracking-tight text-[#0b3c5d]">Great American issued package</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-[#4a5568]">
          This is the 28-page Control #3 file: Great American Assurance Company Equine Mortality Broad Form, Policy
          No. AMP E269955 00 00. It is not the 54-page Courthouse News complaint.
        </p>
      </section>
      <div className="space-y-4 rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-sm">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[#6b7280]">Pages</dt>
            <dd className="font-medium">28</dd>
          </div>
          <div>
            <dt className="text-[#6b7280]">SHA256</dt>
            <dd className="break-all font-mono text-xs">4375fb3847771d5ceccbe0a3c8523821f11db72f2ab32824399d9bba3aaac870</dd>
          </div>
          <div>
            <dt className="text-[#6b7280]">Carrier</dt>
            <dd>Great American Assurance Company</dd>
          </div>
          <div>
            <dt className="text-[#6b7280]">Policy number</dt>
            <dd>AMP E269955 00 00</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-3">
          <a
            className={cn(buttonVariants(), "bg-[#0b3c5d] hover:bg-[#144e78]")}
            href="/api/controls/us-3"
          >
            Download PDF
          </a>
          <a className={cn(buttonVariants({ variant: "outline" }))} href="/controls/us-control-3-great-american-amp-e269955.pdf">
            Open PDF in browser
          </a>
        </div>
        <p className="text-xs text-[#6b7280]">
          After download, upload this file on the Policy Analyzer home page. Do not upload the 54-page Greenbank
          complaint PDF.
        </p>
      </div>
    </div>
  );
}
