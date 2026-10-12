import Link from "next/link";
import { notFound } from "next/navigation";
import { erc20Abi, formatEther, formatUnits, isHash, parseEventLogs } from "viem";
import { ExplorerShell, Row, chainFromParam } from "../../shared";

export default async function ExplorerTxPage({
  params,
}: {
  params: Promise<{ chainId: string; hash: string }>;
}) {
  const { chainId, hash } = await params;
  if (!isHash(hash)) notFound();
  const { chain, client } = chainFromParam(chainId);

  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash }).catch(() => null),
    client.getTransactionReceipt({ hash }).catch(() => null),
  ]);
  if (!tx) {
    return (
      <ExplorerShell title="Transaction not found" subtitle={chain.label}>
        <Row label="Hash">{hash}</Row>
      </ExplorerShell>
    );
  }

  const block = receipt
    ? await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null)
    : null;
  const transfers = receipt
    ? parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs })
    : [];
  const addressLink = (address: string) => (
    <Link
      href={`/explorer/${chain.chainId}/address/${address}`}
      className="text-primary underline-offset-4 hover:underline"
    >
      {address}
    </Link>
  );
  const tokenSymbol = (token: string) =>
    token.toLowerCase() === chain.tokenAddress.toLowerCase()
      ? chain.tokenSymbol
      : token;

  return (
    <ExplorerShell title="Transaction" subtitle={chain.label}>
      <Row label="Hash">{hash}</Row>
      <Row label="Status">
        {receipt ? (receipt.status === "success" ? "Success" : "Reverted") : "Pending"}
      </Row>
      {receipt ? <Row label="Block">{receipt.blockNumber.toString()}</Row> : null}
      {block ? (
        <Row label="Time">
          {new Date(Number(block.timestamp) * 1000).toISOString()}
        </Row>
      ) : null}
      <Row label="From">{addressLink(tx.from)}</Row>
      <Row label="To">
        {tx.to
          ? addressLink(tx.to)
          : receipt?.contractAddress
            ? <>Contract created: {addressLink(receipt.contractAddress)}</>
            : "—"}
      </Row>
      <Row label="Value">
        {formatEther(tx.value)} {chain.nativeSymbol}
      </Row>
      {receipt ? (
        <Row label="Gas used">
          {receipt.gasUsed.toString()} (fee{" "}
          {formatEther(receipt.gasUsed * receipt.effectiveGasPrice)} {chain.nativeSymbol})
        </Row>
      ) : null}
      {transfers.map((t, i) => (
        <Row key={i} label={`Token transfer ${i + 1}`}>
          {formatUnits(t.args.value, 6)} {tokenSymbol(t.address)}
          <br />
          from {addressLink(t.args.from)}
          <br />
          to {addressLink(t.args.to)}
        </Row>
      ))}
    </ExplorerShell>
  );
}
