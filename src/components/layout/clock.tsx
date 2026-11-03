"use client";

import { useEffect, useState } from "react";

/** Reloj en hora de Buenos Aires para la barra superior. */
export function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0); // tras montar: evita desajuste de hidratación
    const t = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  if (!now) return <span className="num text-xs text-muted-foreground">--:--</span>;
  const fmt = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return <span className="num text-xs text-muted-foreground">{fmt.format(now)} BUE</span>;
}
