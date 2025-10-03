// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import "@tokenysolutions/t-rex/contracts/compliance/modular/IModularCompliance.sol";

/**
 * Minimal no-op compliance that satisfies the IModularCompliance interface for local tests.
 * It ALWAYS allows transfers.
 */
contract ComplianceStub is IModularCompliance {
    address private _token;

    function addModule(address) external override {}
    function removeModule(address) external override {}
    function bindToken(address token_) external override { _token = token_; }
    function unbindToken(address) external override { _token = address(0); }
    function created(address, uint256) external override {}
    function destroyed(address, uint256) external override {}
    function transferred(address, address, uint256) external override {}
    function canTransfer(address, address, uint256) external pure override returns (bool) { return true; }

    // The interface has some getters; implement the minimal ones we need.
    function getModules() external view override returns (address[] memory) {
        return new address[](0);
    }
    function getTokenBound() external view override returns (address) { return _token; }
    function isModuleBound(address) external pure override returns (bool) { return false; }

    // Unused hooks & helpers—no-op to satisfy the interface
    function callModuleFunction(bytes calldata, address) external override {}
}