"use client";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold text-[#0b3c5d]">The analyzer hit an error</h1>
      <p className="text-sm text-[#4a5568]">{error.message || "Something went wrong while reading this page."}</p>
      <button type="button" onClick={reset} className="text-sm font-medium text-[#1d6fa5] underline">
        Try again
      </button>
    </div>
  );
}
