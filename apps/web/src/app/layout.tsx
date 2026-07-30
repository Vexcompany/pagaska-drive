import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/providers";

// The entire app is gated on the client-side AuthProvider. Pages that
// use `useAuth()` are client components; if Next tries to statically
// prerender them, the provider never actually runs (it lives in a
// "use client" file) and `useContext(AuthContext)` returns null,
// throwing "useAuth must be used inside <AuthProvider>".
//
// Marking the whole layout as `force-dynamic` tells Next to render
// the app on each request, where the client provider does run on
// hydration. This is the correct mode for an authenticated Drive
// client — the HTML shell is cheap to render and the data is
// fetched per-user anyway.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pagaska Drive",
  description: "A privacy-first Google Drive client.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
