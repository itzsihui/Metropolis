import { notFound } from "next/navigation";
import { erc20Abi, formatEther, formatUnits, getAddress, isAddress } from "viem";
import { ExplorerShell, Row, chainFromParam } from "../../shared";

export default async function ExplorerAddressPage({
  params,
}: {
  params: Promise<{ chainId: string; address: string }>;
}) {
  const { chainId, address: raw } = await params;
  if (!isAddress(raw, { strict: false })) notFound();
  const address = getAddress(raw);
  const { chain, client } = chainFromParam(chainId);
  const token = chain.tokenAddress as `0x${string}`;

  const [balance, code, nonce, tokenBalance] = await Promise.all([
    client.getBalance({ address }).catch(() => null),
    client.getCode({ address }).catch(() => undefined),
    client.getTransactionCount({ address }).catch(() => null),
    client
      .readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] })
      .catch(() => null),
  ]);
  const isContract = !!code && code !== "0x";
  const isCheckout =
    !!chain.checkoutAddress &&
    chain.checkoutAddress.toLowerCase() === address.toLowerCase();

  return (
    <ExplorerShell
      title={isCheckout ? "BorneoCheckout" : isContract ? "Contract" : "Address"}
      subtitle={chain.label}
    >
      <Row label="Address">{address}</Row>
      <Row label="Type">
        {isContract ? `Contract (${(code!.length - 2) / 2} bytes)` : "Account"}
      </Row>
      {balance !== null ? (
        <Row label="Balance">
          {formatEther(balance)} {chain.nativeSymbol}
        </Row>
      ) : null}
      {tokenBalance !== null ? (
        <Row label={`${chain.tokenSymbol} balance`}>
          {formatUnits(tokenBalance, 6)} {chain.tokenSymbol}
        </Row>
      ) : null}
      {!isContract && nonce !== null ? (
        <Row label="Transactions sent">{nonce}</Row>
      ) : null}
    </ExplorerShell>
  );
}
