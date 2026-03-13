// test/ZambiaAuthenticator.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {ZambiaAuthenticator} from "../src/ZambiaAuthenticator.sol";

contract ZambiaAuthenticatorTest is Test {

    ZambiaAuthenticator public auth;
    address owner = address(1);
    address manufacturer = address(2);
    address consumer = address(3);

    bytes32 batchId = keccak256("BATCH_001");
    bytes32 itemId  = keccak256("ITEM_001");

    function setUp() public {
        vm.prank(owner);
        auth = new ZambiaAuthenticator();
    }

    // ── Role Tests ──────────────────────────────────────────

    function test_OwnerCanAddManufacturer() public {
        vm.prank(owner);
        auth.addManufacturer(manufacturer);
        assertTrue(auth.verifiedManufacturers(manufacturer));
    }

    function test_NonOwnerCannotAddManufacturer() public {
        vm.prank(consumer);
        vm.expectRevert("Not owner");
        auth.addManufacturer(manufacturer);
    }

    // ── Registration Tests ───────────────────────────────────

    function test_ManufacturerCanRegisterBatch() public {
        vm.prank(owner);
        auth.addManufacturer(manufacturer);

        bytes32[] memory items = new bytes32[](1);
        items[0] = itemId;

        vm.prank(manufacturer);
        auth.registerBatch(
            batchId,
            items,
            "Zambian Maize Seed",
            "seed",
            block.timestamp + 365 days
        );

        ZambiaAuthenticator.Product memory p = auth.getProduct(itemId);
        assertEq(p.productName, "Zambian Maize Seed");
        assertEq(p.manufacturer, manufacturer);
    }

    function test_CannotRegisterSameItemTwice() public {
        vm.prank(owner);
        auth.addManufacturer(manufacturer);

        bytes32[] memory items = new bytes32[](1);
        items[0] = itemId;

        vm.prank(manufacturer);
        auth.registerBatch(batchId, items, "Seed A", "seed", block.timestamp + 365 days);

        vm.prank(manufacturer);
        vm.expectRevert("Item already registered");
        auth.registerBatch(batchId, items, "Seed A", "seed", block.timestamp + 365 days);
    }

    // ── Verification Tests ───────────────────────────────────

    function test_ConsumerCanVerifyProduct() public {
        _registerOneItem();

        vm.prank(consumer);
        (bool exists, bool isGenuine, bool flagged,,,, uint256 scanCount) 
            = auth.verifyProduct(itemId);

        assertTrue(exists);
        assertTrue(isGenuine);
        assertFalse(flagged);
        assertEq(scanCount, 1);
    }

    function test_ProductFlaggedAfter5Scans() public {
        _registerOneItem();

        // Scan 6 times
        for (uint256 i = 0; i < 6; i++) {
            vm.prank(consumer);
            auth.verifyProduct(itemId);
        }

        ZambiaAuthenticator.Product memory p = auth.getProduct(itemId);
        assertTrue(p.isPotentialClone);
    }

    function test_UnknownItemReturnsNotFound() public {
        vm.prank(consumer);
        (bool exists,,,,,,) = auth.verifyProduct(keccak256("FAKE_ITEM"));
        assertFalse(exists);
    }

    function test_ExpiryCheck() public {
        _registerOneItem();
        // Travel forward in time past expiry
        vm.warp(block.timestamp + 400 days);
        assertTrue(auth.isExpired(itemId));
    }

    // ── Helper ───────────────────────────────────────────────

    function _registerOneItem() internal {
        vm.prank(owner);
        auth.addManufacturer(manufacturer);

        bytes32[] memory items = new bytes32[](1);
        items[0] = itemId;

        vm.prank(manufacturer);
        auth.registerBatch(batchId, items, "Paracetamol 500mg", "pharmaceutical", block.timestamp + 365 days);
    }
}