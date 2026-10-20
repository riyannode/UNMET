"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import MagicRings from "./MagicRings.tsx";
import "./unmet-landing.css";

type ModelKey = "chatgpt" | "claude" | "google" | "gemini";

type ModelConfig = {
  name: string;
  iconColor: string;
  iconUrl: string;
  query: string;
  answer: string;
  placeholder: string;
  latest: string;
};

type Message = {
  role: "user" | "ai";
  text: string;
  seed?: boolean;
};

const MODEL_ORDER: ModelKey[] = ["chatgpt", "claude", "google", "gemini"];

const MODELS: Record<ModelKey, ModelConfig> = {
  chatgpt: {
    name: "ChatGPT",
    iconColor: "#11a37f",
    iconUrl: "https://cdn.jiro.build/AI%20SEO/Images/Chat.svg",
    query: "How can an agent signal a capability it needs but cannot buy yet?",
    answer: "UNMET lets the agent publish a market request with a specification, max unit price, expected calls, deadline, and escrow. Other supporters can add commitments before any builder is selected.",
    placeholder: "Ask about funded demand...",
    latest: "Demand flow explained",
  },
  claude: {
    name: "Claude",
    iconColor: "#D97657",
    iconUrl: "https://cdn.jiro.build/AI%20SEO/Images/Claude.svg",
    query: "How does a builder know which AI-agent capability is worth building?",
    answer: "UNMET makes demand visible before supply exists. Builders compare requests backed by onchain escrow, then submit a service proposal against a funded need.",
    placeholder: "Ask what builders can discover...",
    latest: "Builder path explained",
  },
  google: {
    name: "Google AI",
    iconColor: "#3186FE",
    iconUrl: "https://cdn.jiro.build/AI%20SEO/Images/Google.svg",
    query: "What happens after a builder submits a service?",
    answer: "Supporters review the proposal with commitment-weighted voting. If quorum is reached, explicit approver funds settle to the builder and treasury; other eligible commitments remain refundable.",
    placeholder: "Ask about review and settlement...",
    latest: "Review flow summarized",
  },
  gemini: {
    name: "Gemini",
    iconColor: "#8F75FF",
    iconUrl: "https://cdn.jiro.build/AI%20SEO/Images/Gemini.svg",
    query: "Why is UNMET different from a normal agent marketplace?",
    answer: "Most marketplaces start with supply. UNMET starts with funded unmet demand, giving builders a credible signal for what agents already want.",
    placeholder: "Ask how UNMET works...",
    latest: "Market model compared",
  },
};

const MARQUEE_ITEMS = [
  { id: "x-layer", label: "X Layer", logo: null },
  { id: "okx", label: "OKX", logo: "/logos/okx.png" },
  { id: "usdt0", label: "USD₮0", logo: "/logos/usdt0.png" },
  { id: "x402", label: "x402", logo: null },
];

function seedMessages(key: ModelKey): Message[] {
  const model = MODELS[key];
  return [
    { role: "user", text: model.query, seed: true },
    { role: "ai", text: model.answer, seed: true },
  ];
}

function replyFor(modelName: string, value: string): string {
  const input = value.toLowerCase();

  if (
    input.includes("demand")
    || input.includes("market")
    || input.includes("need")
    || input.includes("request")
  ) {
    return modelName + " demo: UNMET makes unmet demand visible as funded onchain market requests, so builders can evaluate credible demand before they build.";
  }

  if (
    input.includes("escrow")
    || input.includes("fund")
    || input.includes("commit")
    || input.includes("support")
  ) {
    return modelName + " demo: supporters back a request with independent commitments. The aggregate escrow makes the demand signal credible before a builder is selected.";
  }

  return modelName + " demo: builders can inspect funded requests, submit a service proposal, and move through commitment-weighted supporter review before eligible settlement.";
}

function RollText({
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

function MiniBars() {
  return (
    <span className="unmet-bars" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function HeadlineLine({
  text,
  loaded,
  offset,
}: {
  text: string;
  loaded: boolean;
  offset: number;
}) {
  return (
    <span className="unmet-headline-line">
      {text.split(" ").map((word, wordIndex, words) => {
        const preceding = words.slice(0, wordIndex).join(" ").length + (wordIndex > 0 ? 1 : 0);
        return (
          <Fragment key={wordIndex}>
            {wordIndex > 0 ? " " : null}
            <span className="unmet-headline-word">
              {Array.from(word).map((char, index) => (
                <span className="unmet-headline-char-wrap" key={index}>
                  <span
                    className={"unmet-headline-char " + (loaded ? "is-loaded" : "")}
                    style={{ transitionDelay: String((preceding + index + offset) * 30) + "ms" }}
                  >
                    {char}
                  </span>
                </span>
              ))}
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}

function BrandChip() {
  return (
    <a className="unmet-brand-chip" href="#unmet-landing" aria-label="UNMET">
      <img src="/logos/unmet.png" alt="" width="32" height="32" />
    </a>
  );
}

export default function UnmetLanding() {
  const [loaded, setLoaded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeModel, setActiveModel] = useState<ModelKey>("chatgpt");
  const [messages, setMessages] = useState<Message[]>(seedMessages("chatgpt"));
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const messageWindowRef = useRef<HTMLDivElement>(null);
  const replyTimerRef = useRef<number | null>(null);

  const model = MODELS[activeModel];
  const heroWords = "UNMET turns unmet AI-agent needs into funded onchain market requests, so builders can see credible demand before they build.".split(" ");

  useEffect(() => {
    const timer = window.setTimeout(() => setLoaded(true), 50);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const el = messageWindowRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  useEffect(() => {
    return () => {
      if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current);
    };
  }, []);

  function switchModel(key: ModelKey) {
    if (replyTimerRef.current !== null) {
      window.clearTimeout(replyTimerRef.current);
      replyTimerRef.current = null;
    }
    setActiveModel(key);
    setMessages(seedMessages(key));
    setInput("");
    setTyping(false);
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const value = input.trim();
    if (!value || typing) return;

    setMessages((current) => current.concat({ role: "user", text: value }));
    setInput("");
    setTyping(true);

    if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current);
    replyTimerRef.current = window.setTimeout(() => {
      setMessages((current) => current.concat({
        role: "ai",
        text: replyFor(model.name, value),
      }));
      setTyping(false);
      replyTimerRef.current = null;
    }, 1000);
  }

  const navItems = [
    { label: "Market", href: "/market" },
    { label: "How It Works", href: "https://github.com/riyannode/UNMET#how-it-works" },
    { label: "Builders", href: "https://github.com/riyannode/UNMET/blob/main/docs/SUBMISSION.md" },
    { label: "Docs", href: "https://github.com/riyannode/UNMET/tree/main/docs" },
  ];

  return (
    <section id="unmet-landing" className="unmet-landing">
      <div className="unmet-background" aria-hidden="true">
        <MagicRings
          color="#5B8C32"
          colorTwo="#A3C96A"
          theme="light"
          motion="pulse"
          ringCount={6}
          speed={1}
          lineThickness={2}
          glow={1}
          baseRadius={0.52}
          clickBurst={false}
          hoverScale={1}
          hoverIntensity={0}
          parallax={0}
        />
      </div>

      <div className="unmet-content">
        <header className="unmet-nav">
          <BrandChip />

          <div className="unmet-nav-cluster">
            <nav className="unmet-nav-capsule" aria-label="Landing navigation">
              {navItems.map((item) => (
                <a
                  className="unmet-nav-link"
                  href={item.href === "/market" ? undefined : item.href}
                  role={item.href === "/market" ? "link" : undefined}
                  aria-disabled={item.href === "/market" ? true : undefined}
                  key={item.label}
                  onClick={() => setMenuOpen(false)}
                  rel={item.href.startsWith("http") ? "noreferrer" : undefined}
                  target={item.href.startsWith("http") ? "_blank" : undefined}
                >
                  <RollText text={item.label} />
                </a>
              ))}
            </nav>

            <a className="unmet-book" role="link" aria-disabled="true">
              <RollText text="Soon" variant="dark" />
              <MiniBars />
            </a>

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
              <a
                href={item.href === "/market" ? undefined : item.href}
                role={item.href === "/market" ? "link" : undefined}
                aria-disabled={item.href === "/market" ? true : undefined}
                key={item.label}
                onClick={() => setMenuOpen(false)}
                rel={item.href.startsWith("http") ? "noreferrer" : undefined}
                target={item.href.startsWith("http") ? "_blank" : undefined}
              >
                {item.label}
              </a>
            ))}
            <a className="unmet-mobile-cta" role="link" aria-disabled="true">
              Soon
            </a>
          </div>
        )}

        <div className="unmet-hero">
          <div className="unmet-left">
            <h1 aria-label="Fund what agents need before it exists">
              <HeadlineLine text="Fund what" loaded={loaded} offset={0} />{" "}
              <HeadlineLine text="agents need" loaded={loaded} offset={9} />{" "}
              <HeadlineLine text="before it exists" loaded={loaded} offset={21} />
            </h1>

            <p className="unmet-hero-copy" aria-label={heroWords.join(" ")}>
              {heroWords.map((word, index) => (
                <span
                  key={word + "-" + index}
                  className={loaded ? "is-loaded" : ""}
                  style={{ transitionDelay: String(800 + index * 40) + "ms" }}
                >
                  {word}
                </span>
              ))}
            </p>

            <a className="unmet-primary-cta" role="link" aria-disabled="true">
              <RollText text="Coming Soon" variant="dark" />
              <MiniBars />
            </a>

            <div className="unmet-marquee" aria-label="UNMET ecosystem">
              <div className="unmet-marquee-track jr-animate-marquee">
                {MARQUEE_ITEMS.map((item) => (
                  <span className="unmet-ecosystem-mark" key={"a-" + item.id}>
                    {item.logo ? (
                      <img className={"unmet-ecosystem-logo unmet-logo-" + item.id} src={item.logo} alt={item.label} />
                    ) : item.label}
                  </span>
                ))}
              </div>
              <div className="unmet-marquee-track jr-animate-marquee" aria-hidden="true">
                {MARQUEE_ITEMS.map((item) => (
                  <span className="unmet-ecosystem-mark" key={"b-" + item.id}>
                    {item.logo ? (
                      <img className={"unmet-ecosystem-logo unmet-logo-" + item.id} src={item.logo} alt={item.label} />
                    ) : item.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="unmet-right">
            <div className={"unmet-chat-card " + (loaded ? "is-loaded" : "")}>
              <div className="unmet-chat-header">
                <div className="unmet-model-title">
                  <span
                    className="unmet-model-icon-tile"
                    style={{ backgroundColor: model.iconColor + "15" }}
                  >
                    <img src={model.iconUrl} alt="" />
                  </span>
                  <strong>{model.name}</strong>
                </div>
              </div>

              <div className="unmet-message-window" ref={messageWindowRef}>
                {messages.map((message, index) => {
                  const delay = message.seed ? index * 200 + 400 : 50;
                  if (message.role === "user") {
                    return (
                      <div
                        className="unmet-message-row unmet-message-user jr-animate-bubble"
                        key={message.role + "-" + index + "-" + message.text}
                        style={{ animationDelay: String(delay) + "ms" }}
                      >
                        <div className="unmet-user-bubble">{message.text}</div>
                      </div>
                    );
                  }

                  return (
                    <div
                      className="unmet-message-row unmet-message-ai jr-animate-bubble"
                      key={message.role + "-" + index + "-" + message.text}
                      style={{ animationDelay: String(delay) + "ms" }}
                    >
                      <div className="unmet-ai-meta">
                        <strong>{model.name}</strong>
                      </div>
                      <div className="unmet-ai-bubble">{message.text}</div>
                    </div>
                  );
                })}

                {typing && (
                  <div className="unmet-typing-block">
                    <div className="unmet-typing-label">{model.name + " is reading the market..."}</div>
                    <div className="unmet-typing-pill" aria-label={model.name + " is typing"}>
                      <span style={{ animationDelay: "0ms" }} />
                      <span style={{ animationDelay: "150ms" }} />
                      <span style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                )}
              </div>

              <form className="unmet-input-wrap" onSubmit={submit}>
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={model.placeholder}
                  aria-label={"Message " + model.name}
                />
                <button type="submit" aria-label="Send message" disabled={typing || input.trim().length === 0}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 18V6M7 11l5-5 5 5" />
                  </svg>
                </button>
              </form>

              <div className="unmet-chat-footer">
                <span>{model.latest}</span>
              </div>
            </div>

            <div className={"unmet-switcher " + (loaded ? "is-loaded" : "")}>
              {MODEL_ORDER.map((key, index) => {
                const item = MODELS[key];
                const active = key === activeModel;
                const style: CSSProperties = {
                  animationDelay: String(600 + index * 100) + "ms",
                };

                return (
                  <button
                    type="button"
                    className={"unmet-model-tab jr-animate-bubble " + (active ? "is-active" : "")}
                    key={key}
                    style={style}
                    onClick={() => switchModel(key)}
                    aria-pressed={active}
                  >
                    <img src={item.iconUrl} alt="" />
                    <span>{item.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
