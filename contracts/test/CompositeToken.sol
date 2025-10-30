// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @title CompositeToken
/// @notice Simplified ERC-3643 style token exposing freeze and compliance hooks.
contract CompositeToken {
    // 引用身份注册表，模拟链上 KYC 网关
    address private _identityRegistry;
    // 引用合规模块，便于触发对接检查
    address private _compliance;

    // 是否完全冻结某地址
    mapping(address => bool) private frozen;
    // 记录每个地址被部分冻结的额度
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

    // 允许外部替换身份注册表，方便测试不同情形
    function setIdentityRegistry(address newRegistry) external {
        _identityRegistry = newRegistry;
        emit IdentityRegistryAdded(newRegistry);
    }

    // 同理可替换合规模块
    function setCompliance(address newCompliance) external {
        _compliance = newCompliance;
        emit ComplianceAdded(newCompliance);
    }

    // 简化冻结逻辑：只记录状态并发事件
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

    // 解冻不足时直接清零，突出风控漏洞供规则检测
    function unfreezePartialTokens(address investor, uint256 amount) external {
        if (partiallyFrozen[investor] >= amount) {
            partiallyFrozen[investor] -= amount;
        } else {
            partiallyFrozen[investor] = 0;
        }
        emit TokensUnfrozen(investor, amount);
    }

    // 不做余额检查的简化转账，用于触发规则引擎
    function transfer(address to, uint256 amount) external returns (bool) {
        require(!frozen[msg.sender], "address frozen");
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}
