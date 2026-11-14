"use client";

import { useEffect, useState } from "react";

const KEY = "boneify-theme";

/** The small moon / sun button. One switch for the whole site, remembered between pages and visits. */
export function ThemeToggle() {
  const [night, setNight] = useState(false);

  useEffect(() => {
    setNight(document.documentElement.dataset.theme === "night");
    const onStore = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      const on = e.newValue === "night";
      document.documentElement.dataset.theme = on ? "night" : "day";
      setNight(on);
    };
    window.addEventListener("storage", onStore);
    return () => window.removeEventListener("storage", onStore);
  }, []);

  const flip = () => {
    const on = !night;
    document.documentElement.dataset.theme = on ? "night" : "day";
    try { localStorage.setItem(KEY, on ? "night" : "day"); } catch { /* private mode */ }
    setNight(on);
  };

  return (
    <button type="button" className="icon-btn press" aria-label="Dark mode" aria-pressed={night} onClick={flip}>
      {night ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z" />
        </svg>
      )}
    </button>
  );
}
