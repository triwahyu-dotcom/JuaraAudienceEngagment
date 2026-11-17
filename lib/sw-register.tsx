'use client';

import { useEffect } from 'react';

/** Mendaftarkan service worker supaya halaman tetap bisa dibuka tanpa sinyal. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
