import { createAppKit } from "@reown/appkit/react";
import { defineChain } from "@reown/appkit/networks";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { CHAIN_ID, RPC_URL, targetChain } from "./contract.ts";

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID?.trim();

const xLayerNetwork = defineChain({
  id: CHAIN_ID,
  caipNetworkId: `eip155:${CHAIN_ID}`,
  chainNamespace: "eip155",
  name: targetChain.name,
  nativeCurrency: targetChain.nativeCurrency,
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: {
      name: targetChain.blockExplorers.default.name,
      url: targetChain.blockExplorers.default.url,
    },
  },
});

export const appKit = projectId
  ? createAppKit({
      adapters: [new EthersAdapter()],
      networks: [xLayerNetwork],
      defaultNetwork: xLayerNetwork,
      projectId,
      metadata: {
        name: "UNMET",
        description: "Agent demand market",
        url: typeof window === "undefined" ? "https://unmet.vercel.app" : window.location.origin,
        icons: [],
      },
      themeMode: "light",
      defaultAccountTypes: { eip155: "eoa" },
      themeVariables: {
        "--apkt-accent": "#27764f",
        "--apkt-font-family": "Figtree Variable, Segoe UI, sans-serif",
        "--apkt-border-radius-master": "16px",
      },
      features: {
        analytics: false,
        email: false,
        socials: [],
        swaps: false,
        onramp: false,
      },
    })
  : null;
