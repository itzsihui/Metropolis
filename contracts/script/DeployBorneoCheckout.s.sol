// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {BorneoCheckout} from "../src/BorneoCheckout.sol";
import {SettleTokens} from "./SettleTokens.sol";

/// @notice forge script script/DeployBorneoCheckout.s.sol --rpc-url <chain> --broadcast
/// `<chain>` is any alias under [rpc_endpoints] in foundry.toml (arbitrum_sepolia,
/// base_sepolia, hyperevm_testnet, and their mainnets arbitrum_one, base, hyperevm).
/// The stablecoins allowlisted at deploy time come from SettleTokens for that chain.
/// Env: DEPLOYER_PRIVATE_KEY, optional TREASURY_ADDRESS, PROTOCOL_FEE_BPS.
contract DeployBorneoCheckout is Script {
    function run() external returns (BorneoCheckout checkout) {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(key);
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);
        if (uint160(treasury) < 0x100) treasury = deployer;
        uint16 feeBps = uint16(vm.envOr("PROTOCOL_FEE_BPS", uint256(50)));

        address[] memory tokens = SettleTokens.forChain(block.chainid);

        vm.startBroadcast(key);
        checkout = new BorneoCheckout(deployer, treasury, feeBps, tokens);
        vm.stopBroadcast();

        console2.log("chainId", block.chainid);
        console2.log("BorneoCheckout", address(checkout));
        console2.log("owner", deployer);
        console2.log("treasury", treasury);
        console2.log("feeBps", feeBps);
    }
}
