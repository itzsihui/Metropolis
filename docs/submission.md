# Crypto World's Fair — submission pack

**Hackathon:** Sep 14 – Oct 12, 2026, 11:59pm PT (Colosseum) · https://colosseum.com/hackathon
**Winners announced:** by Dec 5, 2026
**Tracks this project integrates with:** Arbitrum, Base, Hyperliquid (HyperEVM)

## What to submit

Colosseum asks for the items below. Fill the bracketed parts before submitting.

| Item | Notes |
|------|--------|
| Product name + description | Borneo: AI shopping agents that settle USDC over x402 on Arbitrum, Base and HyperEVM. Intent → route → settle → earn |
| Blockchains and tools | Arbitrum, Base, HyperEVM · x402 · EIP-3009 · Circle USDC · Paxos USDG · Uniswap V3 · Foundry · viem · Next.js |
| Team, backgrounds, location | [fill in] |
| Logo or graphic | [fill in] |
| Repository | This repo (public) |
| Presentation video | 2–3 minutes |
| Product demo video | Up to 3 minutes (shot list below) |
| Go-to-market, demand validation, distribution | [fill in] |
| Prior work disclosure | See "Prior work" below. Colosseum requires this in the form |
| Onchain proof | BorneoCheckout [`0xf818…9fc4`](https://sepolia.arbiscan.io/address/0xf8188490C10d0248DBB27bD1A07F8a7b4f0e9fc4) · settled purchase [`0x6984…3545`](https://sepolia.arbiscan.io/tx/0x698479add48aa055711965108a33457357465d4e36897029f96300757fa23545) · Base Sepolia checkout [`0x3aD9…6d28`](https://sepolia.basescan.org/address/0x3aD9d36Fd382162E206415fF1736E78bF8326d28) · settled purchase [`0xe59a…f642`](https://sepolia.basescan.org/tx/0xe59a1358d09517132756e5a4be1ee623061d459611de348deae718bda6f8f642) · HyperEVM Testnet checkout [`0x3aD9…6d28`](https://crypto-worlds-fair.vercel.app/explorer/998/address/0x3aD9d36Fd382162E206415fF1736E78bF8326d28) · settled purchase [`0x524b…38bb`](https://crypto-worlds-fair.vercel.app/explorer/998/tx/0x524be5fa8a4edcb79ff09a6ca1cab6ceda62dc4f9df71acd48e09e4a31da38bb) |

## Prior work

Colosseum's rule: teams may start before the hackathon, products are judged only on work done between the start and end dates, and all relevant past development must be disclosed in the submission form. Misrepresenting development history can lead to disqualification.

What to disclose:

- This repository's code was re-committed in small steps on Oct 11–12, 2026. The commit dates here are when the files were copied, not when they were first written.
- [List anything built before Sep 14, 2026, such as earlier versions on other chains.]

Added in this repository:

- Chain registry for Arbitrum, Base and HyperEVM (`src/lib/chains.ts`)
- 402 challenges with one entry per chain, and settlement on the chain the buyer signed for (`src/lib/protocol/x402.ts`, `handlers.ts`)
- Buyer agent chain selection by wallet balance, with per-chain trust checks (`src/lib/agents/tools-buyer.ts`)
- EIP-712 domains confirmed against each token's on-chain separator (`src/lib/protocol/token-domain.ts`)
- Per-chain token allowlists for deployment and cross-chain replay tests (`contracts/script/SettleTokens.sol`, `contracts/test/`)
- Chain preflight script and offline tests (`scripts/check-chains.mts`, `scripts/chains.test.mts`)

## How it maps to the judging criteria

| Criterion | Borneo |
|---|---|
| Functionality | Any HTTP agent buys from any store in one 402 round trip with no gas. BorneoCheckout settles every order on-chain. 29 Foundry tests (1 000-run fuzz, fork tests against real USDC + USDG) and 14 offline app tests. |
| Potential impact | Agents need a safe, open way to pay merchants. One protocol reaches buyers holding USDC on three ecosystems. |
| Novelty | x402 plus a checkout contract that binds each authorization to one order on one chain, with an on-chain fee split and rewards. |
| UX | Chat intent to settled order without a checkout page. The buyer pays from whichever chain holds funds and never needs a gas token. |
| Open-source / composability | Public repo. Standard x402 `exact` scheme and EIP-3009, so existing x402 clients work. `llms.txt`, `agent.json` and `catalog.json` for discovery. |
| Business plan | Protocol fee in basis points taken on-chain at settlement, shared back as XPoints. [expand] |

## Track notes

| Track | Integration |
|---|---|
| Arbitrum | Checkout live and verified on Arbitrum Sepolia. USDC + Paxos USDG. Uniswap V3 route quotes from Arbitrum One. ETH gas bridge via the Arbitrum SDK. |
| Base | Checkout live on Base Sepolia with a settled USDC purchase. Base is where x402 clients already operate. |
| Hyperliquid | Checkout live on HyperEVM Testnet with a settled USDC purchase. Relayer pays gas in HYPE. |

The checkout is deployed on Base Sepolia and HyperEVM Testnet, and `npm run chains:check` passes on all three chains. A real USDC purchase has settled on each of them (links above); see [`chains.md`](./chains.md#verification-status).

## Demo video shot list (~3 min)

1. **0:00–0:20** Landing: thesis line *Intent → Route → Settle → Earn*, "any HTTP agent can pay"
2. **0:20–0:50** `/buyer`: “Deploy funds into this tokenized asset” or fashion drop intent → picks including `/s/arbitrum-rwa-desk`
3. **0:50–1:20** Consent modal: liquidity route preview (USDC balance / ETH → USDC quote from Arbitrum One)
4. **1:20–2:00** Authorize → protocol log showing the 402 challenge with three chains → agent picks the funded chain → ReceiveWithAuthorization signature → `settle` → open the tx on the explorer and show the `OrderSettled` event + merchant/treasury split
5. **2:00–2:30** Same store, second purchase paid on another chain: `npx tsx --env-file=.env scripts/e2e-checkout.mts <url> atelier-tee "" base-sepolia`, then `hyperevm-testnet`
6. **2:30–2:45** `/buyer/xpoints`: XPoints earned + copy invite link (`?ref=`)
7. **2:45–3:00** curl `POST /s/{slug}/buy` → 402 with one `accepts` entry per chain (shows any agent can integrate)

## Deploy

Set the env vars from `.env.example` on Vercel (at minimum `CHAIN_NETWORK`, `SETTLE_NETWORKS`, `BUYER_PRIVATE_KEY`, `MERCHANT_ADDRESS`, `CHECKOUT_ADDRESS_<chainId>` per chain, `TREASURY_ADDRESS`, `OPENAI_API_KEY`, Firebase). Remove any old `XLAYER_*`, `OKX_*`, `TOKEN_ADDRESS`, `TOKEN_SYMBOL` and `EXPLORER_BASE` values so the chain defaults apply. Then:

```bash
vercel deploy --prod
```

Fund `BUYER_PRIVATE_KEY` with testnet USDC on each enabled chain, and the relayer with a little gas, per [`chains.md`](./chains.md).
