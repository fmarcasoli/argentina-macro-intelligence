import { cn } from "@/lib/utils";

/** Contenedor estilo terminal: barra de título fina + cuerpo. */
export function Panel({
  title,
  code,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  code?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-md border border-border bg-card", className)}>
      {(title || actions) && (
        <header className="flex min-h-9 items-center gap-2 border-b border-border px-3 py-1.5">
          {code && <span className="num text-[10px] text-amber">{code}</span>}
          {title && <h2 className="label-caps truncate text-muted-foreground">{title}</h2>}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  code,
  title,
  description,
  children,
}: {
  code: string;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        <div className="num mb-1 text-[11px] tracking-widest text-amber">{code}</div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
