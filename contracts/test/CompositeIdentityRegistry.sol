// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @title CompositeIdentityRegistry
/// @notice Minimal identity registry used for testing the rule engine. Intentionally omits ERC-3643's `registerIdentity`
///         interface so that compliance rules depending on it will fail.
contract CompositeIdentityRegistry {
    address public identityStorageAddress;
    address public topicsRegistryAddress;
    address public issuersRegistryAddress;

    mapping(address => address) private identities;
    mapping(address => bool) private verified;

    event IdentityRegistered(address indexed investor, address indexed identity);
    event IdentityUpdated(address indexed investor, address indexed identity);
    event IdentityRemoved(address indexed investor, address indexed identity);
    event IdentityStorageSet(address indexed newStorage);
    event IdentityRegistryBound(address indexed storageAddr);
    event TopicsRegistrySet(address indexed newRegistry);
    event TrustedIssuersRegistrySet(address indexed newRegistry);

    constructor(
        address storageAddr,
        address topicsAddr,
        address issuersAddr
    ) {
        identityStorageAddress = storageAddr;
        topicsRegistryAddress = topicsAddr;
        issuersRegistryAddress = issuersAddr;
        emit IdentityStorageSet(storageAddr);
        emit IdentityRegistryBound(storageAddr);
        emit TopicsRegistrySet(topicsAddr);
        emit TrustedIssuersRegistrySet(issuersAddr);
    }

    function identityStorage() external view returns (address) {
        return identityStorageAddress;
    }

    function topicsRegistry() external view returns (address) {
        return topicsRegistryAddress;
    }

    function issuersRegistry() external view returns (address) {
        return issuersRegistryAddress;
    }

    function identity(address investor) external view returns (address) {
        return identities[investor];
    }

    function isVerified(address investor) external view returns (bool) {
        return verified[investor];
    }

    /// @notice Deliberately non-standard onboarding primitive (missing the ERC-3643 signature).
    function enrollIdentity(
        address investor,
        address identityContract,
        uint16[] calldata /*countries*/
    ) external {
        identities[investor] = identityContract;
        verified[investor] = true;
        emit IdentityRegistered(investor, identityContract);
    }

    function updateIdentityManual(address investor, address identityContract) external {
        identities[investor] = identityContract;
        emit IdentityUpdated(investor, identityContract);
    }

    function deleteIdentity(address investor) external {
        address previous = identities[investor];
        delete identities[investor];
        verified[investor] = false;
        emit IdentityRemoved(investor, previous);
    }

    function setIdentityStorage(address storageAddr) external {
        identityStorageAddress = storageAddr;
        emit IdentityStorageSet(storageAddr);
        emit IdentityRegistryBound(storageAddr);
    }

    function setTopicsRegistry(address registry) external {
        topicsRegistryAddress = registry;
        emit TopicsRegistrySet(registry);
    }

    function setTrustedIssuersRegistry(address registry) external {
        issuersRegistryAddress = registry;
        emit TrustedIssuersRegistrySet(registry);
    }
}
