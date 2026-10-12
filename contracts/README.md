# BorneoCheckout contracts

Foundry workspace for `BorneoCheckout`, the x402 settlement contract Borneo uses on Monad, Arbitrum, Base and HyperEVM. The contract is identical on every chain; only the allowlisted stablecoins differ. See the [root README](../README.md#smart-contract-borneocheckout) for the design and [`docs/chains.md`](../docs/chains.md) for the chain list.

| Network | Address |
|---|---|
| Monad Testnet | deploy with `--rpc-url monad_testnet` |
| Monad | deploy with `--rpc-url monad` |
| Arbitrum Sepolia | [`0xf8188490C10d0248DBB27bD1A07F8a7b4f0e9fc4`](https://sepolia.arbiscan.io/address/0xf8188490C10d0248DBB27bD1A07F8a7b4f0e9fc4) |
| Base Sepolia | [`0x3aD9d36Fd382162E206415fF1736E78bF8326d28`](https://sepolia.basescan.org/address/0x3aD9d36Fd382162E206415fF1736E78bF8326d28) |
| HyperEVM Testnet | [`0x3aD9d36Fd382162E206415fF1736E78bF8326d28`](https://crypto-worlds-fair.vercel.app/explorer/998/address/0x3aD9d36Fd382162E206415fF1736E78bF8326d28) |

## Commands

```shell
forge build
forge test                                                     # unit + fuzz (mock EIP-3009 token)
forge test --match-contract Fork --fork-url https://sepolia-rollup.arbitrum.io/rpc   # real USDC + Paxos USDG

# Deploy. --rpc-url takes any alias from foundry.toml: monad_testnet, monad,
# arbitrum_sepolia, arbitrum_one, base_sepolia, base, hyperevm_testnet, hyperevm. The stablecoins allowlisted for that
# chain come from script/SettleTokens.sol (USDC everywhere, plus USDG on Arbitrum).
DEPLOYER_PRIVATE_KEY=0x… TREASURY_ADDRESS=0x… PROTOCOL_FEE_BPS=50 \
  forge script script/DeployBorneoCheckout.s.sol --rpc-url monad_testnet --broadcast

# Verify on Monad (Sourcify-backed explorers need no key)
forge verify-contract <address> src/BorneoCheckout.sol:BorneoCheckout \
  --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org \
  --constructor-args $(cast abi-encode "constructor(address,address,uint16,address[])" <owner> <treasury> 50 "[0x534b2f3A21130d7a60830c2Df862319e593943A3]")

# Verify (Blockscout, no key) or Arbiscan (ARBISCAN_API_KEY)
forge verify-contract <address> src/BorneoCheckout.sol:BorneoCheckout \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --verifier blockscout --verifier-url https://arbitrum-sepolia.blockscout.com/api/ \
  --constructor-args $(cast abi-encode "constructor(address,address,uint16,address[])" <owner> <treasury> 50 "[<usdc>,<usdg>]")
```

Then set `CHECKOUT_ADDRESS_<chainId>` in the app's `.env` (for example `CHECKOUT_ADDRESS_10143` for Monad Testnet) and run `npm run chains:check` from the repo root.

Each order nonce commits to `block.chainid` and the checkout's own address, so an authorization signed for one chain cannot be settled on another. `test_revert_authorizationSignedForAnotherChain` covers this.
