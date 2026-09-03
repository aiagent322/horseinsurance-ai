import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ERRORS: Record<string, string> = {
  choose: "Choose a PDF first.",
  type: "Only PDF uploads are accepted in this version.",
  size: "File is larger than 20 MB.",
  read: "Could not read text from that PDF."
};

export function UploadForm({ errorCode }: { errorCode?: string }) {
  const error = errorCode ? ERRORS[errorCode] || "Upload failed." : "";

  return (
    <div className="space-y-4 rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-sm">
      <form action="/api/upload" method="post" encType="multipart/form-data" className="space-y-4">
        <input type="hidden" name="redirect" value="1" />
        <label className="block text-sm font-medium text-[#0b3c5d]" htmlFor="policy-pdf">
          Policy PDF
        </label>
        <input
          id="policy-pdf"
          type="file"
          name="file"
          accept="application/pdf,.pdf"
          required
          className="block w-full text-sm text-[#1f2933] file:mr-3 file:rounded-md file:border-0 file:bg-[#0b3c5d] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
        />
        <p className="text-xs text-[#6b7280]">
          One PDF, up to 20 MB. The original file is stored privately on this server and is not indexed. You can delete
          the analysis from the report page.
        </p>
        {error ? <p className="text-sm text-[#b91c1c]">{error}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={cn(buttonVariants(), "bg-[#0b3c5d] hover:bg-[#144e78]")}>
            Analyze policy
          </button>
          <button
            type="submit"
            formNoValidate
            formAction="/api/fixture/run"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Run educational fixture
          </button>
        </div>
      </form>
      <p className="text-xs text-[#6b7280]">
        The fixture is a labeled sample PDF used to prove the pipeline. It is not a real policy and not an offer of
        insurance.
      </p>
    </div>
  );
}
