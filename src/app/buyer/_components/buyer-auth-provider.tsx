"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User } from "firebase/auth";
import {
  authErrorMessage,
  loadBuyerFromCloud,
  signInBuyer,
  signOutBuyer,
  signUpBuyer,
  subscribeAuth,
} from "@/lib/firebase/buyer-auth";
import { isFirebaseConfigured } from "@/lib/firebase/client";
import {
  ensurePasskeyBuyerAccount,
  readBuyerAccount,
  setBuyerCloudSyncUid,
  writeBuyerAccount,
  type BuyerAccount,
} from "@/lib/buyer-account";
import { usePasskeyWallet } from "./passkey-wallet-provider";

/**
 * How shoppers sign in. "passkey" (default): a Mera passkey is the whole
 * account, no email and no backend. "firebase": the older email/password flow.
 */
export type BuyerAccountMode = "passkey" | "firebase";

export const BUYER_ACCOUNT_MODE: BuyerAccountMode =
  process.env.NEXT_PUBLIC_BUYER_ACCOUNTS === "firebase" ? "firebase" : "passkey";

type BuyerAuthContextValue = {
  mode: BuyerAccountMode;
  configured: boolean;
  ready: boolean;
  user: User | null;
  account: BuyerAccount | null;
  refreshAccount: () => Promise<void>;
  signUp: (args: {
    email: string;
    password: string;
    displayName: string;
  }) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  errorMessage: (err: unknown) => string;
};

const BuyerAuthContext = createContext<BuyerAuthContextValue | null>(null);

export function BuyerAuthProvider({ children }: { children: React.ReactNode }) {
  const mode = BUYER_ACCOUNT_MODE;
  const wallet = usePasskeyWallet();
  const configured = mode === "firebase" && isFirebaseConfigured();
  const [ready, setReady] = useState(!configured);
  const [user, setUser] = useState<User | null>(null);
  const [firebaseAccount, setAccount] = useState<BuyerAccount | null>(null);
  // Passkey mode: the profile follows the wallet address.
  const [passkeyAccount, setPasskeyAccount] = useState<BuyerAccount | null>(null);
  const passkeyFor = wallet.address;
  const account =
    mode === "passkey"
      ? passkeyAccount?.walletAddress?.toLowerCase() === passkeyFor?.toLowerCase()
        ? passkeyAccount
        : null
      : firebaseAccount;

  useEffect(() => {
    if (mode !== "passkey" || !passkeyFor) return;
    const ensured = ensurePasskeyBuyerAccount(passkeyFor);
    queueMicrotask(() => setPasskeyAccount(ensured));
  }, [mode, passkeyFor]);

  const refreshAccount = useCallback(async () => {
    if (mode === "passkey") {
      setPasskeyAccount(passkeyFor ? ensurePasskeyBuyerAccount(passkeyFor) : null);
      return;
    }
    if (user) {
      const cloud = await loadBuyerFromCloud(user.uid);
      if (cloud) {
        writeBuyerAccount(cloud);
        setAccount(cloud);
        return;
      }
    }
    setAccount(readBuyerAccount());
  }, [mode, passkeyFor, user]);

  useEffect(() => {
    if (!configured) {
      setAccount(readBuyerAccount());
      setReady(true);
      return;
    }

    const unsub = subscribeAuth(async (next) => {
      setUser(next);
      setBuyerCloudSyncUid(next?.uid ?? null);
      if (next) {
        const cloud = await loadBuyerFromCloud(next.uid);
        if (cloud) {
          writeBuyerAccount(cloud);
          setAccount(cloud);
        } else {
          // New auth user without profile doc yet — keep any local draft
          setAccount(readBuyerAccount());
        }
      } else {
        setAccount(null);
      }
      setReady(true);
    });
    return () => unsub();
  }, [configured]);

  const value = useMemo<BuyerAuthContextValue>(
    () => ({
      mode,
      configured,
      ready,
      user,
      account,
      refreshAccount,
      signUp: async (args) => {
        const { account: created } = await signUpBuyer(args);
        setAccount(created);
      },
      signIn: async (email, password) => {
        const { account: loaded } = await signInBuyer(email, password);
        setAccount(loaded);
      },
      signOut: async () => {
        if (mode === "passkey") {
          wallet.lock();
          setPasskeyAccount(null);
          return;
        }
        await signOutBuyer();
        setBuyerCloudSyncUid(null);
        setAccount(null);
        setUser(null);
      },
      errorMessage: authErrorMessage,
    }),
    [mode, configured, ready, user, account, refreshAccount, wallet],
  );

  return (
    <BuyerAuthContext.Provider value={value}>
      {children}
    </BuyerAuthContext.Provider>
  );
}

export function useBuyerAuth() {
  const ctx = useContext(BuyerAuthContext);
  if (!ctx) {
    throw new Error("useBuyerAuth must be used within BuyerAuthProvider");
  }
  return ctx;
}
