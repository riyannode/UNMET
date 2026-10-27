import { Moon, Sun } from "lucide-react";
import { Button } from "./components/ui/button.tsx";
import { setTheme, useTheme } from "./theme.ts";
import "./theme-toggle.css";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useTheme();
  const nextTheme = theme === "light" ? "dark" : "light";
  const Icon = theme === "light" ? Moon : Sun;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`unmet-theme-toggle ${className}`}
      aria-label={`Switch to ${nextTheme} theme`}
      title={`Switch to ${nextTheme} theme`}
      onClick={() => setTheme(nextTheme)}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}
