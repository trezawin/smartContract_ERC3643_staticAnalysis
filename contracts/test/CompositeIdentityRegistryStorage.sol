// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @title CompositeIdentityRegistryStorage
/// @notice Simplified storage shim used for testing audit rules.
contract CompositeIdentityRegistryStorage {
    address[] private linkedRegistries;
    mapping(address => address) private storedIdentities;

    event IdentityStored(address indexed investor, address indexed identity);
    event IdentityModified(address indexed investor, address indexed identity);
    event IdentityUnstored(address indexed investor, address indexed identity);
    event IdentityRegistryBound(address indexed registry);

    function storeIdentity(address investor, address identityContract) external {
        storedIdentities[investor] = identityContract;
        emit IdentityStored(investor, identityContract);
    }

    function modifyIdentity(address investor, address identityContract) external {
        storedIdentities[investor] = identityContract;
        emit IdentityModified(investor, identityContract);
    }

    function unstoreIdentity(address investor) external {
        address previous = storedIdentities[investor];
        delete storedIdentities[investor];
        emit IdentityUnstored(investor, previous);
    }

    function bindIdentityRegistry(address registry) external {
        linkedRegistries.push(registry);
        emit IdentityRegistryBound(registry);
    }

    function linkedIdentityRegistries() external view returns (address[] memory) {
        return linkedRegistries;
    }

    function storedIdentity(address investor) external view returns (address) {
        return storedIdentities[investor];
    }
}
