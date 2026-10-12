/**
 * Offline tests for multi-chain settlement. No RPC and no server needed:
 *   npm test
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { domainSeparator, getAddress, isAddress, verifyTypedData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Config reads the environment once at import, so set it first.
const CHECKOUT_ARB = "0xf8188490C10d0248DBB27bD1A07F8a7b4f0e9fc4";
const CHECKOUT_BASE = "0x00000000000000000000000000000000000B0A5E";
process.env.CHAIN_NETWORK = "eip155:421614";
process.env.SETTLE_NETWORKS = "base-sepolia, 998, eip155:421614, ethereum, nope";
process.env.CHECKOUT_ADDRESS = CHECKOUT_ARB;
process.env.CHECKOUT_ADDRESS_84532 = CHECKOUT_BASE;
process.env.RPC_URL_84532 = "http://127.0.0.1:1";
delete process.env.BUYER_NETWORK;

const { CHAINS, listChains, normalizeNetwork } = await import("../src/lib/chains.ts");
const { chainSettings, config, eip712DomainFor, explorerTx, settleAssetFor, settleChainsLabel } =
  await import("../src/lib/config.ts");
const { matchDomain } = await import("../src/lib/protocol/token-domain.ts");
const { checkoutOrderKey, checkoutOrderNonce, createPaymentPayload, selectRequirement } =
  await import("../src/lib/protocol/x402-evm.ts");
type PaymentRequired = import("../src/lib/protocol/x402-evm.ts").PaymentRequired;
type PaymentRequirements = import("../src/lib/protocol/x402-evm.ts").PaymentRequirements;

const MERCHANT = "0x1111111111111111111111111111111111111111";

test("every preset is internally consistent", () => {
  const chains = listChains();
  assert.equal(chains.length, 8);
  assert.equal(new Set(chains.map((c) => c.network)).size, chains.length);
  for (const chain of chains) {
    assert.equal(chain.network, `eip155:${chain.viemChain.id}`);
    assert.equal(chain.chainId, chain.viemChain.id);
    assert.equal(chain.testnet, Boolean(chain.viemChain.testnet), chain.label);
    assert.ok(chain.rpcUrl.startsWith("https://"), chain.label);
    assert.ok(
      chain.explorerBase.startsWith("https://") ||
        chain.explorerBase === `/explorer/${chain.chainId}`,
      chain.label,
    );
    // getAddress throws on a bad checksum, so a typo in an address fails here.
    assert.equal(getAddress(chain.token), chain.token, `${chain.label} token checksum`);
    if (chain.usdg) assert.equal(getAddress(chain.usdg), chain.usdg, `${chain.label} USDG checksum`);
    assert.ok(chain.tokenEip712Name && chain.tokenEip712Version, chain.label);
  }
});

test("each ecosystem has a testnet and a mainnet", () => {
  for (const family of ["monad", "arbitrum", "base", "hyperliquid"]) {
    const members = listChains().filter((c) => c.family === family);
    assert.equal(members.length, 2, family);
    assert.equal(members.filter((c) => c.testnet).length, 1, family);
  }
});

test("normalizeNetwork accepts CAIP-2 ids, chain ids and labels", () => {
  assert.equal(normalizeNetwork("eip155:8453"), "eip155:8453");
  assert.equal(normalizeNetwork("8453"), "eip155:8453");
  assert.equal(normalizeNetwork(" Base Sepolia "), "eip155:84532");
  assert.equal(normalizeNetwork("hyperevm-testnet"), "eip155:998");
  assert.equal(normalizeNetwork("hyper_evm"), "eip155:999");
  assert.equal(normalizeNetwork("arbitrum one"), "eip155:42161");
  assert.equal(normalizeNetwork("monad-testnet"), "eip155:10143");
  assert.equal(normalizeNetwork("10143"), "eip155:10143");
  assert.equal(normalizeNetwork("monad"), "eip155:143");
  assert.equal(normalizeNetwork("eip155:1"), null);
  assert.equal(normalizeNetwork("eip155:4663"), null);
  assert.equal(normalizeNetwork("solana"), null);
  assert.equal(normalizeNetwork(""), null);
});

test("SETTLE_NETWORKS keeps the primary chain first and drops unknowns and duplicates", () => {
  assert.deepEqual(config.settleNetworks, [
    "eip155:421614",
    "eip155:84532",
    "eip155:998",
  ]);
  assert.equal(settleChainsLabel(), "Arbitrum Sepolia, Base Sepolia and 1 more");
});

test("per-chain settings take suffixed overrides; the primary keeps legacy ones", () => {
  assert.equal(chainSettings().checkoutAddress, CHECKOUT_ARB);
  const baseSepolia = chainSettings("eip155:84532");
  assert.equal(baseSepolia.checkoutAddress, CHECKOUT_BASE);
  assert.equal(baseSepolia.rpcUrl, "http://127.0.0.1:1");
  assert.equal(baseSepolia.tokenSymbol, "USDC");
  assert.equal(chainSettings("eip155:998").checkoutAddress, "");
  assert.equal(chainSettings("eip155:998").nativeSymbol, "HYPE");
  assert.throws(() => chainSettings("eip155:1"), /Unsupported network/);
});

test("explorer links follow the chain an order settled on", () => {
  assert.equal(explorerTx("0xabc"), "https://sepolia.arbiscan.io/tx/0xabc");
  assert.equal(explorerTx("0xabc", "eip155:84532"), "https://sepolia.basescan.org/tx/0xabc");
  assert.equal(explorerTx("0xabc", "eip155:999"), "https://hyperevmscan.io/tx/0xabc");
});

test("a default-priced SKU settles in each chain's own stablecoin", () => {
  assert.deepEqual(settleAssetFor("eip155:421614", {}), {
    asset: CHAINS["eip155:421614"].token,
    symbol: "USDC",
  });
  // Stored SKUs carry the primary chain's USDC address; it must still map.
  const stored = { settleAsset: CHAINS["eip155:421614"].token, settleSymbol: "USDC" };
  assert.deepEqual(settleAssetFor("eip155:84532", stored), {
    asset: CHAINS["eip155:84532"].token,
    symbol: "USDC",
  });
  assert.deepEqual(settleAssetFor("eip155:998", stored), {
    asset: CHAINS["eip155:998"].token,
    symbol: "USDC",
  });
});

test("a USDG SKU only appears on chains where USDG exists", () => {
  const usdgSku = { settleAsset: CHAINS["eip155:421614"].usdg, settleSymbol: "USDG" };
  assert.equal(settleAssetFor("eip155:421614", usdgSku)?.asset, CHAINS["eip155:421614"].usdg);
  assert.equal(settleAssetFor("eip155:84532", usdgSku), null);
  assert.equal(settleAssetFor("eip155:998", usdgSku), null);
  const custom = { settleAsset: "0x2222222222222222222222222222222222222222", settleSymbol: "XYZ" };
  assert.equal(settleAssetFor("eip155:421614", custom)?.asset, custom.settleAsset);
  assert.equal(settleAssetFor("eip155:84532", custom), null);
});

test("preset EIP-712 domains are per chain", () => {
  assert.deepEqual(eip712DomainFor(CHAINS["eip155:8453"].token, "USDC", "eip155:8453"), {
    name: "USD Coin",
    version: "2",
  });
  assert.deepEqual(eip712DomainFor(CHAINS["eip155:84532"].token, "USDC", "eip155:84532"), {
    name: "USDC",
    version: "2",
  });
  assert.deepEqual(eip712DomainFor(CHAINS["eip155:42161"].usdg, "USDG", "eip155:42161"), {
    name: "Global Dollar",
    version: "1",
  });
});

test("matchDomain keeps only the candidate the token actually hashes", () => {
  const asset = CHAINS["eip155:998"].token;
  const real = { name: "USDC", version: "2" };
  const onchain = domainSeparator({
    domain: { ...real, chainId: 998, verifyingContract: getAddress(asset) },
  });
  const wrong = { name: "USD Coin", version: "2" };
  assert.deepEqual(matchDomain([wrong, real], onchain, 998, asset), real);
  assert.equal(matchDomain([wrong], onchain, 998, asset), null);
  // Same strings on another chain id hash differently.
  assert.equal(matchDomain([real], onchain, 999, asset), null);
  assert.equal(matchDomain([real], null, 998, asset), null);
});

function requirement(network: string, checkout?: string): PaymentRequirements {
  const chain = chainSettings(network);
  const orderKey = checkoutOrderKey("order-1");
  const amount = "20000";
  return {
    scheme: "exact",
    network,
    amount,
    asset: chain.tokenAddress,
    payTo: checkout || MERCHANT,
    maxTimeoutSeconds: 300,
    extra: {
      ...eip712DomainFor(chain.tokenAddress, chain.tokenSymbol, network),
      ...(checkout
        ? {
            primaryType: "ReceiveWithAuthorization" as const,
            checkout,
            merchant: MERCHANT,
            orderKey,
            nonce: checkoutOrderNonce({
              chainId: chain.chainId,
              checkout,
              orderKey,
              merchant: MERCHANT,
              token: chain.tokenAddress,
              amount,
            }),
          }
        : {}),
    },
  };
}

function challenge(...accepts: PaymentRequirements[]): PaymentRequired {
  return {
    x402Version: 2,
    resource: { url: "http://localhost/s/demo/buy", description: "demo x1", mimeType: "application/json" },
    accepts,
  };
}

test("selectRequirement picks the entry for the requested chain", () => {
  const c = challenge(requirement("eip155:421614"), requirement("eip155:84532"), requirement("eip155:998"));
  assert.equal(selectRequirement(c)?.network, "eip155:421614");
  assert.equal(selectRequirement(c, { network: "eip155:998" })?.network, "eip155:998");
  assert.equal(
    selectRequirement(c, { network: "eip155:84532", asset: CHAINS["eip155:84532"].token.toLowerCase() })?.network,
    "eip155:84532",
  );
  assert.equal(selectRequirement(c, { network: "eip155:1" }), undefined);
  assert.equal(selectRequirement(c, { network: "eip155:998", asset: MERCHANT }), undefined);
});

test("the order nonce binds chain, checkout, merchant, token and amount", () => {
  const base = {
    chainId: 421614,
    checkout: CHECKOUT_ARB,
    orderKey: checkoutOrderKey("order-1"),
    merchant: MERCHANT,
    token: CHAINS["eip155:421614"].token,
    amount: "20000",
  };
  const nonce = checkoutOrderNonce(base);
  assert.equal(checkoutOrderNonce(base), nonce);
  assert.notEqual(checkoutOrderNonce({ ...base, chainId: 84532 }), nonce);
  assert.notEqual(checkoutOrderNonce({ ...base, checkout: CHECKOUT_BASE }), nonce);
  assert.notEqual(checkoutOrderNonce({ ...base, merchant: CHECKOUT_BASE }), nonce);
  assert.notEqual(checkoutOrderNonce({ ...base, amount: "20001" }), nonce);
  assert.notEqual(checkoutOrderNonce({ ...base, orderKey: checkoutOrderKey("order-2") }), nonce);
});

test("a signature made for one chain does not verify on another", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const arb = requirement("eip155:421614", CHECKOUT_ARB);
  const base = requirement("eip155:84532", CHECKOUT_BASE);
  const payload = await createPaymentPayload(account, challenge(arb, base), base);

  assert.equal(payload.accepted.network, "eip155:84532");
  assert.equal(payload.payload.authorization.to, getAddress(CHECKOUT_BASE));
  assert.equal(payload.payload.authorization.nonce, base.extra?.nonce);
  assert.ok(isAddress(payload.payload.authorization.from));

  const types = {
    ReceiveWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  } as const;
  const auth = payload.payload.authorization;
  const message = {
    from: getAddress(auth.from),
    to: getAddress(auth.to),
    value: BigInt(auth.value),
    validAfter: BigInt(auth.validAfter),
    validBefore: BigInt(auth.validBefore),
    nonce: auth.nonce,
  };
  const verify = (req: PaymentRequirements) =>
    verifyTypedData({
      address: account.address,
      domain: {
        name: String(req.extra?.name),
        version: String(req.extra?.version),
        chainId: Number(req.network.split(":")[1]),
        verifyingContract: getAddress(req.asset),
      },
      types,
      primaryType: "ReceiveWithAuthorization",
      message,
      signature: payload.payload.signature,
    });
  assert.equal(await verify(base), true);
  assert.equal(await verify(arb), false);
});

test("a direct-pay requirement signs a TransferWithAuthorization to the merchant", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const hyper = requirement("eip155:998");
  const payload = await createPaymentPayload(account, challenge(hyper));
  assert.equal(payload.accepted.network, "eip155:998");
  assert.equal(payload.payload.authorization.to, getAddress(MERCHANT));
  assert.equal(payload.payload.authorization.value, "20000");
});
