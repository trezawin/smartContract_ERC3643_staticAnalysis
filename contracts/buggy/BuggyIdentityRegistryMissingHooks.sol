// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title BuggyIdentityRegistryMissingHooks
 * @notice Mutated ERC-3643 identity registry used to violate multiple rule checks.
 *         It exposes only a minimal init routine and intentionally omits the
 *         helper/view functions normally present (identityRegistry(), updateIdentity,
 *         deleteIdentity, batch helpers, events, etc.).
 */
contract BuggyIdentityRegistryMissingHooks {
    address private _topicsRegistry;
    address private _issuersRegistry;
    address private _identityStorage;

    event IdentityRegistered(address indexed investor, address indexed identity, uint16 country);
    event IdentityUpdated(address indexed investor, address indexed identity, uint16 country);

    function init(
        address trustedIssuersRegistry,
        address claimTopicsRegistry,
        address identityRegistryStorage
    ) external {
        require(_topicsRegistry == address(0), "already init");
        _topicsRegistry = claimTopicsRegistry;
        _issuersRegistry = trustedIssuersRegistry;
        _identityStorage = identityRegistryStorage;
    }

    function identityStorage() external view returns (address) {
        return _identityStorage;
    }

    // Registry deliberately omits:
    // - identityRegistry()
    // - updateIdentity(...)
    // - deleteIdentity(...)
    // - batchRegisterIdentity(...)
    // - identity(address)
    // - isVerified(address)
    // - events IdentityRegistered / IdentityUpdated / IdentityRemoved (only the first two are declared)
}
