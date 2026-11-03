import { Fragment } from "react";

/**
 * Markdown mínimo y seguro (sin HTML): párrafos, títulos, listas, **negrita**
 * e _itálica_. Suficiente para las respuestas del modelo y de las plantillas.
 */
function inline(text: string, key: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("_") && p.endsWith("_") && p.length > 2) return <em key={`${key}-${i}`}>{p.slice(1, -1)}</em>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={`${key}-${i}`} className="num rounded bg-muted px-1 text-[11px]">{p.slice(1, -1)}</code>;
    return <Fragment key={`${key}-${i}`}>{p}</Fragment>;
  });
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        const lines = b.split("\n").filter((l) => l.trim());
        if (!lines.length) return null;
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
          const ordered = /^\s*\d+\./.test(lines[0]);
          const items = lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""), `${i}-${j}`)}</li>);
          return ordered ? <ol key={i} className="list-decimal pl-5">{items}</ol> : <ul key={i} className="list-disc pl-5">{items}</ul>;
        }
        const h = /^(#{1,4})\s+(.*)$/.exec(lines[0]);
        if (h && lines.length === 1) return <h3 key={i} className="text-sm font-semibold">{inline(h[2], `${i}`)}</h3>;
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {/^\s*[-*•]\s+/.test(l) ? <>• {inline(l.replace(/^\s*[-*•]\s+/, ""), `${i}-${j}`)}</> : inline(l.replace(/^#{1,4}\s+/, ""), `${i}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
