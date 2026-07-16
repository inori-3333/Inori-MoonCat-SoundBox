import type { ReactNode } from "react";

export function Term({ children, note }: { children: ReactNode; note: string }) {
  return <div className="term-block"><strong>{children}</strong><span>{note}</span></div>;
}
