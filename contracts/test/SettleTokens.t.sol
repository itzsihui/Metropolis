// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {SettleTokens} from "../script/SettleTokens.sol";

/// @dev Wrapper so reverts from the internal library surface as external calls.
contract SettleTokensHarness {
    function forChain(uint256 chainId) external pure returns (address[] memory) {
        return SettleTokens.forChain(chainId);
    }
}

contract SettleTokensTest is Test {
    SettleTokensHarness internal harness = new SettleTokensHarness();

    function _assertTokens(uint256 chainId, uint256 count) internal view {
        address[] memory tokens = harness.forChain(chainId);
        assertEq(tokens.length, count, "token count");
        for (uint256 i; i < tokens.length; ++i) {
            assertTrue(tokens[i] != address(0), "zero token");
            for (uint256 j; j < i; ++j) {
                assertTrue(tokens[i] != tokens[j], "duplicate token");
            }
        }
    }

    function test_arbitrum_allowsUsdcAndUsdg() public view {
        _assertTokens(421_614, 2);
        _assertTokens(42_161, 2);
    }

    function test_baseAndHyperEvm_allowUsdc() public view {
        _assertTokens(84_532, 1);
        _assertTokens(8_453, 1);
        _assertTokens(998, 1);
        _assertTokens(999, 1);
    }

    function test_arbitrumSepolia_matchesLiveDeployment() public view {
        address[] memory tokens = harness.forChain(421_614);
        assertEq(tokens[0], 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d);
        assertEq(tokens[1], 0xFFC95faa3d63Cde504a05B567C600B78C0b41892);
    }

    function test_revert_unsupportedChain() public {
        vm.expectRevert(abi.encodeWithSelector(SettleTokens.UnsupportedChain.selector, 31_337));
        harness.forChain(31_337);
        // Ethereum L1 is not a settlement chain.
        vm.expectRevert(abi.encodeWithSelector(SettleTokens.UnsupportedChain.selector, 1));
        harness.forChain(1);
    }
}
