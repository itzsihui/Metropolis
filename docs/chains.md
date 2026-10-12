# Settlement chains

Borneo settles x402 payments on four ecosystems. Monad is the primary chain (see [monad.md](./monad.md)). One codebase, one `BorneoCheckout` contract and one relayer key serve all of them.

| Chain | Network | Chain ID | Gas | Settle token | Explorer |
|---|---|---|---|---|---|
| Monad Testnet | `eip155:10143` | 10143 | MON | USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3` | testnet.monadscan.com |
| Monad | `eip155:143` | 143 | MON | USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | monadscan.com |
| Arbitrum Sepolia | `eip155:421614` | 421614 | ETH | USDC `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`, USDG `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` | sepolia.arbiscan.io |
| Arbitrum One | `eip155:42161` | 42161 | ETH | USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`, USDG `0x004B506865409877C9fA29bfb1ebA929984B9bbC` | arbiscan.io |
| Base Sepolia | `eip155:84532` | 84532 | ETH | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | sepolia.basescan.org |
| Base | `eip155:8453` | 8453 | ETH | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | basescan.org |
| HyperEVM Testnet | `eip155:998` | 998 | HYPE | USDC `0x2B3370eE501B4a559b57D449569354196457D8Ab` | built-in viewer at `/explorer/998` |
| HyperEVM | `eip155:999` | 999 | HYPE | USDC `0xb88339CB7199b77E23DB6E890353E22632Ba630f` | hyperevmscan.io |

The registry lives in [`src/lib/chains.ts`](../src/lib/chains.ts); the contract-side allowlist mirrors it in [`contracts/script/SettleTokens.sol`](../contracts/script/SettleTokens.sol). USDC addresses are from [Circle's contract list](https://developers.circle.com/stablecoins/usdc-contract-addresses), USDG from [Paxos](https://docs.paxos.com/guides/stablecoin/usdg/mainnet).

## Why these chains

- **Monad** is the primary chain: 400 ms blocks and Circle-native USDC with EIP-3009, so passkey-signed payments settle almost as soon as the shopper confirms.

- **Arbitrum** is where Borneo started. The checkout is deployed and verified there, and the Uniswap route quote and ETH gas bridge are Arbitrum features.
- **Base** is the home chain of x402, so any existing x402 agent can pay a Borneo store there without changes.
- **HyperEVM** has Circle-native USDC with EIP-3009, so the same contract and signing flow apply. Gas is HYPE.

All three use 6-decimal USDC, so a SKU priced `0.02` costs `20000` atomic units everywhere.

## Configure

```bash
# Primary chain: drives the UI labels, the liquidity panel and the default 402 entry.
CHAIN_NETWORK=eip155:10143

# Extra chains offered in the same 402. Ids, chain ids or labels all work.
SETTLE_NETWORKS=base-sepolia,hyperevm-testnet

# One BorneoCheckout per chain. Leave a chain's line out to pay merchants directly there.
CHECKOUT_ADDRESS_421614=0xf8188490C10d0248DBB27bD1A07F8a7b4f0e9fc4
CHECKOUT_ADDRESS_84532=0x…
CHECKOUT_ADDRESS_998=0x…

# Optional per-chain RPC and explorer overrides.
RPC_URL_84532=https://…
EXPLORER_BASE_998=https://…

# Optional: make the buyer agent always pay on one chain.
BUYER_NETWORK=base-sepolia
```

`CHAIN_NETWORK` and `SETTLE_NETWORKS` are also compiled into the client bundle for labels, so rebuild after changing them. The existing un-suffixed `RPC_URL`, `TOKEN_ADDRESS`, `EXPLORER_BASE` and `CHECKOUT_ADDRESS` still apply to the primary chain.

## What a multi-chain 402 looks like

```jsonc
// POST /s/atelier-tee/buy  →  402
{
  "x402Version": 2,
  "accepts": [
    { "scheme": "exact", "network": "eip155:421614", "asset": "0x75fa…AA4d", "amount": "20000", "payTo": "<checkout on Arbitrum Sepolia>", "extra": { "name": "USD Coin", "version": "2", "nonce": "0x…", "chainLabel": "Arbitrum Sepolia" } },
    { "scheme": "exact", "network": "eip155:84532",  "asset": "0x036C…CF7e", "amount": "20000", "payTo": "<checkout on Base Sepolia>",     "extra": { "name": "USDC",     "version": "2", "nonce": "0x…", "chainLabel": "Base Sepolia" } },
    { "scheme": "exact", "network": "eip155:998",    "asset": "0x2B33…D8Ab", "amount": "20000", "payTo": "<checkout on HyperEVM Testnet>", "extra": { "name": "…",        "version": "2", "nonce": "0x…", "chainLabel": "HyperEVM Testnet" } }
  ]
}
```

The buyer signs exactly one entry. The buyer agent chooses `BUYER_NETWORK` if the store lists it, otherwise the first chain (in the store's order) where its wallet already holds enough. It recomputes the order nonce for that chain and refuses a `payTo` that is not the checkout it trusts there. `agent.json`, `catalog.json` and `llms.txt` list the same networks for discovery.

A USDG-priced SKU is only offered on chains where USDG exists (Arbitrum).

## EIP-712 domains are read from the chain

An EIP-3009 signature only verifies if the `name` and `version` match what the token hashes into its `DOMAIN_SEPARATOR`, and USDC uses different names on different deployments (`USD Coin` on Arbitrum and Base mainnet, `USDC` on Base Sepolia). When building a 402, Borneo reads the token's own `eip712Domain()` / `name()` / `version()` and keeps the candidate whose separator matches on-chain ([`token-domain.ts`](../src/lib/protocol/token-domain.ts)). The preset is the fallback if the RPC does not answer within 3 seconds.

## Deploy the checkout on a new chain

```bash
cd contracts
forge test                                    # 29 tests, no RPC needed

DEPLOYER_PRIVATE_KEY=0x… TREASURY_ADDRESS=0x… PROTOCOL_FEE_BPS=50 \
  forge script script/DeployBorneoCheckout.s.sol --rpc-url base_sepolia --broadcast
# same command with --rpc-url hyperevm_testnet, arbitrum_one, base, hyperevm
```

The script allowlists that chain's stablecoins and reverts on a chain it does not know. Put the printed address in `CHECKOUT_ADDRESS_<chainId>`. `PROTOCOL_FEE_BPS` in the app must equal the contract's `feeBps`.

Funding per chain:

| Wallet | Needs |
|---|---|
| Buyer (`BUYER_PRIVATE_KEY`) | USDC on the chain it pays on. Testnet USDC: [faucet.circle.com](https://faucet.circle.com). No gas |
| Relayer (`FACILITATOR_PRIVATE_KEY`, or the buyer key) | A little gas on every enabled chain: MON on Monad, ETH on Arbitrum and Base, HYPE on HyperEVM |
| Deployer | Gas on the chain being deployed to |

## Preflight

```bash
npm run chains:check          # CHAIN_NETWORK + SETTLE_NETWORKS
npm run chains:check -- all   # every supported chain
```

For each chain it checks that the RPC reports the expected chain id, the token has 6 decimals and answers `authorizationState`, the signing domain matches `DOMAIN_SEPARATOR`, the checkout has code and allowlists the token, and the relayer holds gas. It exits non-zero on any failure.

Then pay on a specific chain against a running server:

```bash
npx tsx --env-file=.env scripts/e2e-checkout.mts http://localhost:3000 atelier-tee "" base-sepolia
```

## Verification status

| | Status |
|---|---|
| Arbitrum Sepolia | Checkout live and verified; real USDC and USDG purchases settled (links in the README) |
| Multi-chain flow | Exercised end to end on local Anvil chains with the three testnet chain ids and a mock EIP-3009 token at each USDC address: one purchase per chain, buyer-agent chain selection, double-pay, unlisted-chain and cross-chain replay attempts |
| Base Sepolia | Checkout [`0x3aD9…6d28`](https://sepolia.basescan.org/address/0x3aD9d36Fd382162E206415fF1736E78bF8326d28) deployed; `npm run chains:check` passes; real USDC purchase settled through the checkout: [`0xe59a…f642`](https://sepolia.basescan.org/tx/0xe59a1358d09517132756e5a4be1ee623061d459611de348deae718bda6f8f642) |
| HyperEVM Testnet | Checkout `0x3aD9d36Fd382162E206415fF1736E78bF8326d28` deployed (tx `0x5bfd20c64b7cb8041ad96f1b48c3910a72148eaac6ae35f4d45dba44a57225c7`); `npm run chains:check` passes; real USDC purchase settled through the checkout from the live site: [`0x524b…38bb`](https://crypto-worlds-fair.vercel.app/explorer/998/tx/0x524be5fa8a4edcb79ff09a6ca1cab6ceda62dc4f9df71acd48e09e4a31da38bb) |
| HyperEVM Testnet explorer | No public explorer indexes this testnet (Oct 2026): `testnet.purrsec.com` returns 404, the Blockscout instance is millions of blocks behind, and HypurrScan's testnet EVM pages read mainnet. Borneo serves its own RPC-backed viewer at `/explorer/998/tx/<hash>` and `/explorer/998/address/<addr>`, and receipts link there. Set `SITE_URL` to make those links absolute outside Vercel, or `EXPLORER_BASE_998` to use another explorer |

## Not supported, and why

- **Uniswap route and gas bridge off Arbitrum.** `/api/liquidity` quotes Uniswap V3 on Arbitrum One and `/buyer/gas` uses the Arbitrum canonical bridge. On Base or HyperEVM as the primary chain the buyer pays straight from its USDC balance and the bridge endpoint returns a clear error.
- **Non-EVM chains.** The contract and the EIP-3009 signing flow are EVM-specific, so Solana and Zcash would need a separate settlement path.
- **Stablecoins without EIP-3009.** A token must implement `receiveWithAuthorization` (checkout mode) or `transferWithAuthorization` (direct mode). Permit-only tokens would need a new contract entry point.
- **One process per order lock.** The guard that stops one order settling on two chains at once is in-process. Running several server instances needs a shared lock in the order store.
