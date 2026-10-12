"use client";

import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
  isMeraError,
  type Secp256k1SigningSession,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

/**
 * Buyer accounts are passkeys. The passkey's PRF output is the only secret:
 * it maps through BIP-39/BIP-32 to one secp256k1 key, so the same passkey
 * rebuilds the same Monad address on any device, with nothing stored
 * anywhere. There is no seed phrase to show, no extension and no custody
 * backend.
 */
export const BUYER_ACCOUNT_PATH = "m/44'/60'/0'/0/0";

export type PasskeyUnlock = {
  address: `0x${string}`;
  credentialId: string;
  session: Secp256k1SigningSession;
  account: ReturnType<typeof toViemAccount>;
};

export function passkeyRpId() {
  return typeof location === "undefined" ? "localhost" : location.hostname;
}

export function passkeysSupported() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof PublicKeyCredential !== "undefined"
  );
}

/** PRF output → private key → signing session. The key never leaves memory. */
function openSession(prfOutput: Uint8Array, credentialId: string): PasskeyUnlock {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive(BUYER_ACCOUNT_PATH);
  if (!node.privateKey) throw new Error("Passkey derivation produced no key");
  const session = createSecp256k1SigningSession({ privateKey: node.privateKey });
  // The session holds its own copy; drop ours.
  node.privateKey.fill(0);
  seed.fill(0);
  const account = toViemAccount(session);
  return { address: account.address, credentialId, session, account };
}

/** One passkey ceremony creates the account and opens its first session. */
export async function createPasskeyAccount(label?: string): Promise<PasskeyUnlock> {
  const handle = `shopper-${Math.random().toString(36).slice(2, 8)}`;
  const created = await createPasskeyWithPrfOutput({
    rp: { id: passkeyRpId(), name: "Borneo" },
    user: { name: handle, displayName: label?.trim() || "Borneo shopper" },
  });
  return openSession(created.prfOutput, created.credentialId);
}

/**
 * One passkey ceremony rebuilds the account. `credentialId` only pins which
 * passkey to offer; without it the browser lists every Borneo passkey.
 */
export async function unlockPasskeyAccount(credentialId?: string): Promise<PasskeyUnlock> {
  const result = await getPasskeyPrfOutput({
    rpId: passkeyRpId(),
    credential: credentialId ? { credentialId } : undefined,
  });
  return openSession(result.prfOutput, result.credentialId);
}

export function passkeyErrorMessage(error: unknown): string {
  if (isMeraError(error)) {
    switch (error.code) {
      case "PRF_UNAVAILABLE":
        return "This passkey provider can't derive keys (no WebAuthn PRF). Use iCloud Keychain, Google Password Manager or 1Password.";
      case "PASSKEY_OPERATION_FAILED":
        return "Passkey prompt was cancelled or failed.";
      case "CRYPTO_UNAVAILABLE":
        return "This browser has no secure random source.";
      case "SESSION_ENDED":
        return "Signing session ended. Unlock with your passkey again.";
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : "Passkey failed";
}
