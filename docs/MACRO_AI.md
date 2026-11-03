# MACRO AI (Fase 4)

Asistente de investigación macroeconómica de la plataforma (`/macro-ai`) e
informes automáticos (`/reportes`). Funciona **sin servicios pagos**: con un
modelo local (Ollama) o, sin ningún modelo, con un planificador por reglas que
igualmente busca, calcula, grafica y cita las fuentes.

## Principio de diseño: ninguna cifra sale del modelo

```
Pregunta ─► modelo de lenguaje (opcional) ─► herramientas validadas ─► datos oficiales
                     │                             │                    (/api/series,
                     │                             ▼                     /api/indicators)
                     │                   motor econométrico (verificado contra statsmodels)
                     ▼                             │
        texto explicativo  ◄──── resúmenes con cifras reales
                     │                             │
                     ▼                             ▼
     verificación de cifras        gráficos, tablas, fuentes, metodología
```

- El modelo **no accede a la base**: solo puede pedir alguna de las 14
  herramientas de la lista, con parámetros validados (zod). No hay SQL ni
  acceso irrestricto; una herramienta desconocida o con parámetros inválidos
  devuelve un error al modelo y no se ejecuta.
- Los **gráficos, tablas e indicadores** de cada respuesta los producen las
  herramientas; el texto del modelo solo los explica.
- **Verificación de cifras**: cada número que el modelo escribe se busca en
  los resultados de las herramientas (con el redondeo usado). Los que no
  aparecen se muestran como "cifras no verificadas".
- Si el modelo responde una pregunta cuantitativa **sin usar herramientas**,
  el sistema ejecuta el plan por reglas y le pide responder con esos datos.
- Cada respuesta lista las **series utilizadas** (nombre, institución, código
  oficial, unidad, frecuencia, período y transformación) y la **metodología**,
  con el detalle de cada herramienta ejecutada.

## Arquitectura de conexión

Vercel no puede ejecutar Ollama ni ver el `localhost` de tu computadora. Por
eso hay tres modos, que se eligen en el panel "Modelo" de `/macro-ai`:

| Modo | Cómo funciona | Cuándo usarlo |
|---|---|---|
| **Ollama local (desde el navegador)** — por defecto | El navegador llama a `http://localhost:11434/v1/chat/completions`. Las herramientas se ejecutan en el navegador contra las APIs de la app. | Uso diario, también desde la versión publicada en Vercel. Las preguntas no salen de tu computadora. |
| **Servidor de la app** | El navegador llama a `/api/ai/chat`, que reenvía al endpoint configurado en el servidor (`AI_SERVER_BASE_URL`). La clave, si la hay, queda en el servidor. | Desarrollo local (`npm run dev` + Ollama en la misma máquina), un túnel a tu Ollama, o un proveedor externo opcional. |
| **Sin modelo (reglas y cálculos)** | Planificador por reglas: entiende las consultas habituales (vocabulario económico, intención y período) y ejecuta las herramientas. | Sin Ollama, con la IA desactivada o si el modelo no responde (se usa automáticamente como respaldo). |

Todos los proveedores usan la API **compatible con OpenAI** (`/v1/chat/completions`
con `tools`): Ollama, LM Studio, vLLM, llama.cpp server, Groq, OpenRouter, etc.

### Desactivar la IA

`MACRO_AI_ENABLED=false` (variable de entorno del servidor): `/macro-ai` muestra
un aviso, `/api/ai/*` responde 503 y el resto de la plataforma (paneles,
análisis, econometría, simulador e **informes**) sigue igual. Los informes no
dependen de ningún modelo.

## Instalación de Ollama

1. Instalar: https://ollama.com/download (macOS, Windows, Linux) o
   `brew install ollama` en macOS.
2. Descargar un modelo con soporte de herramientas (ver tabla):
   ```bash
   ollama pull qwen2.5:7b
   ```
3. Dejarlo corriendo (la app de escritorio lo hace sola; en terminal: `ollama serve`).
4. En `/macro-ai` → **Modelo** → "Ollama local", URL `http://localhost:11434`,
   elegir el modelo y "Probar conexión".

### Usarlo desde la versión publicada (Vercel)

Ollama acepta por defecto pedidos de `localhost`. Para que la página publicada
(`https://argentina-macro-intelligence.vercel.app`) pueda hablar con tu Ollama,
hay que autorizar ese origen:

- macOS (app de escritorio):
  ```bash
  launchctl setenv OLLAMA_ORIGINS "https://argentina-macro-intelligence.vercel.app"
  ```
  y reiniciar Ollama.
- Linux (systemd): `systemctl edit ollama` →
  `Environment="OLLAMA_ORIGINS=https://argentina-macro-intelligence.vercel.app"` →
  `systemctl restart ollama`.
- Windows: variable de entorno de usuario `OLLAMA_ORIGINS` con ese valor y
  reiniciar Ollama.

Algunos navegadores (Chrome reciente) piden permiso para que un sitio acceda
a la red local: hay que aceptarlo la primera vez.

### Modo servidor (opcional)

```bash
# .env.local (desarrollo) o variables de Vercel
AI_SERVER_BASE_URL=http://localhost:11434/v1   # Ollama en la misma máquina, un túnel, o un proveedor externo
AI_SERVER_MODEL=qwen2.5:7b
AI_SERVER_API_KEY=                              # solo proveedores externos; nunca llega al navegador
AI_SERVER_LABEL=Ollama (servidor)
```

En Vercel, `localhost` es el servidor de Vercel: para usar tu Ollama en modo
servidor hace falta exponerlo con un túnel (p. ej. Cloudflare Tunnel) y
protegerlo; en general es más simple el modo navegador.

## Requisitos de hardware y modelos

Modelos con buen soporte de herramientas (*function calling*) y de español,
cuantizados Q4 (los que descarga Ollama por defecto):

| Modelo | Descarga | Memoria libre | Uso recomendado |
|---|---|---|---|
| `qwen2.5:3b` | ~1,9 GB | 4 GB | Equipos modestos; respuestas más simples. |
| `qwen2.5:7b` (**recomendado**) | ~4,7 GB | 8 GB | Buen equilibrio: elige bien las herramientas y redacta en español. |
| `llama3.1:8b` | ~4,9 GB | 8 GB | Alternativa sólida. |
| `qwen2.5:14b` | ~9 GB | 16 GB | Mejor razonamiento en análisis largos. |
| `qwen2.5:32b` | ~20 GB | 32 GB+ | Máxima calidad local. |

- **Mac con Apple Silicon (M1–M5)**: usa la GPU integrada y la memoria
  unificada; con 16 GB va bien un 7–8B, con 24–32 GB un 14B.
- **PC con GPU NVIDIA**: la VRAM determina el tamaño (8 GB → 7–8B; 12–16 GB → 14B).
- **Solo CPU**: funciona, pero un 7B tarda decenas de segundos por respuesta.
- Disco: el tamaño de descarga de cada modelo.

Una consulta típica hace 1 a 4 llamadas al modelo (elegir herramientas,
analizar resultados, redactar). Con un 7B en un Mac M-series tarda entre 10 y 40
segundos.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `buscar_series` | Busca en el catálogo (~12.000 series INDEC y BCRA). |
| `metadatos_serie` | Fuente, código oficial, unidad, frecuencia, rango, último dato y estado. |
| `obtener_datos` | Observaciones de 1–6 series en un período, con transformación y frecuencia común. |
| `calcular` | Variación entre fechas (base 0, base 100 opcional), mes a mes, ranking de variaciones, estadísticas, CAGR. |
| `comparar` | 2–6 series con transformación común (base 100, real, variaciones). |
| `correlacion` | Pearson/Spearman con p-valores y correlaciones con rezagos. |
| `regresion` | MCO con explicativas rezagadas, errores Newey-West y diagnósticos. |
| `rezagos` | Correlación cruzada y causalidad de Granger. |
| `analisis_econometrico` | ADF/KPSS, VAR, Granger y Johansen (si todas son I(1)). |
| `proyeccion` | Proyección con bandas 80 % y 95 % (auto-ARIMA, deriva, ingenuo, media). |
| `grafico` | Gráfico de 1–6 series (paneles por unidad, nunca doble eje). |
| `anomalias` | Alertas con criterio estadístico explícito (ver abajo). |
| `analisis_guardados` | Análisis guardados del espacio de trabajo. |
| `informe` | Cualquiera de los informes automáticos. |

Todas reutilizan el motor de análisis y el motor econométrico (frecuencia común
sin desagregar, transformaciones reproducibles, verificación contra statsmodels).

## Rigor

Reglas del modelo (prompt de sistema) y garantías del sistema:

- **No inventar datos ni fuentes**: las cifras vienen de herramientas y se verifican.
- **Estimaciones ≠ observaciones**: proyecciones con bandas y advertencia; las
  series calculadas por la plataforma se identifican como tales.
- **Correlación ≠ causalidad**: advertencia automática en correlaciones,
  regresiones, Granger y modelos.
- **Períodos incompletos y frecuencias**: se informan las diferencias de
  frecuencia, los períodos excluidos y las series desactualizadas.
- **Unidades y transformaciones**: en cada serie utilizada y en la metodología.
- **Hechos vs. hipótesis**: el formato de respuesta separa Resumen (datos) de
  Interpretación (hipótesis).

## Detección de anomalías

| Tipo | Criterio |
|---|---|
| Variación inusual | z robusto 0,6745·(x − mediana)/MAD con \|z\| > 3,5 (Iglewicz y Hoaglin), en los últimos 12 períodos. |
| Valor extremo | El último dato supera el máximo o el mínimo de toda la muestra previa. |
| Aceleración / desaceleración | Media de los últimos 3 períodos vs. los 12 anteriores, \|t\| > 2. |
| Cambio de tendencia | Pendiente MCO de los últimos 6 períodos con signo opuesto a la de los 6 previos y magnitud > σ/6. |
| Cambio de correlación | Correlación de los últimos 24 períodos vs. la previa, z de Fisher con p < 0,05. |
| Divergencia | Sumas de variaciones de 6 períodos con signo opuesto, con correlación histórica positiva y significativa. |

Por defecto se analizan las variaciones mensuales (no los niveles). Las alertas
son señales para investigar, no conclusiones sobre sus causas.

## Informes automáticos

Diario, inflación, monetario, cambiario, reservas, actividad, salarios reales,
mensual y personalizado. Se generan en el navegador con datos oficiales, sin
modelo de lenguaje: indicadores con su fecha y frecuencia, gráficos, tablas
período a período, alertas y textos descriptivos armados con plantillas (sin
afirmaciones causales). El informe diario separa los datos diarios del BCRA de
las series mensuales, que muestran su último dato publicado.

Exportación: **PDF** (todas las secciones, A4), **Excel** (una hoja por tabla
y gráfico + hoja de metodología), **CSV** por tabla y **PNG** por gráfico.

## Memoria de investigación y privacidad

- Conversaciones, **espacios de investigación** y **conclusiones** (con sus
  gráficos y fuentes) se guardan en la base de la plataforma, asociados al
  espacio de trabajo del navegador (cookie anónima; en la base solo se guarda
  el hash del token). Cada navegador ve solo lo suyo.
- Las tablas no son accesibles por la Data API de Supabase (RLS sin políticas
  y permisos revocados): solo el backend las lee, siempre filtrando por el
  espacio de trabajo.
- Controles: "Guardar historial" (desactivable), borrar conversaciones,
  conclusiones o espacios, **exportar toda la memoria** en JSON y **borrar
  todo**.
- Con Ollama local, las preguntas y datos no salen de tu computadora. Con un
  proveedor externo, la conversación se envía a ese proveedor.
- Límites: 300 conversaciones (2 MB cada una), 50 espacios, 500 conclusiones.

## Pruebas

- `tests/ai-tools.test.ts`: vocabulario (las 8 consultas de ejemplo), períodos,
  validación estricta, cálculos con datos reales (inflación acumulada),
  frecuencias, correlación, regresión, rezagos, econometría, proyección,
  anomalías, datos faltantes y base caída, informes.
- `tests/ai-agent.test.ts`: planificador sin modelo, respuestas sin modelo,
  caída del modelo, agente con un modelo simulado que pide herramientas,
  verificación de cifras inventadas, herramientas inexistentes, formatos de
  Ollama/OpenAI, configuración desactivada.
- `tests/ai-memory.test.ts`: validación de la memoria.

## Archivos

```
src/lib/ai/
  types.ts         bloques de respuesta, fuentes, cliente de datos
  vocabulary.ts    conceptos económicos → series; períodos en español
  tools.ts         herramientas validadas (zod)
  registry.ts      registro completo (+ informes)
  anomalies.ts     detección de anomalías
  reports.ts       informes automáticos
  planner.ts       planificador sin modelo
  agent.ts         agente, proveedores compatibles con OpenAI
  verify.ts        verificación de cifras
  config.ts        configuración del servidor (MACRO_AI_ENABLED, AI_SERVER_*)
  memory*.ts       memoria de investigación
src/app/api/ai/    chat, status, conversations, spaces, notes, memory
src/components/ai/ interfaz de MACRO AI e informes
```
