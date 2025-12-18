// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title BuggyModularComplianceMinimal
 * @notice Mutation that removes modular management methods and events so
 *         compliance-related rule checks fail.
 */
contract BuggyModularComplianceMinimal {
    address private _owner;
    address private _tokenBound;

    function init() external {
        require(_owner == address(0), "already init");
        _owner = msg.sender;
    }

    function owner() external view returns (address) {
        return _owner;
    }

    function getTokenBound() external view returns (address) {
        return _tokenBound;
    }

    // Intentionally missing:
    // - addModule / removeModule / getModules
    // - callModuleFunction / unbindToken
    // - ModuleAdded / ModuleRemoved / ModuleInteraction events
    // - canTransfer(...) helper
}
