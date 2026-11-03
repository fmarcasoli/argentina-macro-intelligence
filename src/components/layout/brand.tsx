export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div
        aria-hidden
        className="grid size-8 place-items-center rounded-sm bg-amber text-[11px] font-bold tracking-tight text-primary-foreground"
      >
        AMI
      </div>
      <div className="leading-tight">
        <div className="text-[12px] font-semibold tracking-[0.14em] text-foreground">ARGENTINA MACRO</div>
        <div className="text-[10px] tracking-[0.3em] text-amber">INTELLIGENCE</div>
      </div>
    </div>
  );
}
