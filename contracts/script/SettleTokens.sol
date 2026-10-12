// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice ERC-3009 dollar stablecoins BorneoCheckout allowlists on each chain.
/// Addresses are the issuers' published deployments:
///   USDC  https://developers.circle.com/stablecoins/usdc-contract-addresses
///   USDG  https://docs.paxos.com/guides/stablecoin/usdg/mainnet (and /testnet)
/// Keep in sync with src/lib/chains.ts in the app.
library SettleTokens {
    error UnsupportedChain(uint256 chainId);

    function forChain(uint256 chainId) internal pure returns (address[] memory tokens) {
        // Arbitrum: USDC + USDG
        if (chainId == 421_614) {
            return _pair(0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d, 0xFFC95faa3d63Cde504a05B567C600B78C0b41892);
        }
        if (chainId == 42_161) {
            return _pair(0xaf88d065e77c8cC2239327C5EDb3A432268e5831, 0x004B506865409877C9fA29bfb1ebA929984B9bbC);
        }
        // Base: USDC
        if (chainId == 84_532) return _single(0x036CbD53842c5426634e7929541eC2318f3dCF7e);
        if (chainId == 8_453) return _single(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
        // HyperEVM: USDC
        if (chainId == 998) return _single(0x2B3370eE501B4a559b57D449569354196457D8Ab);
        if (chainId == 999) return _single(0xb88339CB7199b77E23DB6E890353E22632Ba630f);
        // Monad: USDC
        if (chainId == 10_143) return _single(0x534b2f3A21130d7a60830c2Df862319e593943A3);
        if (chainId == 143) return _single(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
        revert UnsupportedChain(chainId);
    }

    function _single(address token) private pure returns (address[] memory tokens) {
        tokens = new address[](1);
        tokens[0] = token;
    }

    function _pair(address a, address b) private pure returns (address[] memory tokens) {
        tokens = new address[](2);
        tokens[0] = a;
        tokens[1] = b;
    }
}
