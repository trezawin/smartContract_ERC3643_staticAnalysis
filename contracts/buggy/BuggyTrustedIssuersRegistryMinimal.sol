// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title BuggyTrustedIssuersRegistryMinimal
 * @notice Mutation of the trusted issuers registry that omits add/remove helpers
 *         and the events required by supervisory rules.
 */
contract BuggyTrustedIssuersRegistryMinimal {
    address private _owner;

    function init() external {
        require(_owner == address(0), "already init");
        _owner = msg.sender;
    }

    function owner() external view returns (address) {
        return _owner;
    }

    // Intentionally missing:
    // - addTrustedIssuer(address)
    // - removeTrustedIssuer(address)
    // - getTrustedIssuers()
    // - updateIssuerClaimTopics(...)
    // - TrustedIssuerAdded / TrustedIssuerRemoved events
    // - isTrustedIssuer(address)
}
