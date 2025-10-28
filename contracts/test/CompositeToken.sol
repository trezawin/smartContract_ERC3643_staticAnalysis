// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @title CompositeToken
/// @notice Simplified ERC-3643 style token exposing freeze and compliance hooks.
contract CompositeToken {
    address private _identityRegistry;
    address private _compliance;

    mapping(address => bool) private frozen;
    mapping(address => uint256) private partiallyFrozen;

    event IdentityRegistryAdded(address indexed identityRegistry);
    event ComplianceAdded(address indexed compliance);
    event AddressFrozen(address indexed investor);
    event TokensFrozen(address indexed investor, uint256 amount);
    event TokensUnfrozen(address indexed investor, uint256 amount);
    event Transfer(address indexed from, address indexed to, uint256 amount);

    constructor(address identityRegistry_, address compliance_) {
        _identityRegistry = identityRegistry_;
        _compliance = compliance_;
        emit IdentityRegistryAdded(identityRegistry_);
        emit ComplianceAdded(compliance_);
    }

    function identityRegistry() external view returns (address) {
        return _identityRegistry;
    }

    function compliance() external view returns (address) {
        return _compliance;
    }

    function setIdentityRegistry(address newRegistry) external {
        _identityRegistry = newRegistry;
        emit IdentityRegistryAdded(newRegistry);
    }

    function setCompliance(address newCompliance) external {
        _compliance = newCompliance;
        emit ComplianceAdded(newCompliance);
    }

    function setAddressFrozen(address investor, bool freeze) external {
        frozen[investor] = freeze;
        if (freeze) emit AddressFrozen(investor);
    }

    function isFrozen(address investor) external view returns (bool) {
        return frozen[investor];
    }

    function freezePartialTokens(address investor, uint256 amount) external {
        partiallyFrozen[investor] += amount;
        emit TokensFrozen(investor, amount);
    }

    function unfreezePartialTokens(address investor, uint256 amount) external {
        if (partiallyFrozen[investor] >= amount) {
            partiallyFrozen[investor] -= amount;
        } else {
            partiallyFrozen[investor] = 0;
        }
        emit TokensUnfrozen(investor, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(!frozen[msg.sender], "address frozen");
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}
