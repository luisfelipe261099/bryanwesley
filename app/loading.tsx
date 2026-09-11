import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Carregando"
      className="grid min-h-dvh place-items-center bg-ink"
    >
      <Loader2 className="h-6 w-6 animate-spin text-electric" />
    </div>
  );
}
