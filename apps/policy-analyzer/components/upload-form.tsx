import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ERRORS: Record<string, string> = {
  choose: "Choose at least one PDF first.",
  type: "Only PDF uploads are accepted in this version.",
  size: "Each PDF must be 20 MB or smaller.",
  package: "The complete package must be 75 MB or smaller.",
  count: "Upload at most 10 PDFs in one package.",
  empty: "One of the files is empty.",
  duplicate: "The package contains duplicate PDFs.",
  read: "Could not read one or more PDFs.",
  config: "Analyzer persistence is not configured."
};

export function UploadForm({ errorCode }: { errorCode?: string }) {
  const error = errorCode ? ERRORS[errorCode] || "Upload failed." : "";

  return (
    <div className="space-y-4 rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-sm">
      <form action="/api/upload" method="post" encType="multipart/form-data" className="space-y-4">
        <input type="hidden" name="redirect" value="1" />
        <label className="block text-sm font-medium text-[#0b3c5d]" htmlFor="policy-pdf">
          Policy PDFs
        </label>
        <input
          id="policy-pdf"
          type="file"
          name="files"
          accept="application/pdf,.pdf"
          multiple
          required
          className="block w-full text-sm text-[#1f2933] file:mr-3 file:rounded-md file:border-0 file:bg-[#0b3c5d] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
        />
        <p className="text-xs text-[#6b7280]">
          Up to 10 PDFs, 20 MB each, 75 MB for the complete package. Original files are stored privately by generated
          IDs and are not indexed. You can delete the analysis from the report page.
        </p>
        {error ? <p className="text-sm text-[#b91c1c]">{error}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={cn(buttonVariants(), "bg-[#0b3c5d] hover:bg-[#144e78]")}>
            Analyze policy package
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
