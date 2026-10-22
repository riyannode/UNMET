"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { Link } from "react-router";
import { ROUTES } from "./routing.ts";
import UnmetNavigation, { MiniBars, RollText } from "./UnmetNavigation.tsx";
import MagicRings from "./MagicRings.tsx";
import UnmetHowItWorks from "./UnmetHowItWorks.tsx";
import UnmetFooter from "./UnmetFooter.tsx";
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
};

type ChatPhase = "typing" | "thinking" | "reading" | "fading";

type ChatState = {
  messages: Message[];
  mode: "demo" | "interactive";
  phase: ChatPhase;
  demoIndex: number;
  characters: number;
  activeAssistantIndex: number | null;
};

const MODEL_ORDER: ModelKey[] = ["chatgpt", "claude", "google", "gemini"];

const MODELS: Record<ModelKey, ModelConfig> = {
  chatgpt: {
    name: "ChatGPT",
    iconColor: "#11a37f",
    iconUrl: "https://cdn.jiro.build/AI%20SEO/Images/Chat.svg",
    query: "How can an agent signal a capability it needs but cannot buy yet?",
    answer: "UNMET lets the agent publish a market request with a specification, max unit price, expected calls, deadline, and escrow. Other supporters can add commitments before any builder is selected",
    placeholder: "Ask about funded demand...",
    latest: "Demand flow explained",
  },
  claude: {
    name: "Claude",
    iconColor: "#D97657",
    iconUrl: "https://cdn.jiro.build/AI%20SEO/Images/Claude.svg",
    query: "How does a builder know which AI-agent capability is worth building?",
    answer: "UNMET makes demand visible before supply exists. Builders compare requests backed by onchain escrow, then submit a service proposal against a funded need",
    placeholder: "Ask what builders can discover...",
    latest: "Builder path explained",
  },
  google: {
    name: "Google AI",
    iconColor: "#3186FE",
    iconUrl: "https://cdn.jiro.build/AI%20SEO/Images/Google.svg",
    query: "What happens after a builder submits a service?",
    answer: "Supporters review the proposal with commitment-weighted voting. If quorum is reached, explicit approver funds settle to the builder and treasury; other eligible commitments remain refundable",
    placeholder: "Ask about review and settlement...",
    latest: "Review flow summarized",
  },
  gemini: {
    name: "Gemini",
    iconColor: "#8F75FF",
    iconUrl: "https://cdn.jiro.build/AI%20SEO/Images/Gemini.svg",
    query: "Why is UNMET different from a normal agent marketplace?",
    answer: "Most marketplaces start with supply. UNMET starts with funded unmet demand, giving builders a credible signal for what agents already want",
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
    { role: "user", text: model.query },
    { role: "ai", text: model.answer },
  ];
}

function initialChatState(key: ModelKey): ChatState {
  return {
    messages: seedMessages(key),
    mode: "demo",
    phase: "typing",
    demoIndex: 0,
    characters: 0,
    activeAssistantIndex: null,
  };
}

function replyFor(value: string): string {
  const input = value.toLowerCase();

  if (
    input.includes("demand")
    || input.includes("market")
    || input.includes("need")
    || input.includes("request")
  ) {
    return "UNMET makes unmet demand visible as funded onchain market requests, so builders can evaluate credible demand before they build";
  }

  if (
    input.includes("escrow")
    || input.includes("fund")
    || input.includes("commit")
    || input.includes("support")
  ) {
    return "Supporters back a request with independent commitments. The aggregate escrow makes the demand signal credible before a builder is selected";
  }

  return "Builders can inspect funded requests, submit a service proposal, and move through commitment-weighted supporter review before eligible settlement";
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

type ProblemIconName = "git-merge" | "hand-coins" | "circle-help" | "store";
type ProblemAnimationName = "shield-check" | "eye-off" | "wallet" | "globe";

const PROBLEM_ITEMS: Array<{ icon: ProblemIconName; animation: ProblemAnimationName; title: string; description: string }> = [
  {
    icon: "git-merge",
    animation: "shield-check",
    title: "Requests Aren't Connected",
    description: "Agents need the same things, but their requests stay separate",
  },
  {
    icon: "hand-coins",
    animation: "eye-off",
    title: "Interest isn't funding",
    description: "A request doesn't prove someone is willing to pay",
  },
  {
    icon: "circle-help",
    animation: "wallet",
    title: "Builders are guessing",
    description: "Without demand signals, builders don't know what to build",
  },
  {
    icon: "store",
    animation: "globe",
    title: "Marketplaces to many Supply",
    description: "They show what's available, not what AI agents still need",
  },
];

function ProblemIcon({ name }: { name: ProblemIconName }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === "hand-coins" && (
        <>
          <path d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17" />
          <path d="m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9" />
          <path d="m2 16 6 6" />
          <circle cx="16" cy="9" r="2.9" />
          <circle cx="6" cy="5" r="3" />
        </>
      )}
      {name === "circle-help" && (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </>
      )}
      {name === "git-merge" && (
        <>
          <circle cx="18" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <path d="M6 21V9a9 9 0 0 0 9 9" />
        </>
      )}
      {name === "store" && (
        <>
          <path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5" />
          <path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244" />
          <path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05" />
        </>
      )}
    </svg>
  );
}

function ProblemSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const headerVisible = useInView(headerRef, { margin: "80px 0px", amount: 0.01 });
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const cells = section.querySelectorAll<HTMLElement>("[data-problem-cell]");
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }, { threshold: 0 });

    cells.forEach((cell) => observer.observe(cell));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="problem" className="unmet-problem" ref={sectionRef}>
      <div className="unmet-problem-glows" aria-hidden="true">
        <span className="unmet-problem-glow unmet-problem-glow-one" />
        <span className="unmet-problem-glow unmet-problem-glow-two" />
      </div>
      <div className="unmet-problem-content">
        <motion.header
          ref={headerRef}
          className="unmet-problem-header"
          initial={reducedMotion ? false : { opacity: 0, y: 14 }}
          animate={reducedMotion || headerVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
          transition={{
            duration: reducedMotion ? 0 : 0.4,
            ease: [0.25, 0.1, 0.25, 1],
          }}
        >
          <div className="unmet-problem-eyebrow">
            <span>Problem</span>
          </div>
          <h2>What AI Agents Need?</h2>
        </motion.header>
        <div className="unmet-problem-grid">
          {PROBLEM_ITEMS.map((item, index) => (
            <article
              className="unmet-problem-cell"
              data-problem-cell
              key={item.icon}
              style={{ "--problem-enter-delay": String(index * 0.1) + "s" } as CSSProperties}
            >
              <div className="unmet-problem-icon-tile">
                <span className="unmet-problem-icon">
                  <span className={"unmet-problem-icon-motion unmet-problem-icon-" + item.animation}>
                    <ProblemIcon name={item.icon} />
                  </span>
                </span>
              </div>
              <div className="unmet-problem-copy">
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
              <span className="unmet-problem-accent" aria-hidden="true" />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function UnmetLanding() {
  const [loaded, setLoaded] = useState(false);
  const [activeModel, setActiveModel] = useState<ModelKey>("chatgpt");
  const [chatByModel, setChatByModel] = useState<Record<ModelKey, ChatState>>(() => ({
    chatgpt: initialChatState("chatgpt"),
    claude: initialChatState("claude"),
    google: initialChatState("google"),
    gemini: initialChatState("gemini"),
  }));
  const [input, setInput] = useState("");
  const [pageHidden, setPageHidden] = useState(() => document.hidden);
  const chatCardRef = useRef<HTMLDivElement>(null);
  const messageWindowRef = useRef<HTMLDivElement>(null);
  const chatVisible = useInView(chatCardRef, { amount: 0.2 });
  const reducedMotion = useReducedMotion();

  const model = MODELS[activeModel];
  const chat = chatByModel[activeModel];
  const heroWords = "Users funded what agents need. Builders see what’s worth building".split(" ");
  const replyPending = chat.mode === "interactive" && (chat.phase === "thinking" || chat.phase === "typing");
  const animationRunning = !pageHidden && chatVisible && !reducedMotion;
  const displayedMessages = chat.mode === "demo" && !reducedMotion
    ? chat.messages.slice(0, chat.demoIndex + 1)
    : chat.messages;

  useEffect(() => {
    const timer = window.setTimeout(() => setLoaded(true), 50);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    const el = messageWindowRef.current;
    if (!el || !animationRunning || (chat.mode === "demo" && chat.phase === "fading")) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [activeModel, animationRunning, chat]);

  useEffect(() => {
    if (!animationRunning) return;
    if (chat.mode === "interactive" && chat.phase === "reading") return;

    const messageIndex = chat.mode === "demo" ? chat.demoIndex : chat.activeAssistantIndex;
    if (messageIndex === null) return;
    const message = chat.messages[messageIndex];
    if (!message) return;

    const delay = chat.phase === "typing"
      ? 32
      : chat.phase === "thinking"
        ? 1100
        : chat.phase === "fading"
          ? 240
          : chat.mode === "demo" && chat.demoIndex === chat.messages.length - 1
            ? 4000
            : 1800;

    const timer = window.setTimeout(() => {
      setChatByModel((current) => {
        const activeChat = current[activeModel];
        if (activeChat !== chat) return current;

        let nextChat: ChatState;
        if (chat.phase === "typing") {
          nextChat = chat.characters < message.text.length
            ? { ...chat, characters: chat.characters + 1 }
            : { ...chat, phase: "reading" };
        } else if (chat.phase === "thinking") {
          nextChat = { ...chat, phase: "typing", characters: 0 };
        } else if (chat.phase === "fading") {
          nextChat = initialChatState(activeModel);
        } else if (chat.demoIndex < chat.messages.length - 1) {
          const demoIndex = chat.demoIndex + 1;
          nextChat = {
            ...chat,
            demoIndex,
            characters: 0,
            phase: chat.messages[demoIndex].role === "ai" ? "thinking" : "typing",
          };
        } else {
          nextChat = { ...chat, phase: "fading" };
        }

        return { ...current, [activeModel]: nextChat };
      });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [activeModel, animationRunning, chat]);

  function switchModel(key: ModelKey) {
    if (key === activeModel) return;
    setChatByModel((current) => current[key].mode === "demo"
      ? { ...current, [key]: initialChatState(key) }
      : current);
    setActiveModel(key);
    setInput("");
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const value = input.trim();
    if (!value || replyPending) return;

    setChatByModel((current) => {
      const activeChat = current[activeModel];
      const assistantIndex = activeChat.messages.length + 1;
      const answer = replyFor(value);
      return {
        ...current,
        [activeModel]: {
          ...activeChat,
          messages: activeChat.messages.concat(
            { role: "user", text: value },
            { role: "ai", text: answer },
          ),
          mode: "interactive",
          phase: reducedMotion ? "reading" : "thinking",
          characters: 0,
          activeAssistantIndex: assistantIndex,
        },
      };
    });
    setInput("");
  }

  return (
    <>
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
        <UnmetNavigation />

        <div className="unmet-hero">
          <div className="unmet-left">
            <h1 aria-label="Agent Demand Market">
              <HeadlineLine text="Agent Demand Market" loaded={loaded} offset={0} />
            </h1>

            <p className="unmet-hero-copy" aria-label={heroWords.join(" ")}>
              {heroWords.map((word, index) => (
                <span
                  key={word + "-" + index}
                  className={"unmet-hero-copy-word " + (loaded ? "is-loaded" : "")}
                  style={{ transitionDelay: String(800 + index * 40) + "ms" }}
                >
                  {word}
                </span>
              ))}
            </p>

            <Link className="unmet-primary-cta" to={ROUTES.market.href}>
              <RollText text="Explore Market" variant="dark" />
              <MiniBars />
            </Link>

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
            <div className={"unmet-chat-card " + (loaded ? "is-loaded" : "")} ref={chatCardRef}>
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

              <div
                className="unmet-message-window"
                data-fading={chat.mode === "demo" && chat.phase === "fading" && !reducedMotion}
                data-paused={!animationRunning}
                ref={messageWindowRef}
              >
                {displayedMessages.map((message, index) => {
                  const isDemoTyping = chat.mode === "demo"
                    && !reducedMotion
                    && chat.phase === "typing"
                    && index === chat.demoIndex;
                  const isInteractiveTyping = chat.mode === "interactive"
                    && !reducedMotion
                    && chat.phase === "typing"
                    && index === chat.activeAssistantIndex;
                  const isThinking = !reducedMotion
                    && chat.phase === "thinking"
                    && index === (chat.mode === "demo" ? chat.demoIndex : chat.activeAssistantIndex);

                  if (message.role === "user") {
                    const text = isDemoTyping ? message.text.slice(0, chat.characters) : message.text;
                    return (
                      <div
                        className="unmet-message-row unmet-message-user"
                        key={message.role + "-" + index + "-" + message.text}
                      >
                        <div className="unmet-user-bubble">
                          {text}
                          {isDemoTyping && <span className="unmet-chat-caret" aria-hidden="true" />}
                        </div>
                      </div>
                    );
                  }

                  const text = isDemoTyping || isInteractiveTyping
                    ? message.text.slice(0, chat.characters)
                    : message.text;

                  return (
                    <div
                      className="unmet-message-row unmet-message-ai"
                      key={message.role + "-" + index + "-" + message.text}
                    >
                      <div className="unmet-ai-meta">
                        <strong>{model.name}</strong>
                      </div>
                      <div className="unmet-ai-bubble">
                        {isThinking ? (
                          <span className="unmet-typing-indicator" role="status" aria-label={model.name + " is typing"}>
                            <span />
                            <span />
                            <span />
                          </span>
                        ) : (
                          <>
                            {text}
                            {(isDemoTyping || isInteractiveTyping) && (
                              <span className="unmet-chat-caret" aria-hidden="true" />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <form className="unmet-input-wrap" onSubmit={submit}>
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={model.placeholder}
                  aria-label={"Message " + model.name}
                />
                <button type="submit" aria-label="Send message" disabled={replyPending || input.trim().length === 0}>
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
    <ProblemSection />
    <div className="unmet-market-infrastructure" aria-hidden="true">
      <img src="/images/unmet-market-infrastructure.png" alt="" />
    </div>
    <UnmetHowItWorks />
    <UnmetFooter />
    </>
  );
}
