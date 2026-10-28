import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import AdminProvider from "@/components/AdminProvider";
import Shell from "@/components/Shell";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "EcoMAB Admin",
  description: "Monitor EcoMAB data endpoints, incoming client data and system health.",
  robots: { index: false, follow: false },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#075b4a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        <AdminProvider>
          <Shell>{children}</Shell>
        </AdminProvider>
      </body>
    </html>
  );
}
