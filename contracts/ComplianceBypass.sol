// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @notice Minimal compliance contract used to simulate a missing canTransfer hook.
///         - always returns true from canTransfer
///         - records modules to satisfy add/remove calls but never consults them
///         - keeps track of the bound token address
contract ComplianceBypass {
    address public tokenBound;
    address[] private _modules;

    event ModuleAdded(address indexed module);
    event ModuleRemoved(address indexed module);

    function init() external {}

    function bindToken(address token) external {
        tokenBound = token;
    }

    function unbindToken(address) external {
        tokenBound = address(0);
    }

    function canTransfer(address, address, uint256) external view returns (bool) {
        // Always allow transfers, ignoring module checks.
        return true;
    }

    function transferred(address, address, uint256) external {}
    function created(address, uint256) external {}
    function destroyed(address, uint256) external {}

    function addModule(address module_) external {
        _modules.push(module_);
        emit ModuleAdded(module_);
    }

    function removeModule(address module_) external {
        uint256 length = _modules.length;
        for (uint256 i = 0; i < length; ++i) {
            if (_modules[i] == module_) {
                _modules[i] = _modules[length - 1];
                _modules.pop();
                emit ModuleRemoved(module_);
                break;
            }
        }
    }

    function callModuleFunction(bytes calldata, address) external pure returns (bytes memory) {
        // Ignore module calls; return empty data.
        return "";
    }

    function getModules() external view returns (address[] memory) {
        return _modules;
    }

    function getTokenBound() external view returns (address) {
        return tokenBound;
    }

    function isModuleBound(address module_) external view returns (bool) {
        uint256 length = _modules.length;
        for (uint256 i = 0; i < length; ++i) {
            if (_modules[i] == module_) return true;
        }
        return false;
    }
}

