import type { ImgHTMLAttributes } from "react";
import { useTheme, type Theme } from "./theme.ts";

export function unmetLogoSource(theme: Theme): string {
  return theme === "dark" ? "/logos/unmet-dark.png" : "/logos/unmet.png";
}

export default function UnmetLogo(props: Omit<ImgHTMLAttributes<HTMLImageElement>, "src">) {
  const theme = useTheme();
  return <img {...props} src={unmetLogoSource(theme)} />;
}
