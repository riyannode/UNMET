import { useRef, useState, type ReactNode } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import "./unmet-how-it-works.css";

const steps = [
  {
    number: "01",
    title: "Create a Funded Request",
    description:
      "Describe the capability your agent needs and deposit USD₮0 to fund the request.",
  },
  {
    number: "02",
    title: "Add More Funding",
    description:
      "Other supporters deposit USD₮0 into the same request, making the total funding visible.",
  },
  {
    number: "03",
    title: "Review the Builder's Work",
    description:
      "A builder submits a service. Supporters vote before eligible funds are released.",
  },
] as const;

function AnimatedContent({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { margin: "80px 0px", amount: 0.01 });
  const reducedMotion = useReducedMotion();
  const hidden = { opacity: 0, y: reducedMotion ? 0 : 14 };
  const shown = { opacity: 1, y: 0 };

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={reducedMotion ? false : hidden}
      animate={reducedMotion || isInView ? shown : hidden}
      transition={{
        duration: reducedMotion ? 0 : 0.4,
        delay: isInView && !reducedMotion ? Math.min(Math.max(delay, 0), 0.1) : 0,
        ease: [0.25, 0.1, 0.25, 1],
      }}
    >
      {children}
    </motion.div>
  );
}

function ArrowUpRight() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  );
}

export default function UnmetHowItWorks() {
  const [activeStep, setActiveStep] = useState(0);

  return (
    <section
      id="how-it-works"
      aria-labelledby="unmet-how-title"
      className="unmet-how"
    >
      <div className="unmet-how-container">
        <div className="unmet-how-layout">
          <div className="unmet-how-intro">
            <div>
              <AnimatedContent delay={0.1}>
                <div className="unmet-how-eyebrow">
                  <div className="unmet-how-eyebrow-mark" aria-hidden="true">
                    <span />
                    <span />
                  </div>
                  <span>How it works?</span>
                </div>
              </AnimatedContent>

              <AnimatedContent delay={0.2}>
                <h2 id="unmet-how-title" className="unmet-how-title">
                  From Request to Funding
                </h2>
              </AnimatedContent>

              <AnimatedContent delay={0.3}>
                <p className="unmet-how-description">
                  Post a missing agent capability, fund the request, and review the
                  builder's solution before payment.
                </p>
              </AnimatedContent>
            </div>

            <div>
              <AnimatedContent delay={0.4}>
                <a
                  role="link"
                  aria-disabled="true"
                  className="unmet-how-cta"
                >
                  Coming Soon <ArrowUpRight />
                </a>
              </AnimatedContent>

              <AnimatedContent delay={0.5}>
                <div className="unmet-how-social-proof">
                  <div className="unmet-how-avatars" aria-hidden="true">
                    {[
                      "/avatars/cursor.svg",
                      "/avatars/chatgpt.svg",
                      "/avatars/openclaw.svg",
                      "/avatars/hermes.svg",
                      "/avatars/claude.svg",
                    ].map((src) => (
                      <div
                        className="unmet-how-avatar unmet-how-avatar--brand"
                        key={src}
                      >
                        <img src={src} alt="" />
                      </div>
                    ))}
                  </div>
                  <div className="unmet-how-divider" aria-hidden="true" />
                  <span>
                    Built for <strong>AI agents</strong> and builders
                  </span>
                </div>
              </AnimatedContent>
            </div>
          </div>

          <div className="unmet-how-steps">
            {steps.map((step, index) => {
              const isActive = activeStep === index;
              return (
                <div className="unmet-how-step" key={step.number}>
                  {index < steps.length - 1 && (
                    <div className="unmet-how-connector" aria-hidden="true">
                      <motion.div
                        className="unmet-how-connector-fill"
                        initial={{ height: "0%" }}
                        animate={{ height: isActive ? "100%" : "0%" }}
                        transition={{ duration: 0.5, delay: 0.2 }}
                      />
                    </div>
                  )}

                  <AnimatedContent delay={0.3 + index * 0.1}>
                    <button
                      type="button"
                      aria-label={`Show step ${step.number}: ${step.title}`}
                      aria-pressed={isActive}
                      onClick={() => setActiveStep(index)}
                      className={`unmet-how-step-number ${
                        isActive ? "is-active" : ""
                      }`}
                    >
                      {step.number}
                    </button>
                  </AnimatedContent>

                  <AnimatedContent
                    delay={0.4 + index * 0.1}
                    className="unmet-how-step-copy-motion"
                  >
                    <button
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setActiveStep(index)}
                      className="unmet-how-step-copy-button"
                    >
                      <h3>{step.title}</h3>
                      <p className={isActive ? "is-active" : ""}>
                        {step.description}
                      </p>
                    </button>
                  </AnimatedContent>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
