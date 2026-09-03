import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold text-[#0b3c5d]">That analysis is not here</h1>
      <p className="text-sm text-[#4a5568]">
        The link may be wrong, or the report was deleted. Uploaded policies are not listed publicly.
      </p>
      <Link href="/" className="text-sm font-medium text-[#1d6fa5] underline">
        Upload another policy
      </Link>
    </div>
  );
}
