/**
 * Series alternativas más actualizadas para las tarjetas de inflación.
 *
 * La inflación mensual e interanual se calculan desde el índice del IPC que
 * publica la API de Series de Tiempo (apis.datos.gob.ar), que se actualiza
 * algunos días después de la publicación del INDEC. El BCRA republica la
 * misma cifra oficial del INDEC (redondeada a un decimal) en su API, en
 * general antes. Si la serie del BCRA tiene un mes más reciente, la tarjeta
 * muestra ese dato y lo aclara. No se estima nada: son cifras publicadas.
 */
export const FRESHER_ALTERNATIVE: Record<string, { id: string; note: string }> = {
  "calc.ipc_var_mensual": {
    id: "bcra.inflacion_mensual",
    note: "Dato del INDEC republicado por el BCRA (1 decimal): el índice del IPC todavía no está en la API de series.",
  },
  "calc.ipc_var_interanual": {
    id: "bcra.inflacion_interanual",
    note: "Dato del INDEC republicado por el BCRA (1 decimal): el índice del IPC todavía no está en la API de series.",
  },
};

/** Ids a pedir: los originales más sus alternativas. */
export const withAlternatives = (ids: string[]) => [...new Set([...ids, ...ids.map((id) => FRESHER_ALTERNATIVE[id]?.id).filter((x): x is string => Boolean(x))])];

/** Elige la serie con el dato más reciente (la original si empatan). */
export function pickFresher<T extends { id: string; last_date: string | null }>(id: string, byId: Map<string, T>): { ind: T | undefined; note: string | null } {
  const main = byId.get(id);
  const alt = FRESHER_ALTERNATIVE[id];
  const other = alt ? byId.get(alt.id) : undefined;
  if (other?.last_date && (!main?.last_date || other.last_date > main.last_date)) return { ind: other, note: alt!.note };
  return { ind: main, note: null };
}
