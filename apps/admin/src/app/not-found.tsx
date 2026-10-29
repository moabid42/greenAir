"use client";

import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState, btnPrimary, card } from "@/components/ui";

export default function NotFound() {
  return (
    <div className={`${card} mx-auto mt-10 max-w-lg`}>
      <EmptyState icon={SearchX} title="Page not found" text="This admin has four sections: Overview, Endpoints, Client data and Settings." action={<Link href="/" className={btnPrimary}>Back to overview</Link>} />
    </div>
  );
}
