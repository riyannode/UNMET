/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_XLAYER_RPC_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_DEMAND_CONTRACT?: string;
  readonly VITE_PAYMENT_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
