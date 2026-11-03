import { AlertTriangle, CheckCircle2, Clock3, Hourglass, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UpdateStatus } from "@/lib/data/queries";
import type { ValueKind } from "@/lib/connectors/types";

const STATUS: Record<UpdateStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: "Al día", cls: "text-positive border-positive/30 bg-positive/10", Icon: CheckCircle2 },
  stale: { label: "Desactualizada", cls: "text-warning border-warning/30 bg-warning/10", Icon: Clock3 },
  error: { label: "Error", cls: "text-negative border-negative/30 bg-negative/10", Icon: XCircle },
  pending: { label: "Pendiente", cls: "text-muted-foreground border-border bg-muted/40", Icon: Hourglass },
  discontinued: { label: "Discontinuada", cls: "text-muted-foreground border-border bg-muted/40", Icon: AlertTriangle },
};

/** Estado de actualización: siempre ícono + texto (nunca solo color). */
export function StatusBadge({ status, compact }: { status: UpdateStatus; compact?: boolean }) {
  const s = STATUS[status] ?? STATUS.pending;
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-[11px] whitespace-nowrap", s.cls)}
      title={s.label}
    >
      <s.Icon className="size-3" aria-hidden />
      {compact ? <span className="sr-only">{s.label}</span> : s.label}
    </span>
  );
}

const KIND: Record<ValueKind, { label: string; title: string }> = {
  original: { label: "ORIG", title: "Dato original: tal como lo publica la fuente" },
  normalized: { label: "NORM", title: "Dato normalizado: valor de la fuente re-escalado (ej. proporción → %)" },
  calculated: { label: "CALC", title: "Dato calculado por la plataforma a partir de series oficiales" },
  estimated: { label: "EST", title: "Dato estimado" },
};

export function KindBadge({ kind }: { kind: ValueKind }) {
  const k = KIND[kind];
  return (
    <span
      title={k.title}
      className={cn(
        "num inline-flex rounded-sm border px-1 text-[10px] leading-4",
        kind === "original" ? "border-border text-muted-foreground" : "border-amber/40 text-amber",
      )}
    >
      {k.label}
    </span>
  );
}

export function SourceBadge({ source }: { source: string }) {
  return (
    <span className="num inline-flex rounded-sm bg-secondary px-1.5 text-[10px] leading-4 tracking-wider text-secondary-foreground">
      {source}
    </span>
  );
}
