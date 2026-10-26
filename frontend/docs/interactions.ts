const sidebar = document.querySelector<HTMLDialogElement>("#docs-sidebar");
const toggle = document.querySelector<HTMLButtonElement>("#docs-menu-toggle");
const closeButton = document.querySelector<HTMLButtonElement>("#docs-sidebar-close");

if (sidebar && toggle && closeButton) {
  for (const group of sidebar.querySelectorAll<HTMLDetailsElement>("details")) {
    const key = "unmet-docs-group:" + group.querySelector("summary")!.textContent;
    try {
      group.open = group.hasAttribute("data-active-group") || sessionStorage.getItem(key) === "open";
    } catch {}
    group.addEventListener("toggle", () => {
      try { sessionStorage.setItem(key, group.open ? "open" : "closed"); } catch {}
    });
  }
  const mobile = window.matchMedia("(max-width: 1023px)");
  const syncSidebar = () => {
    if (sidebar.matches(":modal")) sidebar.close();
    if (mobile.matches) sidebar.removeAttribute("open");
    else sidebar.setAttribute("open", "");
    toggle.hidden = !mobile.matches;
    closeButton.hidden = !mobile.matches;
  };
  const revealCurrentLink = () => {
    const active = sidebar.querySelector<HTMLElement>("[aria-current]");
    const scroller = sidebar.matches(":modal") ? sidebar.querySelector("nav") : sidebar;
    if (active && scroller) scroller.scrollTop += active.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight / 2;
  };
  syncSidebar();
  if (!mobile.matches) revealCurrentLink();
  mobile.addEventListener("change", syncSidebar);
  toggle.addEventListener("click", () => {
    sidebar.showModal();
    revealCurrentLink();
    toggle.setAttribute("aria-expanded", "true");
  });
  closeButton.addEventListener("click", () => sidebar.close());
  sidebar.addEventListener("close", () => {
    toggle.setAttribute("aria-expanded", "false");
  });
  sidebar.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !sidebar.matches(":modal")) return;
    const controls = [...sidebar.querySelectorAll<HTMLElement>("button, a[href], summary")]
      .filter((control) => control.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first && last) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last && first) {
      event.preventDefault();
      first.focus();
    }
  });
  sidebar.addEventListener("click", (event) => {
    if ((event.target instanceof Element && event.target.closest("a")) && mobile.matches) sidebar.close();
  });
}

for (const block of document.querySelectorAll<HTMLElement>(".docs-code-block")) {
  const button = block.querySelector<HTMLButtonElement>(".docs-code-copy");
  const code = block.querySelector("pre code");
  const label = button?.querySelector("span");
  if (!button || !code || !label || !navigator.clipboard?.writeText) continue;
  const name = button.getAttribute("aria-label")!;
  let reset: ReturnType<typeof setTimeout>;
  button.hidden = false;
  button.addEventListener("click", async () => {
    clearTimeout(reset);
    try {
      await navigator.clipboard.writeText(code.textContent ?? "");
      label.textContent = "Copied";
    } catch {
      label.textContent = "Copy failed";
    }
    button.setAttribute("aria-label", label.textContent);
    reset = setTimeout(() => {
      label.textContent = "Copy";
      button.setAttribute("aria-label", name);
    }, 1800);
  });
}

const toc = [...document.querySelectorAll<HTMLAnchorElement>(".docs-toc a")];
const links = [...document.querySelectorAll<HTMLAnchorElement>(".docs-sidebar a")];
const headings = toc.map((link) => document.getElementById(link.hash.slice(1))).filter((heading): heading is HTMLElement => !!heading);
let scheduled = false;
function updateSection() {
  scheduled = false;
  const anchor = headings.find((heading) => "#" + heading.id === location.hash
    && heading.getBoundingClientRect().top >= 0 && heading.getBoundingClientRect().top < innerHeight);
  const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
  const active = atEnd && anchor ? anchor
    : headings.filter((heading) => heading.getBoundingClientRect().top <= 100).at(-1) ?? headings[0];
  for (const link of toc) {
    if (active && link.hash === "#" + active.id) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
  const currentPath = location.pathname.replace(/\/index\.html$/, "/").replace(/\/$/, "");
  const matching = links.filter((link) => link.pathname.replace(/\/$/, "") === currentPath);
  const sectionLink = [...matching].reverse().find((link) => {
    const heading = document.getElementById(link.hash.slice(1));
    const threshold = atEnd && anchor ? Math.max(110, anchor.getBoundingClientRect().top) : 110;
    return link.hash && heading && heading.getBoundingClientRect().top <= threshold;
  }) ?? matching.find((link) => !link.hash);
  for (const link of links) {
    if (link === sectionLink) link.setAttribute("aria-current", link.hash ? "location" : "page");
    else link.removeAttribute("aria-current");
  }
}
window.addEventListener("scroll", () => {
  if (!scheduled) { scheduled = true; requestAnimationFrame(updateSection); }
}, { passive: true });
window.addEventListener("hashchange", updateSection);
updateSection();

export {};
