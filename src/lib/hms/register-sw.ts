/** Guarded service-worker registration: production, top-level window, non-preview only. */
export function registerAppServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const host = window.location.hostname;
  const blocked =
    !import.meta.env.PROD ||
    window.self !== window.top ||
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev") ||
    new URL(window.location.href).searchParams.get("sw") === "off";

  if (blocked) {
    void navigator.serviceWorker.getRegistrations().then((regs) => {
      regs
        .filter((r) => (r.active?.scriptURL ?? "").endsWith("/sw.js"))
        .forEach((r) => void r.unregister());
    });
    return;
  }

  void navigator.serviceWorker.register("/sw.js");
}
