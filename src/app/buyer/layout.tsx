import { BuyerAuthProvider } from "./_components/buyer-auth-provider";
import { BuyerShell } from "./_components/buyer-shell";
import { PasskeyWalletProvider } from "./_components/passkey-wallet-provider";

export default function BuyerLayout({ children }: { children: React.ReactNode }) {
  return (
    <PasskeyWalletProvider>
      <BuyerAuthProvider>
        <BuyerShell>{children}</BuyerShell>
      </BuyerAuthProvider>
    </PasskeyWalletProvider>
  );
}
