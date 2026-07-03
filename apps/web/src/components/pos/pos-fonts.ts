import { Nunito_Sans, Rubik } from "next/font/google";

export const posRubik = Rubik({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-rubik",
  display: "swap",
});

export const posNunitoSans = Nunito_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-nunito-sans",
  display: "swap",
});

export const posFontVariables = `${posRubik.variable} ${posNunitoSans.variable}`;
