// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title BuggyIdentityRegistryNoBatch
 * @notice Identity registry mutation used to trigger failures for rule
 *         R-HKMA-53ZRH-REGISTER where the `batchRegisterIdentity` helper is
 *         expected. The contract intentionally omits the batch registration
 *         function while keeping the rest of the registry surface relatively
 *         intact so detectors can isolate the missing method.
 */
contract BuggyIdentityRegistryNoBatch {
    address private _topicsRegistry;
    address private _issuersRegistry;
    address private _identityStorage;

    mapping(address => address) private _identities;
    mapping(address => uint16) private _countries;

    event IdentityRegistered(address indexed investor, address indexed identity, uint16 country);
    event IdentityRemoved(address indexed investor);

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
        emit IdentityRegistered(investor, identity, country);
    }

    function updateIdentity(address investor, address identity, uint16 country) external {
        require(_identities[investor] != address(0), "unknown investor");
        _identities[investor] = identity;
        _countries[investor] = country;
        emit IdentityRegistered(investor, identity, country);
    }

    function deleteIdentity(address investor) external {
        delete _identities[investor];
        delete _countries[investor];
        emit IdentityRemoved(investor);
    }

    function identity(address investor) external view returns (address) {
        return _identities[investor];
    }

    function investorCountry(address investor) external view returns (uint16) {
        return _countries[investor];
    }

    function isVerified(address investor) external view returns (bool) {
        return _identities[investor] != address(0);
    }

    // NOTE: A compliant registry exposes:
    // function batchRegisterIdentity(address[],address[],uint16[]) external;
    //
    // This mutation intentionally omits that helper so rule R-HKMA-53ZRH-REGISTER
    // flags the missing batch registration capability.
}
