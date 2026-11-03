"use client";

import type { AnalysisResult } from "./analysis/pipeline";
import { TRANSFORM_LABEL, type Transform } from "./analysis/types";
import { FREQ_NAME } from "./analysis/frequency";

/**
 * Exportaciones del motor de gráficos (en el navegador): CSV, Excel e imagen.
 * Siempre exportan los datos completos del análisis (no la vista simplificada
 * del gráfico) junto con la fuente, la unidad y la transformación aplicada.
 */

function slug(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function exportFileName(title: string, ext: string) {
  const day = new Date().toISOString().slice(0, 10);
  return `${slug(title) || "analisis"}_${day}.${ext}`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function columnHeader(s: AnalysisResult["series"][number]) {
  return `${s.meta.name} [${s.unit}] (${s.meta.source_id} ${s.meta.source_code ?? s.meta.id})`;
}

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function analysisToCsv(result: AnalysisResult): string {
  const header = ["fecha", ...result.series.map(columnHeader)];
  const lines = [header.map(csvCell).join(",")];
  for (const r of result.rows) lines.push([r.d, ...r.values.map((v) => (v === null ? "" : v))].map(csvCell).join(","));
  return lines.join("\n") + "\n";
}

export function downloadCsv(result: AnalysisResult, title: string) {
  // BOM para que Excel reconozca UTF-8 (acentos).
  download(new Blob(["﻿" + analysisToCsv(result)], { type: "text/csv;charset=utf-8" }), exportFileName(title, "csv"));
}

export async function downloadXlsx(result: AnalysisResult, title: string, transform: Transform) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const bold = (value: string) => ({ value, fontWeight: "bold" as const });
  const data = [
    [bold("Fecha"), ...result.series.map((s) => bold(columnHeader(s)))],
    ...result.rows.map((r) => [r.d, ...r.values.map((v) => (v === null ? null : v))]),
  ];
  const meta = [
    [bold("Campo"), bold("Valor")],
    ["Análisis", title],
    ["Generado", new Date().toISOString()],
    ["Frecuencia", FREQ_NAME[result.frequency]],
    ["Transformación", TRANSFORM_LABEL[transform]],
    ["Plataforma", "Argentina Macro Intelligence — datos oficiales INDEC y BCRA"],
    [],
    [bold("Serie"), bold("ID interno"), bold("Fuente"), bold("Código en la fuente"), bold("Unidad resultante"), bold("Unidad original"), bold("Frecuencia original"), bold("Agregación"), bold("Tipo de dato")],
    ...result.series.map((s) => [
      s.meta.name,
      s.meta.id,
      s.meta.source_id,
      s.meta.source_code ?? "(calculada)",
      s.unit,
      s.meta.unit,
      FREQ_NAME[s.meta.frequency],
      s.aggregation ?? "—",
      s.meta.value_kind,
    ]),
    [],
    [bold("Advertencias")],
    ...result.notices.map((n) => [n.message]),
  ];
  const blob = await writeXlsxFile(
    [
      { sheet: "Datos", data, columns: [{ width: 12 }, ...result.series.map(() => ({ width: 28 }))], stickyRowsCount: 1 },
      { sheet: "Metadatos", data: meta, columns: [{ width: 40 }, { width: 28 }, { width: 10 }, { width: 28 }, { width: 30 }, { width: 24 }, { width: 14 }, { width: 12 }, { width: 12 }] },
    ],
    {},
  ).toBlob();
  download(blob, exportFileName(title, "xlsx"));
}

export async function downloadPng(node: HTMLElement, title: string) {
  const { toPng } = await import("html-to-image");
  const bg = getComputedStyle(document.body).backgroundColor || "#0b0d10";
  const url = await toPng(node, { backgroundColor: bg, pixelRatio: 2, cacheBust: true });
  const blob = await (await fetch(url)).blob();
  download(blob, exportFileName(title, "png"));
}
