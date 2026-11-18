import type { ImgHTMLAttributes } from "react";
import { useTheme, type Theme } from "./theme.ts";

export function unmetLogoSource(theme: Theme): string {
  return theme === "dark" ? "/assets/unmet-dark-96-38b65fb53ed0.png" : "/assets/unmet-96-39fd20212f24.png";
}

export default function UnmetLogo(props: Omit<ImgHTMLAttributes<HTMLImageElement>, "src">) {
  const theme = useTheme();
  return <img {...props} src={unmetLogoSource(theme)} />;
}
