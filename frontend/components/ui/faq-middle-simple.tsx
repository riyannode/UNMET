"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";
import { cn } from "cn";

const FAQ_DATA = [
  {
    id: "1",
    question: "What is UNMET?",
    answer:
      "UNMET is a demand market for AI-agent capabilities. Instead of starting with available services, it lets users publish and fund capabilities they want builders to create.",
  },
  {
    id: "2",
    question: "How does funding a demand work?",
    answer:
      "A requester creates a demand with a specification, price limit, expected usage, deadline, and commitment. Other supporters can add funds to strengthen the demand signal before a builder is selected.",
  },
  {
    id: "3",
    question: "How does a builder get paid?",
    answer:
      "A builder submits a compatible service for supporter review. If enough committed funding approves the proposal, approved funds settle to the builder according to the demand's rules.",
  },
  {
    id: "4",
    question: "What happens if I do not approve a proposal?",
    answer:
      "Only commitments that explicitly approve a successful proposal are used for settlement. Eligible non-approver funds remain refundable.",
  },
  {
    id: "5",
    question: "Does funding a demand include future API usage?",
    answer:
      "No. Demand funding supports the creation of the requested capability. After fulfillment, API usage is paid separately and directly to the provider through its supported x402 payment endpoint.",
  },
];

export function FaqMiddleSimple({ className }: { className?: string }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sectionId = useId();
  const reducedMotion = useReducedMotion();
  const hidden = reducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 };
  const revealTransition = { duration: reducedMotion ? 0 : 0.4, ease: [0.25, 0.1, 0.25, 1] as const };

  return (
    <section
      aria-labelledby={`${sectionId}-title`}
      className={cn("box-border mx-auto w-full max-w-[1008px] px-6 pb-24 font-sans text-[var(--unmet-theme-text)]", className)}
    >
      <motion.div
        initial={reducedMotion ? false : "hidden"}
        animate={reducedMotion ? "visible" : "hidden"}
        whileInView="visible"
        viewport={{ once: false, margin: "80px 0px", amount: 0.01 }}
      >
        <motion.header
          variants={{
            hidden: { ...hidden, transition: { ...revealTransition, delay: 0 } },
            visible: { opacity: 1, y: 0, transition: { ...revealTransition, delay: 0 } },
          }}
          className="mb-12 text-center md:mb-[60px]"
        >
          <p className="m-0 mb-5 inline-flex items-center gap-2 rounded-full bg-[#f5f8f0] px-3 py-1.5 text-[14px] leading-4 font-medium text-[#59674b] dark:bg-[#242424] dark:text-[#d0d0d0]">
            <span aria-hidden="true" className="flex gap-0.5">
              <span className="h-2 w-1 rounded-full bg-[var(--unmet-theme-interactive)]" />
              <span className="h-2 w-1 rounded-full bg-[var(--unmet-theme-interactive)] opacity-40" />
            </span>
            FAQ
          </p>
          <h2 id={`${sectionId}-title`} className="m-0 text-[32px] leading-[38px] [font-family:'Satoshi_Headings',Satoshi,sans-serif] font-semibold tracking-[-0.04em] md:text-[44px] md:leading-[48px]">
            Frequently asked questions
          </h2>
        </motion.header>
      </motion.div>

      <div className="flex flex-col gap-5">
        {FAQ_DATA.map((item, index) => {
          const isActive = activeId === item.id;
          const triggerId = `${sectionId}-trigger-${item.id}`;
          const panelId = `${sectionId}-panel-${item.id}`;

          return (
            <motion.div
              key={item.id}
              initial={reducedMotion ? false : "hidden"}
              animate={reducedMotion ? "visible" : "hidden"}
              whileInView="visible"
              viewport={{ once: false, margin: "80px 0px", amount: 0.01 }}
            >
              <motion.div
                variants={{
                  hidden: { ...hidden, transition: { ...revealTransition, delay: 0 } },
                  visible: { opacity: 1, y: 0, transition: { ...revealTransition, delay: reducedMotion ? 0 : Math.min(index * 0.1, 0.1) } },
                }}
                className={cn(
                  "overflow-hidden rounded-[14px] border border-solid border-transparent bg-[#f4f4f5] transition-[background-color,border-color,box-shadow] duration-300 dark:bg-[var(--unmet-theme-surface)]",
                  isActive && "border-[#e0e0e1] bg-[#ededed] shadow-sm dark:border-[var(--unmet-theme-border)] dark:bg-[var(--unmet-theme-surface-raised)]",
                )}
              >
                <h3 className="m-0">
                  <button
                    id={triggerId}
                    type="button"
                    aria-expanded={isActive}
                    aria-controls={panelId}
                    onClick={() => setActiveId((current) => current === item.id ? null : item.id)}
                    className="flex min-h-[88px] w-full cursor-pointer items-center justify-between gap-4 border-0 bg-transparent px-5 py-5 text-left font-sans text-inherit focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--unmet-theme-interactive)] md:px-[26px]"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="text-[18px] leading-[26px] font-medium tracking-[-0.2px] md:text-[20px] md:leading-[30px]">{item.question}</span>
                    </span>
                    <motion.span
                      animate={{ rotate: isActive ? 45 : 0 }}
                      transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 200, damping: 20 }}
                      className="flex shrink-0"
                      aria-hidden="true"
                    >
                      <Plus className="size-6" />
                    </motion.span>
                  </button>
                </h3>

                <AnimatePresence initial={false}>
                  {isActive && (
                    <motion.div
                      id={panelId}
                      role="region"
                      aria-labelledby={triggerId}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: reducedMotion ? 0 : 0.4, ease: [0.4, 0, 0.2, 1] }}
                    >
                      <p className="m-0 mt-5 px-5 pb-[26px] text-[16px] leading-[1.6] text-[var(--unmet-theme-muted)] md:px-[26px]">
                        {item.answer}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

export default FaqMiddleSimple;
