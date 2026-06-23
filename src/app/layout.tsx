import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GRAYWORLD — Yin & Yang",
  description: "Un plataformas cooperativo pixel-art donde el mundo juega sucio.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
