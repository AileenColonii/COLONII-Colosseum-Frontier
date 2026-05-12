"use client";

/**
 * Solana Wallet Adapter providers for the colosseum demo.
 *
 * Wraps the route in:
 * - ConnectionProvider — pinned to devnet RPC. Mock mode never hits it,
 * but the AnchorWallet lives here for future live-mode integration.
 * - WalletProvider — Phantom + Solflare + Backpack adapters. autoConnect
 * OFF: public demo must not silently re-establish connections and leak
 * pubkeys via adoptWalletOwner on every page visit (Sec-MED).
 * - WalletModalProvider — exposes the standard "Connect" modal.
 *
 * Mock-mode caveat: when no wallet is connected, the BrowserMockColoniiClient
 * still falls back to Keypair.generate (in-memory). When a wallet IS
 * connected, the session uses the wallet's PublicKey as the identity owner
 *e code path, real cryptographic owner.*/

import { useMemo } from "react";
import {
  ConnectionProvider as RawConnectionProvider,
  WalletProvider as RawWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider as RawWalletModalProvider } from "@solana/wallet-adapter-react-ui";

// Cast around React 18/19 type drift in @solana/wallet-adapter-react. The
// shipped FC types declare children but TS resolves them as legacy nodes
// — `any` here is intentional and scoped to bridging that gap.
const ConnectionProvider = RawConnectionProvider as unknown as React.FC<any>;
const WalletProvider = RawWalletProvider as unknown as React.FC<any>;
const WalletModalProvider = RawWalletModalProvider as unknown as React.FC<any>;
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";

// Default styles shipped by the adapter — bundled CSS for the modal.
import "@solana/wallet-adapter-react-ui/styles.css";

export function ColoniiWalletProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  // Devnet RPC: cheap, public, never bills users. When live mode lands
  // for the beta app, switch to mainnet-beta or a paid RPC. Mock mode
  // never makes RPC calls so this is a placeholder.
  const endpoint = useMemo(() => clusterApiUrl("devnet"), []);

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      {/* Sec-MED: autoConnect=false — public demo route must not silently
 reconnect Phantom/Solflare on every visit and call adoptWalletOwner
 before the user has chosen to connect.*/}
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
