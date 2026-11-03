"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_SECTIONS } from "@/lib/nav";
import { NavIcon } from "./nav-icon";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label="Secciones" className="flex flex-col gap-0.5 px-2">
      {NAV_SECTIONS.map((s, i) => {
        const active =
          isActive(s.href) ||
          (s.href === "/configuracion" && pathname.startsWith("/catalogo"));
        return (
          <Link
            key={s.href}
            href={s.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
              "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              active && "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_2px_0_0_var(--amber)]",
            )}
          >
            <span className="num w-5 text-[10px] text-muted-foreground/70">{String(i + 1).padStart(2, "0")}</span>
            <NavIcon
              name={s.icon}
              className={cn("size-4 shrink-0", active ? "text-amber" : "text-muted-foreground group-hover:text-foreground")}
            />
            <span className="flex-1 truncate">{s.label}</span>
            {s.status === "construction" && (
              <span
                title="En construcción"
                className="num rounded-sm border border-border px-1 text-[9px] leading-4 text-muted-foreground"
              >
                WIP
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
