import "./unmet-footer.css";

export default function UnmetFooter() {
  return (
    <footer className="unmet-footer">
      <div className="unmet-footer-panel">
        <nav className="unmet-footer-directory" aria-label="Footer navigation">
          <div className="unmet-footer-group">
            <h3>Explore</h3>
            <a href="#unmet-landing">Home</a>
            <a href="#problem">Problem</a>
            <a href="#how-it-works">How It Works</a>
          </div>
          <div className="unmet-footer-group">
            <h3>Resources</h3>
            <span>GitHub</span>
            <span>Documentation</span>
          </div>
          <div className="unmet-footer-group">
            <h3>Community</h3>
            <a href="https://x.com/Unmetxyz" target="_blank" rel="noopener noreferrer">X</a>
          </div>
        </nav>

        <div className="unmet-footer-bottom">
          <a className="unmet-footer-logo" href="/" aria-label="UNMET Home">
            <img src="/logos/unmet.png" alt="UNMET" />
          </a>
          <p>© 2026 UNMET. All rights reserved</p>
          <div className="unmet-footer-socials" aria-label="Social links">
            <span
              className="unmet-footer-social"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.56.1.76-.24.76-.54v-2.1c-3.1.68-3.76-1.32-3.76-1.32-.51-1.3-1.24-1.65-1.24-1.65-1.02-.7.08-.69.08-.69 1.12.08 1.71 1.15 1.71 1.15 1 1.71 2.62 1.22 3.26.93.1-.72.39-1.22.71-1.5-2.48-.28-5.09-1.24-5.09-5.52 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.05 1.15a10.6 10.6 0 0 1 5.55 0c2.11-1.44 3.05-1.15 3.05-1.15.61 1.54.23 2.68.11 2.96.72.78 1.15 1.78 1.15 3 0 4.29-2.61 5.23-5.1 5.51.4.35.76 1.03.76 2.08v3.11c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z" />
              </svg>
            </span>
            <a
              className="unmet-footer-social"
              href="https://x.com/Unmetxyz"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="UNMET on X"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.736-8.835L1.254 2.25H8.08l4.259 5.622 5.905-6.872Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
