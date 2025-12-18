// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title BuggyIdentityRegistryBatchWrongSignature
 * @notice Mutation for R-HKMA-53ZRH-REGISTER where the batch registration
 *         helper exists but exposes the wrong signature. The detector looks
 *         for `batchRegisterIdentity(address[],address[],uint16[])`; this
 *         contract only exposes a two-parameter variant to trigger the failure.
 */
contract BuggyIdentityRegistryBatchWrongSignature {
    address private _topicsRegistry;
    address private _issuersRegistry;
    address private _identityStorage;

    mapping(address => address) private _identities;
    mapping(address => uint16) private _countries;

    event IdentityRegistered(address indexed investor, address indexed identity, uint16 country);

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
    }

    function batchRegisterIdentity(address[] calldata investors, address[] calldata identities) external {
        require(investors.length == identities.length, "length mismatch");
        for (uint256 i = 0; i < investors.length; i++) {
            _identities[investors[i]] = identities[i];
            emit IdentityRegistered(investors[i], identities[i], 0);
        }
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

    function topicsRegistry() external view returns (address) {
        return _topicsRegistry;
    }

    function issuersRegistry() external view returns (address) {
        return _issuersRegistry;
    }

    function identityStorage() external view returns (address) {
        return _identityStorage;
    }
}
