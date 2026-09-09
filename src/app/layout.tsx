import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@mdxeditor/editor/style.css";
import "./globals.css";
import { AppUpdates } from "../components/app-updates";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "庄Sir 的提词器",
  description: "Online shooting teleprompter room",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body>{children}<AppUpdates /></body>
    </html>
  );
}
