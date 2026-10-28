import { useLayoutEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { ROUTES } from "./routing.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";
import UnmetLogo from "./UnmetLogo.tsx";

export function RollText({
  text,
  variant = "nav",
}: {
  text: string;
  variant?: "nav" | "dark";
}) {
  const chars = Array.from(text);
  return (
    <span className={"unmet-roll-text " + (variant === "dark" ? "unmet-roll-dark" : "")}>
      <span className="unmet-roll-accessible">{text}</span>
      <span className="unmet-roll-layer unmet-roll-top" aria-hidden="true">
        {chars.map((char, index) => (
          <span key={"top-" + index} style={{ transitionDelay: String(index * 15) + "ms" }}>
            {char === " " ? "\u00A0" : char}
          </span>
        ))}
      </span>
      <span className="unmet-roll-layer unmet-roll-bottom" aria-hidden="true">
        {chars.map((char, index) => (
          <span key={"bottom-" + index} style={{ transitionDelay: String(index * 15) + "ms" }}>
            {char === " " ? "\u00A0" : char}
          </span>
        ))}
      </span>
    </span>
  );
}

export function MiniBars() {
  return (
    <span className="unmet-bars" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function BrandChip() {
  return (
    <a className="unmet-brand-chip" href="/" aria-label="UNMET Home">
      <UnmetLogo alt="" width="32" height="32" />
      <span className="unmet-wordmark">unmet</span>
    </a>
  );
}

function LandingNavigationLink({
  item,
  className,
  animated = false,
  onNavigate,
  documentNavigation = false,
}: {
  item: { label: string; href: string; external?: boolean };
  className?: string;
  animated?: boolean;
  onNavigate?: () => void;
  documentNavigation?: boolean;
}) {
  const content = animated ? <RollText text={item.label} /> : item.label;
  if (item.external) {
    return (
      <a className={className} href={item.href} target="_blank" rel="noopener noreferrer" onClick={onNavigate}>
        {content}
      </a>
    );
  }
  if (item.href.startsWith("#") || item.href === ROUTES.docs.href) {
    return <a className={className} href={item.href} onClick={onNavigate}>{content}</a>;
  }
  return <Link className={className} to={item.href} reloadDocument={documentNavigation} onClick={onNavigate}>{content}</Link>;
}

export default function UnmetNavigation({ documentNavigation = false }: { documentNavigation?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname, hash } = useLocation();
  const sectionHref = (section: string) => pathname === ROUTES.landing.path ? section : "/" + section;

  useLayoutEffect(() => {
    if (pathname !== ROUTES.landing.path || !hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [pathname, hash]);

  const navItems = [
    { label: "Market", href: ROUTES.market.href },
    { label: "How It works", href: sectionHref("#how-it-works") },
    { label: "Analytics", href: ROUTES.analytics.href },
    { label: "Docs", href: ROUTES.docs.href },
  ];

  return (
    <>
      <header className="unmet-nav">
        <div className="unmet-nav-brand-controls">
          <BrandChip />
          <ThemeToggle className="unmet-nav-theme-toggle" />
        </div>

        <div className="unmet-nav-cluster">
          <nav className="unmet-nav-capsule" aria-label="Landing navigation">
            {navItems.map((item) => (
              <LandingNavigationLink
                key={item.label}
                item={item}
                documentNavigation={documentNavigation}
                className="unmet-nav-link"
                animated
                onNavigate={() => setMenuOpen(false)}
              />
            ))}
          </nav>

          <Link className="unmet-book" to={ROUTES.createDemand.href} reloadDocument={documentNavigation}>
            <RollText text="Create Demand" variant="dark" />
            <MiniBars />
          </Link>

          <button
            className="unmet-menu-button"
            type="button"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {menuOpen ? (
                <path d="M6 6l12 12M18 6L6 18" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="unmet-mobile-menu">
          {navItems.map((item) => (
            <LandingNavigationLink
              key={item.label}
              item={item}
              documentNavigation={documentNavigation}
              onNavigate={() => setMenuOpen(false)}
            />
          ))}
          <Link className="unmet-mobile-cta" to={ROUTES.createDemand.href} reloadDocument={documentNavigation}>
            Create Demand
          </Link>
        </div>
      )}
    </>
  );
}
