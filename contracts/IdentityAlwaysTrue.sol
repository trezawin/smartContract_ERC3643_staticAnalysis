// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @notice Minimal identity registry stub that reports everyone as verified.
contract IdentityAlwaysTrue {
    address public topicsRegistry;
    address public issuersRegistry;
    constructor(address _topicsRegistry, address _issuersRegistry) {
        topicsRegistry = _topicsRegistry;
        issuersRegistry = _issuersRegistry;
    }
    function isVerified(address) external pure returns (bool) { return true; }
}

