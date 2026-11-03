"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SidebarNav } from "./sidebar-nav";
import { Brand } from "./brand";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Abrir navegación"
        className="inline-flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground lg:hidden"
      >
        <Menu className="size-4" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 bg-sidebar p-0">
        <SheetTitle className="sr-only">Navegación</SheetTitle>
        <div className="border-b border-sidebar-border px-4 py-4">
          <Brand />
        </div>
        <div className="py-3">
          <SidebarNav onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
