import { useLayoutEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { ROUTES } from "./routing.ts";

export function RollText({
  text,
  variant = "nav",
}: {
  text: string;
  variant?: "nav" | "dark";
}) {
  const chars = Array.from(text);
  return (
    <span className={"unmet-roll-text " + (variant === "dark" ? "unmet-roll-dark" : "")} aria-label={text}>
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
      <img src="/logos/unmet.png" alt="" width="32" height="32" />
      <span className="unmet-wordmark">unmet</span>
    </a>
  );
}

function LandingNavigationLink({
  item,
  className,
  animated = false,
  onNavigate,
}: {
  item: { label: string; href: string; external?: boolean };
  className?: string;
  animated?: boolean;
  onNavigate?: () => void;
}) {
  const content = animated ? <RollText text={item.label} /> : item.label;
  if (item.external) {
    return (
      <a className={className} href={item.href} target="_blank" rel="noopener noreferrer" onClick={onNavigate}>
        {content}
      </a>
    );
  }
  if (item.href.startsWith("#")) {
    return <a className={className} href={item.href} onClick={onNavigate}>{content}</a>;
  }
  return <Link className={className} to={item.href} onClick={onNavigate}>{content}</Link>;
}

export default function UnmetNavigation() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname, hash } = useLocation();
  const sectionHref = (section: string) => pathname === ROUTES.landing.path ? section : "/" + section;

  useLayoutEffect(() => {
    if (pathname !== ROUTES.landing.path || !hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [pathname, hash]);

  const navItems = [
    { label: "Market", href: ROUTES.market.href },
    { label: "How It Works", href: sectionHref("#how-it-works") },
    { label: "Builders", href: sectionHref("#problem") },
    { label: "Docs", href: ROUTES.docs.href },
  ];

  return (
    <>
      <header className="unmet-nav">
        <BrandChip />

        <div className="unmet-nav-cluster">
          <nav className="unmet-nav-capsule" aria-label="Landing navigation">
            {navItems.map((item) => (
              <LandingNavigationLink
                key={item.label}
                item={item}
                className="unmet-nav-link"
                animated
                onNavigate={() => setMenuOpen(false)}
              />
            ))}
          </nav>

          <Link className="unmet-book" to={ROUTES.createDemand.href}>
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
              onNavigate={() => setMenuOpen(false)}
            />
          ))}
          <Link className="unmet-mobile-cta" to={ROUTES.createDemand.href}>
            Create Demand
          </Link>
        </div>
      )}
    </>
  );
}
