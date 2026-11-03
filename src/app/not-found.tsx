import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-3 py-16">
      <div className="num text-xs tracking-widest text-amber">404</div>
      <h1 className="text-xl font-semibold">No encontrado</h1>
      <p className="text-sm text-muted-foreground">La página o el indicador solicitado no existe en el catálogo.</p>
      <Link href="/catalogo" className="text-sm text-amber hover:underline">Ir al catálogo →</Link>
    </div>
  );
}
