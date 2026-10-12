# Running Borneo on Monad

Everything here runs from this repo. Monad Testnet is the default chain; switch to mainnet for the full Aurora Intents demo (Aurora runs on mainnets only).

| | Monad Testnet | Monad |
|---|---|---|
| `CHAIN_NETWORK` | `eip155:10143` | `eip155:143` |
| Gas | MON ([faucet.monad.xyz](https://faucet.monad.xyz)) | MON |
| USDC (Circle, EIP-3009) | `0x534b2f3A21130d7a60830c2Df862319e593943A3` | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| Testnet USDC | [faucet.circle.com](https://faucet.circle.com) | — |
| Public RPC | `https://testnet-rpc.monad.xyz` | `https://rpc.monad.xyz` |
| Explorer | `https://testnet.monadscan.com` | `https://monadscan.com` |
| Foundry alias | `monad_testnet` | `monad` |

## 1. Deploy BorneoCheckout

```bash
cd contracts
forge test                        # unit + fuzz, includes the Monad allowlist
DEPLOYER_PRIVATE_KEY=0x… TREASURY_ADDRESS=0x… PROTOCOL_FEE_BPS=50 \
  forge script script/DeployBorneoCheckout.s.sol --rpc-url monad_testnet --broadcast
```

The script allowlists Monad USDC. Put the printed address in `.env`:

```bash
CHAIN_NETWORK=eip155:10143
CHECKOUT_ADDRESS_10143=0x…
FACILITATOR_PRIVATE_KEY=0x…   # relayer; fund it with a little MON
MERCHANT_ADDRESS=0x…          # default payout (merchants can bind their own with Privy)
```

Then check the chain before settling:

```bash
npm run chains:check
```

It confirms the RPC chain id, USDC decimals and EIP-3009 support, the EIP-712 domain (read from the token), the checkout's code and allowlist, and the relayer's MON.

## 2. Shop with a passkey (Mera)

```bash
npm run dev    # http://localhost:3000 — passkeys need localhost or HTTPS
```

1. `/buyer/login` → **Create account with a passkey**. One prompt; the passkey's PRF output derives the wallet. Use iCloud Keychain, Google Password Manager or 1Password (the authenticator must support WebAuthn PRF).
2. The nav shows the wallet address and the prompt-free session ($25 per payment, $100 per session, 30 minutes).
3. Send testnet USDC to that address (Circle faucet), then ask the agent for something and pay. The payment is signed in the browser with no prompt and settled by the relayer; the shopper holds no MON.
4. Stateless check: clear site data or open a fresh browser profile, sign in with the same passkey, and see the same address. With the indexer running, `/buyer/activity` shows the same orders.

## 3. Top up from any chain (Aurora Intents)

Set `AURORA_INTENTS_API_KEY` (from [studio.aurora.dev](https://studio.aurora.dev)) and run on mainnet: `CHAIN_NETWORK=eip155:143`, `CHECKOUT_ADDRESS_143=0x…`, with real but tiny prices.

1. Start a purchase with an empty passkey wallet. The x402 step fails with **Top up from any chain**.
2. Pick what you hold (for example USDC on Base or SOL on Solana). The page quotes exactly the shortfall in USDC on Monad and shows a one-time deposit address.
3. Send it. Status moves from waiting → deposit seen → swapping → USDC arrived. Refunds go to the passkey address on EVM chains.
4. **Back to your order** finishes the purchase automatically with the funds that just arrived.

## 4. Index orders (Envio)

```bash
cd indexer
cp .env.example .env        # ENVIO_API_TOKEN, ENVIO_CHECKOUT_MONAD_TESTNET=0x… (and its deploy block)
npm install
npm test                    # offline, simulated events
npm run dev                 # local indexer + GraphQL at http://localhost:8080/v1/graphql
```

Or deploy to Envio Cloud and set `ENVIO_GRAPHQL_URL` in the app's `.env`.

## 5. Alchemy

- `ALCHEMY_API_KEY`: the app uses `https://monad-testnet.g.alchemy.com/v2/<key>` (or `monad-mainnet`) for every server read and settlement.
- Webhooks: create an **Address Activity** webhook on Monad pointing at `https://<your-site>/api/alchemy/webhook`, then set `ALCHEMY_WEBHOOK_SIGNING_KEY`, `ALCHEMY_WEBHOOK_ID` and `ALCHEMY_NOTIFY_TOKEN`. Each top-up adds the shopper's wallet to the webhook.

## 6. Privy (merchants)

Create an app at [dashboard.privy.io](https://dashboard.privy.io), enable email (and Google/passkey if wanted), add Monad, and set `NEXT_PUBLIC_PRIVY_APP_ID`. On `/merchant/setup`, **Create a payout wallet with Privy** → **Use as payout wallet** signs the binding proof. Received USDC can be withdrawn from the same card; set `NEXT_PUBLIC_PRIVY_SPONSOR_GAS=1` once gas sponsorship is enabled for Monad in the Privy dashboard, otherwise the wallet needs a little MON.
