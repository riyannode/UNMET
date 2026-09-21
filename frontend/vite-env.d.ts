/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_XLAYER_RPC_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_DEMAND_CONTRACT?: string;
  readonly VITE_PAYMENT_TOKEN?: string;
  readonly VITE_REOWN_PROJECT_ID?: string;
  readonly VITE_NETWORK_SCENE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
