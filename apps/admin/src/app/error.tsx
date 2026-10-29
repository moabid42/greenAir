"use client";

import { ErrorState, card } from "@/components/ui";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className={`${card} mx-auto mt-10 max-w-lg`}>
      <ErrorState title="This page hit a problem" text={error.message || "An unexpected error occurred. Your saved settings are untouched."} onRetry={reset} />
    </div>
  );
}
