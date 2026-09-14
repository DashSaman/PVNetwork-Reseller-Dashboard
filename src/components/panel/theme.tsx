"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/** دکمه تغییر تم روشن/تاریک (مبتنی بر کوکی — بدون فلش) */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.cookie = `theme=${next ? "dark" : "light"}; path=/; max-age=31536000`;
    document.documentElement.classList.toggle("dark", next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-[var(--brand)] hover:border-[var(--brand)]/40 ${className}`}
      aria-label={dark ? "حالت روشن" : "حالت تاریک"}
      title={dark ? "حالت روشن" : "حالت تاریک"}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
