# Motor econométrico y simulador (Fase 3)

Documentación metodológica de la sección **Econometría** (`/econometria`) y del
**Simulador macroeconómico** (`/simulador`). Cada método indica fórmula,
supuestos, limitaciones y cómo se verifica.

## Arquitectura

```
src/lib/econ/            motor (TypeScript puro, sin dependencias)
  linalg.ts              QR de Householder, Cholesky, Jacobi, radio espectral
  dist.ts                normal, t, F, χ² (Lanczos + fracciones continuas)
  stats.ts               estadística descriptiva
  transforms.ts          recetas de transformación + alineación temporal
  correlation.ts         Pearson, Spearman, matrices, móviles, con rezagos
  regression.ts          MCO, errores robustos (HC1, Newey-West), diagnósticos
  acf.ts                 ACF, PACF, Ljung-Box
  decompose.ts           descomposición clásica, Hodrick-Prescott, tendencias
  unitroot.ts            ADF, KPSS, Engle-Granger (tablas de MacKinnon)
  arima.ts               ARIMA por MV exacta (Kalman), auto-ARIMA
  var.ts                 VAR, selección de rezagos, Granger, IRF, FEVD
  vecm.ts                Johansen, VECM, verificación de requisitos
  forecast.ts            proyecciones con bandas
  backtest.ts            evaluación histórica, vintages
  simulator.ts           identidades, escenarios y shocks en VAR
  tasks.ts               tareas serializables (dataset → resultado)
  econ.worker.ts         Web Worker que ejecuta las tareas
  tables.json            valores críticos exportados de statsmodels
src/components/econ/     interfaz de Econometría
src/components/simulator interfaz del Simulador
scripts/econ/            Python (solo local): tablas, fixtures y referencias
```

**Por qué TypeScript y no Python en el servidor.** Vercel Hobby limita la
duración y el tamaño de las funciones; statsmodels + numpy + scipy superan
con holgura el tamaño admitido y cada estimación bloquearía una función. Las
series del catálogo tienen a lo sumo algunos miles de observaciones, así que
MCO, ARIMA o VAR se calculan en milisegundos en el navegador. Todo el cálculo
corre en un **Web Worker** (no bloquea la interfaz ni consume funciones de
Vercel). Los datos vienen de `/api/series` (lecturas a la base).

**Dónde se usa Python.** Localmente, como **referencia de verificación**:
`scripts/econ/reference.py` ejecuta statsmodels/scipy sobre los mismos datos y
los tests de TypeScript comparan resultado por resultado
(`tests/econ-reference.test.ts`). `scripts/econ/export_tables.py` exporta las
tablas de valores críticos de statsmodels (MacKinnon, Osterwald-Lenum) para no
transcribirlas a mano.

```bash
npm run econ:setup       # crea .venv-econ con las versiones fijadas
npm run econ:fixtures    # descarga IPC, EMAE y salarios oficiales (API del INDEC)
npm run econ:tables      # regenera src/lib/econ/tables.json
npm run econ:reference   # regenera tests/fixtures/econ/reference.json
npm test                 # compara el motor contra las referencias
```

Versiones de referencia: statsmodels 0.14.4, scipy 1.13.1, numpy 2.0.2.

## Reproducibilidad

- **Recetas.** Toda transformación es una lista ordenada de pasos con sus
  parámetros (`TransformStep[]`). El resultado guarda el registro de cada paso
  (`y(t) = 100·[ln x(t) − ln x(t−1)]`, etc.), la fuente y el código de cada
  serie, y se exporta en la hoja "Metodología" del Excel o como comentarios al
  final del CSV.
- **Orden de preparación.** (1) cada serie se lleva a la frecuencia común
  (nunca se desagrega; agregación por defecto según el tipo de serie: promedio
  para tasas y precios, suma para flujos, último dato para stocks); (2) se
  aplica la receta **en esa frecuencia**, de modo que la variación mensual de
  una serie diaria es la variación de su promedio mensual; (3) se conservan
  solo los períodos con datos en todas las series (intersección).
- **URL.** La selección (series, recetas, frecuencia, período, pestaña) queda
  en la URL de `/econometria`, así que un análisis se comparte con un link.
- **Aleatoriedad.** Las bandas de impulso-respuesta usan un generador con
  semilla fija (mulberry32, semilla 20261103): el mismo análisis da siempre las
  mismas bandas.

## 1. Motor estadístico

| Medida | Definición |
|---|---|
| Media, mediana | Sobre observaciones no nulas (los nulos se excluyen y se informan). |
| Moda | Valores repetidos; si ninguno se repite (series continuas), clase modal de un histograma con ancho de Freedman-Diaconis, informada como intervalo. |
| Varianza, desvío | Muestrales (n − 1). |
| Coef. de variación | σ / \|μ\| × 100; vacío si la media es ~0 o la serie cambia de signo. |
| Percentiles | Interpolación lineal (tipo 7 de Hyndman-Fan, como numpy y Excel). |
| Extremos | Mínimo y máximo con su fecha; atípicos por la regla de Tukey (1,5·IQR). |
| Asimetría, curtosis | Momentos sesgados (como scipy por defecto); curtosis en exceso. |
| Promedios móviles | Simple (al final o centrado) y exponencial (α = 2/(N+1)). |
| Volatilidad | Desvío móvil de ln(x_t/x_{t−1}), anualizado con √(períodos por año); diaria: 252. Solo series en niveles y positivas. |
| Crecimiento acumulado | x_t / x_base − 1. |
| Tasa interanual | Misma implementación del motor de análisis (diaria: última cotización de la semana previa). |
| CAGR | (x_fin / x_ini)^(1/años) − 1, años = días / 365,25. Solo niveles positivos. |
| Índice base 100 | 100 · x_t / x_base. |

## 2. Transformaciones económicas

| Paso | Fórmula | Notas |
|---|---|---|
| `log` | ln x | Valores ≤ 0 quedan sin dato y se avisa. |
| `diff` | x_t − x_{t−k} | Mensual o menor: por calendario (si falta x_{t−k}, no hay dato). |
| `logdiff` | 100·(ln x_t − ln x_{t−k}) | ≈ variación % para cambios chicos. |
| `pct` | 100·(x_t / x_{t−k} − 1) | |
| `yoy` | 100·(x_t / x_{t−1 año} − 1) | |
| `deflate` | x_t · IPC_ref / IPC_t | Pesos constantes del último mes con IPC. |
| `sa` | x / S (multiplicativa) o x − S (aditiva) | Solo mensual/trimestral/semestral, sin huecos. |
| `scale` | x · factor | Conversión de unidades (p. ej. millones → miles de millones). |
| `fx` | x / TC o x · TC | Tipo de cambio en la misma frecuencia (promedio del período). |

**Desestacionalización.** Se usa la descomposición clásica por medias móviles
(igual a `seasonal_decompose` de statsmodels). Es transparente y reproducible,
pero supone estacionalidad fija y **no reemplaza al X-13ARIMA-SEATS** que usa
el INDEC: cuando existe la serie desestacionalizada oficial (EMAE, ISAC, IPI),
conviene usar esa. La interfaz lo advierte cada vez que se aplica.

## 3. Correlaciones

- **Pearson**: r = Σ(x−x̄)(y−ȳ)/√(Σ(x−x̄)²Σ(y−ȳ)²). Prueba t con n − 2 g.l.
  (idéntica a `scipy.stats.pearsonr`); IC 95 % por la transformación z de Fisher.
- **Spearman**: Pearson sobre rangos (empates con rango promedio); p-valor con
  la aproximación t, como `scipy.stats.spearmanr`.
- **Matriz**, **móvil** (ventana de N observaciones) y **con rezagos**
  (corr(x_{t−k}, y_t), k = −K…K, cada rezago con su propio n).
- **Advertencias automáticas**: correlación ≠ causalidad (siempre); series con
  tendencia o raíz unitaria (ADF p > 0,10) → riesgo de correlación espuria;
  autocorrelación alta en ambas series → el p-valor clásico sobreestima la
  significancia, con el tamaño efectivo aproximado de Bartlett
  n·(1 − ρ_xρ_y)/(1 + ρ_xρ_y); muestras de menos de 30 observaciones.

## 4. Regresiones (MCO)

β = (X'X)⁻¹X'y por QR de Householder (estable con regresores de escalas muy
distintas). Se informan coeficientes, errores estándar, t, p, IC (t de Student
con n − k g.l.), R², R² ajustado, F conjunta, σ, log-verosimilitud, AIC y BIC.

- **Errores estándar**: clásicos; **HC1** (White con corrección n/(n−k));
  **Newey-West (HAC)** con núcleo de Bartlett y ⌊4(n/100)^{2/9}⌋ rezagos, sin
  corrección de muestra pequeña (como statsmodels). Con errores robustos la F
  conjunta es una prueba de Wald.
- **Rezagos**: regresores rezagados (0 = contemporáneo) y rezagos de la
  dependiente (modelo ARDL). Las primeras observaciones se descartan, no se
  rellenan.
- **Diagnósticos**: Durbin-Watson, Ljung-Box, Jarque-Bera, Breusch-Pagan
  (versión de Koenker, robusta a no normalidad), número de condición y VIF.
- **Advertencias**: posible regresión espuria si alguna variable no rechaza
  raíz unitaria; autocorrelación de residuos (DW fuera de [1,5; 2,5]);
  multicolinealidad (VIF > 10). Los coeficientes son asociaciones
  condicionales, no efectos causales.

## 5. Series temporales

| Método | Supuestos | Limitaciones |
|---|---|---|
| **Tendencia lineal / log-lineal** | Crecimiento constante. | No capta cambios de régimen. |
| **Filtro HP** | λ de Ravn-Uhlig: 129.600 mensual, 1.600 trimestral, 6,25 anual. | Sesgo en los extremos: la última parte se revisa con datos nuevos. |
| **Descomposición clásica** | Estacionalidad fija; modelo aditivo o multiplicativo. | Pierde medio ciclo en cada extremo de la tendencia. Fuerza de la estacionalidad: 1 − Var(R)/Var(R+S). |
| **ADF** | H0: raíz unitaria. Rezagos por AIC sobre muestra común (máx. ⌈12(n/100)^{1/4}⌉); p-valores de MacKinnon (1994), críticos de MacKinnon (2010). | Baja potencia en muestras cortas y con quiebres estructurales. |
| **KPSS** | H0: estacionariedad. Ancho de banda de Hobijn, Franses y Ooms (1998). | p-valor interpolado en la tabla original, acotado a [0,01; 0,10]. |
| **Veredicto conjunto** | Firme solo cuando ADF y KPSS coinciden; si no, "no concluyente". | — |
| **ARIMA(p,d,q)** | Innovaciones ruido blanco gaussiano, parámetros estables. MV exacta con filtro de Kalman (representación de Harvey); estacionariedad e invertibilidad impuestas por autocorrelaciones parciales (Monahan, Jones). Errores estándar por hessiana numérica (información observada). | Bandas solo del ruido del modelo (no de los parámetros ni de cambios de régimen). Sin estacionalidad SARIMA: para series con estacionalidad, usar la serie desestacionalizada. |
| **Auto-ARIMA** | d por KPSS sucesivas al 5 %; (p, q) ≤ 3 por AICc. | La selección por criterio no garantiza buen pronóstico (ver backtesting). |
| **VAR(p)** | Variables estacionarias, relaciones lineales estables. MCO por ecuación; rezagos por AIC/BIC/HQ/FPE sobre muestra común; estabilidad por el radio espectral de la matriz compañera. | Forma reducida. |
| **Granger** | Prueba F de exclusión de los rezagos de X en la ecuación de Y. | Mide capacidad predictiva, no causalidad económica. |
| **Impulso-respuesta** | Ortogonalizada por Cholesky (orden = orden de las variables) o no ortogonalizada; bandas por Monte Carlo de los coeficientes (Σu fija, 500 réplicas). | Dependen del orden; no identifican shocks estructurales. |
| **FEVD** | Descomposición de la varianza del error de pronóstico (Cholesky). | Mismo orden de identificación. |
| **Engle-Granger** | ADF sin constante sobre residuos de la regresión de cointegración; p-valores de MacKinnon para N series. | Normaliza sobre la primera variable; una sola relación. |
| **Johansen** | Traza y máximo autovalor con constante sin restringir; críticos de Osterwald-Lenum. | Asintóticos; tiende a sobrerrechazar en muestras cortas. |
| **VECM** | MV de Johansen; β normalizado con la identidad en las primeras r filas. | β depende del orden de las series. |

**Requisitos del VECM** (`checkVecmRequirements`): cada serie debe ser I(1)
(ADF no rechaza raíz unitaria en niveles y las diferencias no tienen raíz
unitaria) y el rango de Johansen debe cumplir 0 < r < k. Si no, la interfaz
explica el motivo (r = 0 → VAR en diferencias; r = k → VAR en niveles; alguna
serie I(0) o I(2)) y solo estima el VECM si el usuario fuerza el rango, con
una advertencia explícita.

## 6. Proyecciones

Métodos: paseo aleatorio, paseo aleatorio con deriva, media histórica, ARIMA
(orden elegido o automático), regresión con escenario de explicativas y VAR.
Se configuran el período de estimación (Desde/Hasta), el horizonte, las
variables explicativas, el método y sus parámetros, y la escala (niveles o
logaritmos).

- **Bandas** del 80 % y 95 %. Paseo aleatorio: σ√h; con deriva:
  σ√(h(1 + h/(n−1))); media: s√(1 + 1/n) con t de Student; ARIMA:
  σ²Σψ_j² con los pesos ψ del modelo integrado; regresión: σ²(1 + x₀'(X'X)⁻¹x₀)
  con t de Student; VAR: ΣΦ_sΣ_uΦ_s' (Lütkepohl).
- **Logaritmos**: la proyección central es la mediana exp(E[ln y]) y las
  bandas son asimétricas.
- **Atajos** para inflación, reservas, tipo de cambio, base monetaria, tasas,
  actividad y salarios reales, todos con series oficiales del catálogo.
- Cada proyección muestra que **no es una certeza** y lista los supuestos.

## 7. Simulador macroeconómico

Tres tipos de resultado que nunca se mezclan; cada pestaña lleva su
advertencia:

1. **Simulaciones aritméticas**: identidades exactas. Variación real
   (Fisher), capitalización compuesta, tipo de cambio real bilateral
   (1+dev)(1+π*)/(1+π) − 1, tasa real con TEM = TNA·30/365, stock con flujos
   constantes. Son ciertas dados los supuestos; no implican causalidad.
2. **Escenarios del usuario**: trayectorias mensuales por tramos para
   inflación, devaluación, base monetaria, salarios, tasa, reservas e
   inflación externa, encadenadas desde los últimos datos oficiales (IPC,
   tipo de cambio mayorista, base monetaria, reservas, índice de salarios,
   plazo fijo). Las variables no reaccionan entre sí más allá de las
   identidades. Señala inconsistencias (reservas negativas, apreciación real,
   caída del salario real, tasas reales negativas).
3. **Modelo estadístico estimado**: VAR de variaciones mensuales estimado con
   datos reales; el usuario elige variables, orden (Cholesky), rezagos, período
   y el shock (variable y tamaño). La respuesta ortogonalizada se reescala para
   que el impacto en la variable shockeada sea el tamaño pedido; se muestran
   bandas, respuesta acumulada y avisos si el VAR es inestable o el shock
   supera 4 desvíos típicos (extrapolación). Son regularidades estadísticas,
   no un modelo causal validado.

## 8. Backtesting

Origen móvil con ventana expansiva: para cada origen t₀ (desde la fecha
elegida, cada `paso` períodos) se estima el modelo **solo con datos hasta t₀**
(incluida la selección automática del orden, que se rehace en cada origen),
se pronostican h períodos y se comparan con lo observado.

- **Métricas** por horizonte y totales: MAE, RMSE, MAPE (solo si la serie no
  cambia de signo ni toma valores cercanos a cero; si no, se informa "no
  apropiado"), sesgo medio = promedio(pronóstico − observado), RMSE relativo
  al paseo aleatorio (< 1 mejora al ingenuo) y cobertura empírica de la banda
  del 95 %.
- **Sin información futura**: el entrenamiento se corta en el origen; la
  regresión con explicativas se rechaza en backtesting porque requeriría
  conocer sus valores futuros.
- **Vintages (revisiones)**: la base guarda cuándo estuvo disponible cada
  observación (fecha de publicación de la fuente o, si no la informa, primera
  vez que la vio la plataforma) y el historial de revisiones
  (`observation_revisions`). `/api/series/vintages?id=` devuelve esos datos y
  `seriesAsOf` reconstruye la serie tal como estaba publicada en cada fecha.
  El registro empieza cuando la plataforma comenzó a sincronizar la serie
  (noviembre de 2026): para orígenes anteriores no hay versiones históricas y
  se usan los datos vigentes, con una advertencia (en series que se revisan,
  como EMAE o PIB, el desempeño puede verse mejor que en tiempo real).

## Verificación

`tests/econ-reference.test.ts` compara contra statsmodels/scipy, sobre datos
oficiales del INDEC (IPC, EMAE, salarios 2017–2026) y datos sintéticos con
semilla fija:

| Componente | Referencia | Tolerancia típica |
|---|---|---|
| Distribuciones t, F, χ², normal | scipy.stats | 1e-9 relativo |
| Descriptivas | numpy/scipy | 1e-12 |
| Pearson, Spearman (r y p) | scipy.stats | 1e-10 / 1e-7 |
| MCO: β, e.e., t, p, IC, R², F, AIC, BIC | statsmodels OLS | 1e-9 |
| DW, JB, BP, Ljung-Box | statsmodels | 1e-9 |
| HC1, Newey-West | statsmodels | 1e-9 |
| MacKinnon (p y críticos) | statsmodels | 1e-10 |
| ADF (estadístico, rezago, p) | `adfuller(autolag="AIC")` | 1e-8 |
| KPSS | `kpss(nlags="auto")` | 1e-9 |
| Engle-Granger | `coint` | 1e-8 |
| Descomposición, HP | `seasonal_decompose`, `hpfilter` | 1e-10 |
| ACF, PACF | statsmodels | 1e-9 |
| ARIMA (log-verosimilitud, parámetros, pronóstico) | `ARIMA` (MV exacta) | llf nunca peor y a 1e-5; parámetros 2e-3; pronóstico 1e-4 |
| VAR: coeficientes, Σu, criterios, IRF, FEVD, pronóstico | `VAR` | 1e-8 |
| Granger | `test_causality`, `grangercausalitytests` | 1e-9 |
| Johansen, VECM | `coint_johansen`, `VECM` | 1e-8 |

`tests/econ-engine.test.ts` cubre propiedades propias: recetas y su registro,
alineación sin desagregar, preparación (frecuencia antes de transformar),
rezagos sin relleno, invertibilidad de la reparametrización ARIMA, ausencia de
información futura en el backtesting, uso de vintages, métricas de error,
identidades del simulador y requisitos del VECM.

Diferencias conocidas con statsmodels, documentadas:
- **Errores estándar del ARIMA**: el motor usa la hessiana numérica
  (información observada, `cov_type="approx"` en statsmodels); el valor por
  defecto de statsmodels es OPG. La referencia se genera con `approx`.
- **Granger dentro del VAR**: el estadístico F coincide con `test_causality`;
  los grados de libertad del denominador son los de la ecuación (n − 1 − kp),
  como `grangercausalitytests`, en lugar de k·(n − 1 − kp).
- **Número de condición**: se calcula con las columnas de X normalizadas (no
  depende de las unidades); statsmodels usa X sin normalizar.
