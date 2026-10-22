# UNMET frontend

UNMET is a market for unmet AI-agent demand. Supporters commit test USD₮0 to capabilities; builders submit services for weighted approval or rejection. Only explicit approver funds settle. Other eligible commitments remain refundable.

This interface serves demand funders and builders comparing capability, escrow, calls, price and review state. Phase 1 adds route navigation and a shared app shell while preserving the existing wallet, receipt, readback and action rules. It does not authorize deployment or transactions.

The standalone landing page is at /. App routes /market, /market/:demandId, /create-demand, and /my-activity share the ReUI sidebar. Navigation is Explore Market, Create Demand, and My Activity; Demand Details keeps Explore Market active. Selecting a market request from the board or activity opens its dedicated Demand view with Request Details, Escrow & Support, and Builder Proposal tabs. Post a Request groups inputs into Request, Economics, and Initial Escrow, with the final action Post Request & Commit Escrow. The demand actions are labeled Support This Request and Submit Service Proposal; contract function names remain unchanged.
