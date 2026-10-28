import Image from "next/image";
import { cn } from "@/lib/cn";

/** The EcoMAB leaf-and-route mark, shown in a circle. */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return <Image src="/brand.png" alt="" width={size} height={size} priority className={cn("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />;
}

/** Logo plus the wordmark: heavy, tight, deep green. */
export function Wordmark({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-extrabold tracking-[-0.04em] text-brand", className)} style={{ fontSize: size * 0.62 }}>
      <Logo size={size} />
      EcoMAB
    </span>
  );
}
