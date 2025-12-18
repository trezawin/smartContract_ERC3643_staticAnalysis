// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @title CompositeIdentityRegistryStorage
/// @notice Simplified storage shim used for testing audit rules.
contract CompositeIdentityRegistryStorage {
    // 记录绑定到存储的身份注册表集合
    address[] private linkedRegistries;
    // 保存投资者与身份合约的映射
    mapping(address => address) private storedIdentities;

    event IdentityStored(address indexed investor, address indexed identity);
    event IdentityModified(address indexed investor, address indexed identity);
    event IdentityUnstored(address indexed investor, address indexed identity);
    event IdentityRegistryBound(address indexed registry);

    function addIdentityToStorage(address investor, address identityContract) external {
        storedIdentities[investor] = identityContract;
        emit IdentityStored(investor, identityContract);
    }

    // 为测试方便，同一地址的再次写入视为修改
    function modifyStoredIdentity(address investor, address identityContract) external {
        storedIdentities[investor] = identityContract;
        emit IdentityModified(investor, identityContract);
    }

    function removeIdentityFromStorage(address investor) external {
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
