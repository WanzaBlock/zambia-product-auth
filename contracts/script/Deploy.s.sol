// script/Deploy.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console} from "forge-std/Script.sol";
import {ZambiaAuthenticator} from "../src/ZambiaAuthenticator.sol";

contract DeployScript is Script {
    function run() external {
        vm.startBroadcast();

        ZambiaAuthenticator auth = new ZambiaAuthenticator();

        vm.stopBroadcast();

        console.log("ZambiaAuthenticator deployed at:", address(auth));
    }
}