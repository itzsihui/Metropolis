# Monad Metropolis submission notes

**Project:** Borneo — an AI shopping agent that pays any store in USDC on Monad, with a passkey as the whole account.
**Main track:** Consumer Products & Payments.
**Deadline:** Oct 14, 2026, 11:59 GMT+8.

## One-liner

Tell the agent what you want; it finds it, and pays the store over HTTP 402 in USDC on Monad. Sign up is one passkey prompt, payments inside your session need no prompt at all, and if you're short you top up from whatever you hold on any chain.

## Why it fits Consumer Products & Payments

The track asks for financial products that use onchain rails as a design advantage for people who don't identify as crypto users. Borneo hides every crypto step a shopper would normally see:

| Usually needed | In Borneo |
|---|---|
| Wallet extension + seed phrase | One passkey ceremony (Mera) |
| A wallet popup per payment | Scoped signing session: $25/payment, $100/session, 30 min, no prompt |
| Gas token | Relayer pays MON; shopper signs an EIP-3009 authorization only |
| Right token on the right chain | Aurora Intents swaps anything on 30+ chains into USDC on Monad |
| A checkout page | x402: the agent pays the store over HTTP; Monad's 400 ms blocks make it feel instant |

## Prior work (disclose in the form)

Borneo started at earlier hackathons: the agent storefront protocol, the buyer and merchant agents, x402 settlement and the `BorneoCheckout` contract (deployed on Arbitrum Sepolia, Base Sepolia and HyperEVM Testnet). Built for Metropolis:

- Monad Testnet and Monad as the primary settlement chains (registry, contract allowlist, Foundry aliases, tests)
- Mera passkey accounts as the entire buyer account layer, with a scoped prompt-free signing session and step-up re-prompts
- Splitting x402 signing so the browser signs and the server never holds the shopper's key
- Aurora Intents any-chain top-ups with automatic order completion
- Alchemy RPC and Address Activity webhooks
- Privy merchant payout wallets

## Bounty answers

### Aurora Intents — Bring Any-Chain Liquidity to Monad

**How we integrate:** Swap API (1Click). When a shopper's passkey wallet is short for an order, checkout links to `/buyer/fund` with the exact shortfall. We request an `EXACT_OUTPUT` quote for that much Circle USDC on Monad, delivered to the passkey wallet, from whatever asset the shopper picks among the tokens Aurora lists. They send to the one-time deposit address; we poll `/api/status`, optionally report the deposit tx with `/api/deposit/submit`, and handle `INCOMPLETE_DEPOSIT`, `REFUNDED` and `FAILED`. Refunds default to the shopper's own address on EVM origin chains (the passkey derives the same EOA everywhere). On `SUCCESS` the shopper returns to the order and the agent completes the purchase with the funds that just arrived: deposit, then execute, in one flow.

**Friction removed:** a shopper holding SOL, BTC or USDC on Base can pay a Monad store without knowing what a bridge is.

**Code:** `src/lib/aurora/intents.ts`, `src/app/api/aurora/*`, `src/app/buyer/fund/page.tsx`, `src/app/buyer/_lib/resume-order.ts`.

### Best Mera-Powered UX on Monad

**How we integrate:** Mera is the entire buyer account layer. `createPasskeyWithPrfOutput` creates the account in one ceremony; the PRF output maps through BIP-39/32 to one secp256k1 key; `createSecp256k1SigningSession` + `toViemAccount` signs. There is no email, no OTP, no seed phrase, no extension and no custody backend: the server returns unsigned EIP-3009 authorizations and the browser signs them.

- **Session design:** prompt-free only for stablecoin payment authorizations (`TransferWithAuthorization` / `ReceiveWithAuthorization`) on known tokens and chains, capped at $25 per payment (lower if the shopper's own governance limit is lower) and $100 per session, for 30 minutes or 10 idle minutes. Anything else re-prompts. Expiry and lock zero the key copy (`session.end()`), as does closing the tab. The nav shows remaining prompt-free budget and minutes.
- **Stateless test:** localStorage holds only an untrusted hint (credential id + address). Clear it or use a fresh device: the passkey rebuilds the same address.
- **Stack composability:** gas abstraction (relayer pays MON), intents (Aurora top-ups into the passkey wallet), cross-chain account (the same passkey address receives refunds on any EVM chain).

**Code:** `src/lib/mera/*`, `src/app/buyer/_components/passkey-*.tsx`, `src/app/buyer/_lib/passkey-checkout.ts`, `src/app/api/buyer-agent/sign/route.ts`, `scripts/mera-scope.test.mts`.

### Best Projects using Alchemy

**How we integrate:** Alchemy node RPC carries every server read, x402 settlement and relayer transaction on Monad when `ALCHEMY_API_KEY` is set. Alchemy Webhooks: requesting a top-up adds the shopper's wallet to an Address Activity webhook through the Notify API; `/api/alchemy/webhook` verifies `X-Alchemy-Signature` and records stablecoin arrivals, which the top-up page shows as soon as Aurora's delivery lands.

**Code:** `src/lib/alchemy/*`, `src/app/api/alchemy/*`, `scripts/alchemy-webhook.test.mts`.

### Privy

**How we integrate (beyond login):** merchants sign in with email/Google/passkey and get a Privy embedded wallet as their payout address. The wallet signs the payout-binding proof (`useSignMessage`), which the app verifies before binding, and the merchant withdraws received USDC on Monad with `useSendTransaction` (Privy gas sponsorship when enabled). This replaces pasting private keys into the setup page.

**Code:** `src/components/merchant/privy-payout-wallet.tsx`, `src/app/merchant/setup/page.tsx`.

## Demo script (2 min)

1. Fresh browser → `/buyer/login` → **Create account with a passkey** (one prompt). Show the address and the session chip.
2. "Find me a cap under $1" → agent locks a quote → Pay. Wallet is empty → **Top up from any chain**.
3. Pick USDC on Base → deposit address → send from a phone wallet → status reaches *USDC arrived* (Alchemy line appears) → **Back to your order** → the agent pays with no prompt; open the Monad explorer link.
4. Clear site data, sign in with the same passkey: same address.
5. Merchant view: `/merchant/setup` → Privy payout wallet → `/dashboard`.

## Before submitting

- [ ] Deploy BorneoCheckout on Monad and run `npm run chains:check` (see `docs/monad.md`)
- [ ] Settle one passkey purchase on Monad and keep the explorer link
- [ ] Run one real Aurora top-up on mainnet and record it
- [ ] Live HTTPS link, demo video, pitch video, public repo
