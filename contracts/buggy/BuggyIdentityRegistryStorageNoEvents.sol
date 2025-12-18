// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title BuggyIdentityRegistryStorageNoEvents
 * @notice Minimal identity registry storage that omits the IdentityStored /
 *         IdentityModified / IdentityUnstored events expected by rules.
 */
contract BuggyIdentityRegistryStorageNoEvents {
    address private _owner;
    address private _identityRegistry;

    event IdentityStored(address indexed registry, address indexed investor);
    event IdentityModified(address indexed registry, address indexed investor);
    event IdentityUnstored(address indexed registry, address indexed investor);

    function init() external {
        require(_owner == address(0), "already init");
        _owner = msg.sender;
    }

    function owner() external view returns (address) {
        return _owner;
    }

    function bindIdentityRegistry(address registry) external {
        _identityRegistry = registry;
    }

    function linkedIdentityRegistries() external view returns (address[] memory) {
        address[] memory arr = new address[](1);
        arr[0] = _identityRegistry;
        return arr;
    }

    // Events exist in the ABI but are never emitted—detectors see the hook, runtime still inert.
}
