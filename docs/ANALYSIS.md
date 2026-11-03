# Motor de análisis, calculadoras y guardado (Fase 2)

Todo el cálculo vive en funciones puras de `src/lib/analysis/` que corren igual
en el servidor y en el navegador, y están cubiertas por tests
(`tests/analysis.test.ts`, `tests/calculators.test.ts`). Los datos salen
siempre de la base: no hay valores de ejemplo ni estimaciones.

## Canalización de un análisis

`runAnalysis(series, spec, ipc)` en `src/lib/analysis/pipeline.ts`:

1. **Frecuencia común.** Se toma la frecuencia menos granular de las series
   (diaria + mensual → mensual). Nunca se desagrega ni se interpola: pedir una
   frecuencia más fina que la de las series devuelve una advertencia y se usa
   la natural.
2. **Agregación** (`resample`), solo cuando la serie es más granular que la
   frecuencia objetivo:

   | Tipo de serie | Agregación por defecto |
   |---|---|
   | Tasas, porcentajes, tipos de cambio, índices (CER, UVA) | Promedio del período |
   | Flujos (exportaciones, importaciones, ventas, efectos monetarios, viajeros) | Suma del período |
   | Stocks (reservas, base monetaria, depósitos, préstamos) | Último dato del período |

   El usuario puede forzar promedio, último o suma. **Los períodos incompletos
   se descartan** (y se informa cuáles): desde mensual hacen falta todos los
   meses del trimestre/año; desde diaria, que haya datos en los primeros y
   últimos 7 días del período (el mes en curso queda afuera). Los nulos no
   cuentan como cero.
3. **Transformación**, calculada sobre la serie completa (para que los
   primeros puntos del período tengan su base) y luego recortada al período:

   | Transformación | Fórmula |
   |---|---|
   | Valores absolutos | sin cambios |
   | Var. % período anterior | (Xₜ / Xₜ₋₁ − 1) × 100. Mensual o menor: empareja por período; diaria: contra la observación anterior |
   | Var. % interanual | (Xₜ / Xₜ₋₁ₐ − 1) × 100. Diaria: contra la última cotización de la semana previa a la misma fecha del año anterior |
   | Índice base 100 | Xₜ / X_base × 100; base = primera observación no nula del período (o la fecha elegida) |
   | Valores reales | Xₜ × IPC_ref / IPCₜ, en pesos constantes del último IPC publicado. Diarias: IPC del mes; trimestrales/anuales: promedio del IPC del período. Solo para series en pesos corrientes |

4. **Validaciones**: períodos faltantes (`findGaps`): meses/trimestres sin
   observación, valores no publicados (null) y, en diarias, interrupciones de
   más de 7 días corridos. Se informan; nunca se completan.
5. **Ejes**: se superponen series en un mismo eje solo si, después de la
   transformación, tienen la misma unidad (`canShareAxis`). Variaciones e
   índice base 100 siempre son comparables. Si no, se usan **paneles
   sincronizados con escalas independientes** (nunca doble eje).

### Advertencias metodológicas (`methodologyWarnings`)

| Situación | Nivel |
|---|---|
| Series del INDEC y del BCRA combinadas | info |
| Series desestacionalizadas mezcladas con originales | advertencia |
| Índices con bases distintas en valores absolutos (2004=100 vs. dic-2016=100) | advertencia |
| Series reales (constantes) mezcladas con nominales | advertencia |
| Frecuencias distintas (se agregan) | info |
| Inflación del BCRA junto al IPC del INDEC (redondeo y cierre de mes) | advertencia |
| Serie discontinuada / desactualizada en la fuente | advertencia / info |
| Series calculadas por la plataforma | info |

## Motor de gráficos

`src/components/charts/analysis-chart.tsx`: series temporales, múltiples
variables, zoom con navegador inferior, períodos predefinidos (1A–MAX) o
personalizados (desde/hasta), tooltip con cursor, tabla asociada y
exportaciones. Colores por posición fija en la selección (4 tonos validados;
de la 5.ª serie en adelante, mismo tono con trazo punteado). Por encima de
1.500 puntos el gráfico usa una vista simplificada; la tabla y las
exportaciones tienen siempre todos los datos.

Exportaciones (`src/lib/export.ts`, en el navegador):

- **CSV** UTF-8 con BOM; encabezado con nombre, unidad resultante, fuente y código.
- **Excel** (`write-excel-file`): hoja *Datos* y hoja *Metadatos* (serie, ID,
  fuente, código, unidad original y resultante, frecuencia, agregación,
  tipo de dato y advertencias).
- **PNG** (`html-to-image`): gráfico con leyenda y línea de fuente.

## Calculadoras (`src/lib/analysis/calculators.ts`)

| Calculadora | Fórmulas | Datos |
|---|---|---|
| Inflación | Acumulada = IPC(final) / IPC(mes anterior al inicial) − 1 (incluye el mes inicial). Promedio mensual = (1 + acumulada)^(1/n) − 1. Anualizada = (1 + acumulada)^(12/n) − 1. Interanual del mes final. Importe actualizado = importe × (1 + acumulada) | IPC Nivel General Nacional |
| Tasa real | i = TNA × días / 365; π = (1 + inflación mensual)^(días / 30,4) − 1; **Fisher exacta** r = (1 + i)/(1 + π) − 1; TEA y tasa real anual capitalizando al plazo. Inflación: último mes, promedio 3 meses, promedio 12 meses o manual | Tasas BCRA, IPC |
| Devaluación | Variación acumulada entre la última cotización publicada en o antes de cada fecha (máx. 10 días); anualizada; interanual a la fecha final; devaluación real = (1 + dev)/(1 + inflación) − 1 | TC mayorista / minorista, IPC |
| Salario real | Índice real = (Wₜ / W_base)/(IPCₜ / IPC_base) × 100. Para un salario propio: equivalente = salario × IPC(final)/IPC(inicial); variación real | Índice de salarios, IPC |
| Agregados reales | Pesos constantes del último IPC; las diarias se promedian por mes | Base monetaria, M1, M2, M3, IPC |

Validación con datos reales (test): la inflación de 2024 calculada con el IPC
da 117,8 %, igual a la publicada por el INDEC, y cada variación mensual
coincide con la serie publicada `145.3_INGNACUAL_DICI_M_38`.

## Categorías de los paneles

`src/lib/catalog/panels.ts` define las 12 categorías del INDEC y las 14 del
BCRA, y reglas explícitas (en orden) sobre la categoría de la fuente, el
título del dataset y el nombre de la serie. El resultado se guarda en
`indicators.panel` al registrar o descubrir series; `npm run catalog:classify`
lo recalcula si cambian las reglas. La categoría original de la fuente no se
modifica.

## Guardado de análisis y favoritos

Sin login (la autenticación queda para una fase posterior):

- Una cookie `httpOnly` (`ami_ws`) con un token aleatorio de 256 bits
  identifica al navegador. En la base solo se guarda su hash SHA-256
  (`workspaces.token_hash`).
- `saved_analyses.workspace_id` y `workspace_favorites` guardan los análisis
  (series, período, frecuencia, agregación, transformación, disposición) y
  las series favoritas en la base de datos.
- Límites: 300 análisis, 500 favoritos, 20 KB por definición.
- Un análisis se puede abrir por URL (`/analisis?s=…&t=…`) o desde Favoritos.

| Endpoint | Uso |
|---|---|
| `GET /api/series?ids=a,b&ipc=1` | Metadatos + observaciones (máx. 8 series); descarga a pedido las que no tienen datos |
| `GET/POST /api/workspace/analyses` | Listar / guardar análisis |
| `GET/PUT/DELETE /api/workspace/analyses/{id}` | Abrir / actualizar / borrar (solo del propio espacio) |
| `GET/POST/DELETE /api/workspace/favorites` | Favoritos |
