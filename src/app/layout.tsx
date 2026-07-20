import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIOS — Dashboard di Automazione",
  description:
    "Sistema operativo aziendale AI-native: Orchestratore, 3 Direttori e sub-agenti esperti on-demand per lo studio di consulenza.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}