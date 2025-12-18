// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title BuggyIdentityRegistryNoUpdate
 * @notice Identity registry mutation that omits the `updateIdentity` function.
 *         It keeps skeletons for other read paths so only the
 *         `hasabifn(idr.updateIdentity(address,address,uint16[]))` check fails,
 *         matching the mutation strategy for rule `R-HKMA-53ZRH-REGISTER`.
 */
contract BuggyIdentityRegistryNoUpdate {
    address private _topicsRegistry;
    address private _issuersRegistry;
    address private _identityStorage;

    mapping(address => address) private _identities;
    mapping(address => uint16) private _countries;

    event IdentityStored(address indexed investor, address indexed identity);

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

    function topicsRegistry() external view returns (address) {
        return _topicsRegistry;
    }

    function issuersRegistry() external view returns (address) {
        return _issuersRegistry;
    }

    function identityStorage() external view returns (address) {
        return _identityStorage;
    }

    function registerIdentity(address investor, address identity, uint16 country) external {
        _identities[investor] = identity;
        _countries[investor] = country;
        emit IdentityStored(investor, identity);
    }

    function isVerified(address investor) external view returns (bool) {
        return _identities[investor] != address(0);
    }

    function identity(address investor) external view returns (address) {
        return _identities[investor];
    }

    function investorCountry(address investor) external view returns (uint16) {
        return _countries[investor];
    }

    // NOTE: The production contract exposes updateIdentity(...) to modify an
    // existing record. This mutation intentionally omits it so the rule fails.
}
