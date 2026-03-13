// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

contract ZambiaAuthenticator {

    address public owner;

    // ─── Roles ───────────────────────────────────────────────
    mapping(address => bool) public verifiedManufacturers;

    // ─── Data Structures ─────────────────────────────────────
    struct Product {
        bytes32 batchId;
        address manufacturer;
        string productName;
        string category;       // "seed" | "pharmaceutical"
        uint256 manufacturedAt;
        uint256 expiryDate;
        uint256 scanCount;
        bool isActive;
        bool isPotentialClone;
    }

    // itemId => Product
    mapping(bytes32 => Product) public products;

    // batchId => list of itemIds in that batch
    mapping(bytes32 => bytes32[]) public batchItems;

    // ─── Events ──────────────────────────────────────────────
    event ManufacturerAdded(address indexed manufacturer);
    event BatchRegistered(bytes32 indexed batchId, address indexed manufacturer, uint256 itemCount);
    event ProductVerified(bytes32 indexed itemId, uint256 scanCount, bool flagged, uint256 timestamp);
    event CloneFlagged(bytes32 indexed itemId, uint256 timestamp);

    // ─── Modifiers ───────────────────────────────────────────
    modifier onlyOwner() {
    _onlyOwner();
    _;
}

function _onlyOwner() internal view {
    require(msg.sender == owner, "Not owner");
}

modifier onlyManufacturer() {
    _onlyManufacturer();
    _;
}

function _onlyManufacturer() internal view {
    require(verifiedManufacturers[msg.sender], "Not a verified manufacturer");
}
    

    constructor() {
        owner = msg.sender;
    }

    // ─── Admin Functions ─────────────────────────────────────

    function addManufacturer(address _manufacturer) external onlyOwner {
        verifiedManufacturers[_manufacturer] = true;
        emit ManufacturerAdded(_manufacturer);
    }

    function removeManufacturer(address _manufacturer) external onlyOwner {
        verifiedManufacturers[_manufacturer] = false;
    }

    // ─── Manufacturer Functions ───────────────────────────────

    /**
     * Register a batch of products.
     * _itemIds: array of unique hashes, one per physical item.
     * These hashes are generated off-chain (see QR Code section).
     */
    function registerBatch(
        bytes32 _batchId,
        bytes32[] calldata _itemIds,
        string calldata _productName,
        string calldata _category,
        uint256 _expiryDate
    ) external onlyManufacturer {
        require(_itemIds.length > 0, "No items provided");
        require(_itemIds.length <= 10000, "Batch too large");

        for (uint256 i = 0; i < _itemIds.length; i++) {
            bytes32 itemId = _itemIds[i];
            require(products[itemId].manufacturedAt == 0, "Item already registered");

            products[itemId] = Product({
                batchId: _batchId,
                manufacturer: msg.sender,
                productName: _productName,
                category: _category,
                manufacturedAt: block.timestamp,
                expiryDate: _expiryDate,
                scanCount: 0,
                isActive: true,
                isPotentialClone: false
            });

            batchItems[_batchId].push(itemId);
        }

        emit BatchRegistered(_batchId, msg.sender, _itemIds.length);
    }

    // ─── Consumer Verify Function ─────────────────────────────

    /**
     * Called when a consumer scans a QR code.
     * Returns product details and a status flag.
     */
    function verifyProduct(bytes32 _itemId)
        external
        returns (
            bool exists,
            bool isGenuine,
            bool flagged,
            string memory productName,
            string memory category,
            uint256 expiryDate,
            uint256 scanCount
        )
    {
        Product storage p = products[_itemId];

        // Item not found on chain
        if (p.manufacturedAt == 0) {
            return (false, false, false, "", "", 0, 0);
        }

        p.scanCount += 1;

        // Flag as potential clone after 5 scans
        if (p.scanCount > 5 && !p.isPotentialClone) {
            p.isPotentialClone = true;
            emit CloneFlagged(_itemId, block.timestamp);
        }

        emit ProductVerified(_itemId, p.scanCount, p.isPotentialClone, block.timestamp);

        return (
            true,
            p.isActive && !p.isPotentialClone,
            p.isPotentialClone,
            p.productName,
            p.category,
            p.expiryDate,
            p.scanCount
        );
    }

    // ─── Read-Only Helpers ────────────────────────────────────

    function getProduct(bytes32 _itemId) external view returns (Product memory) {
        return products[_itemId];
    }

    function getBatchItems(bytes32 _batchId) external view returns (bytes32[] memory) {
        return batchItems[_batchId];
    }

    function isExpired(bytes32 _itemId) external view returns (bool) {
        return block.timestamp > products[_itemId].expiryDate;
    }
}