# UNMET frontend

Current frontend behavior is described here. See [PRD](PRD.md) for the demand model and future roadmap, and [Design](DESIGN.md) for UI conventions and acceptance targets.

UNMET is a market for unmet AI-agent demand. Supporters commit test USD₮0 to capabilities; builders submit services for weighted approval or rejection. Only explicit approver funds settle. Other eligible commitments remain refundable.

This interface serves demand funders and builders comparing capability, escrow, calls, price and review state. Phase 1 adds route navigation and a shared app shell; Phase 2 replaces the Create Demand form with a deterministic guided chat and six-term review. The wizard preserves the existing Reown wallet, receipt, readback and action rules and uses the canonical contract path only after explicit create intent. Its responses are local UI prompts, not AI-generated content.

The standalone landing page is at /. App routes /market, /market/:demandId, /create-demand, and /analytics share the ReUI sidebar. Navigation is Explore Market, Create Demand, and Analytics; /my-activity redirects to /analytics. Demand Details keeps Explore Market active. Selecting a market request from the board or Analytics opens its dedicated Demand view with Request Details, Escrow & Support, and Builder Proposal tabs. The Create Demand wizard collects service capability, specification, maximum unit price, expected calls, initial escrow and deadline, then offers review, edit and Create & Fund Demand controls. The demand actions are labeled Support This Request and Submit Service Proposal; contract function names remain unchanged.
