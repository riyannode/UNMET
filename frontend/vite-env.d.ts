/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_XLAYER_RPC_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_CHAIN_NAME?: string;
  readonly VITE_CHAIN_EXPLORER_URL?: string;
  readonly VITE_CHAIN_NATIVE_NAME?: string;
  readonly VITE_CHAIN_NATIVE_SYMBOL?: string;
  readonly VITE_CHAIN_NATIVE_DECIMALS?: string;
  readonly VITE_DEMAND_CONTRACT?: string;
  readonly VITE_PAYMENT_TOKEN?: string;
  readonly VITE_PAYMENT_TOKEN_SYMBOL?: string;
  readonly VITE_PAYMENT_TOKEN_DECIMALS?: string;
  readonly VITE_VALIDATION_URL?: string;
  readonly VITE_VALIDATION_NETWORKS?: string;
  readonly VITE_REOWN_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
