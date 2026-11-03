import { FavoritesView } from "@/components/workspace/favorites-view";
import { PageHeader } from "@/components/ui-kit/panel";

export const metadata = { title: "Favoritos" };

export default function FavoritesPage() {
  return (
    <>
      <PageHeader
        code="11 · FAV"
        title="Favoritos e investigaciones guardadas"
        description="Recuperá tus análisis (series, período, frecuencia y transformación) y tus series favoritas."
      />
      <FavoritesView />
    </>
  );
}
