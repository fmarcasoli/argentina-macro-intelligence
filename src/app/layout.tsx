import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";
import { Brand } from "@/components/layout/brand";
import { Clock } from "@/components/layout/clock";
import { MobileNav } from "@/components/layout/mobile-nav";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { ThemeToggle, themeInitScript } from "@/components/layout/theme-toggle";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "Argentina Macro Intelligence",
    template: "%s · Argentina Macro Intelligence",
  },
  description: "Plataforma de análisis macroeconómico de Argentina con datos oficiales del INDEC y el BCRA.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-AR" className={`dark ${plexSans.variable} ${plexMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full">
        <div className="flex min-h-screen">
          <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
            <Link href="/" className="border-b border-sidebar-border px-4 py-4">
              <Brand />
            </Link>
            <div className="flex-1 overflow-y-auto py-3">
              <Suspense>
                <SidebarNav />
              </Suspense>
            </div>
            <div className="border-t border-sidebar-border px-4 py-3 text-[10px] leading-relaxed text-muted-foreground">
              Fuentes: INDEC (API Series de Tiempo) · BCRA (Estadísticas Monetarias v4.0)
              <div className="num mt-1 text-muted-foreground/70">Fase 1 · v0.1</div>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur">
              <Suspense>
                <MobileNav />
              </Suspense>
              <div className="lg:hidden">
                <Brand />
              </div>
              <div className="ml-auto flex items-center gap-3">
                <Clock />
                <ThemeToggle />
              </div>
            </header>
            <main className="flex-1 px-4 py-5 sm:px-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
