// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @title CompositeCompliance
/// @notice Modular compliance stub exposing the ERC-3643 interface surface.
contract CompositeCompliance {
    address private boundToken;
    address[] private modules;
    mapping(address => bool) private moduleActive;

    event ModuleAdded(address indexed module);
    event ModuleRemoved(address indexed module);
    event ModuleInteraction(bytes4 indexed selector, address indexed module);
    event TokenBound(address indexed token);
    event TokenUnbound(address indexed token);

    function bindToken(address token) external {
        boundToken = token;
        emit TokenBound(token);
    }

    function unbindToken(address token) external {
        if (boundToken == token) {
            boundToken = address(0);
            emit TokenUnbound(token);
        }
    }

    function getTokenBound() external view returns (address) {
        return boundToken;
    }

    function addModule(address module) external {
        if (!moduleActive[module]) {
            moduleActive[module] = true;
            modules.push(module);
            emit ModuleAdded(module);
        }
    }

    function removeModule(address module) external {
        if (moduleActive[module]) {
            moduleActive[module] = false;
            emit ModuleRemoved(module);
        }
    }

    function getModules() external view returns (address[] memory) {
        return modules;
    }

    function isModuleBound(address module) external view returns (bool) {
        return moduleActive[module];
    }

    function callModuleFunction(bytes calldata data, address module) external returns (bytes memory) {
        emit ModuleInteraction(
            data.length >= 4 ? bytes4(data[:4]) : bytes4(0),
            module
        );
        return data;
    }

    function canTransfer(address, address, uint256) external view returns (bool) {
        return true;
    }

    function transferred(address, address, uint256) external pure {
        // noop
    }
}
