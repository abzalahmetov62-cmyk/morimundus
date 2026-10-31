import type { Metadata } from "next";
import "./globals.css";

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export const metadata: Metadata = {
  title: "Morimundus · мастерская",
  description: "Авторский редактор локаций, предметов и повествования Morimundus.",
  icons: {
    icon: [{ url: "/favicon.ico?v=20261014", type: "image/x-icon" }, { url: "/favicon.png?v=20261014", type: "image/png", sizes: "256x256" }],
    shortcut: "/favicon.ico?v=20261014",
    apple: "/icon-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
