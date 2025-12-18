// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @title CompositeTestSuite
/// @notice 将测试所需的 ERC-3643 相关合约集中于单一文件，便于一次性部署与审计。

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
    // 刻意缺失 TokensUnfrozen 事件，制造部分冻结审计缺陷
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
        // 缺少 TokensUnfrozen 事件以突出流程风控缺陷
    }

    // 不做余额检查的简化转账，用于触发规则引擎
    function transfer(address to, uint256 amount) external returns (bool) {
        require(!frozen[msg.sender], "address frozen");
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}

/// @title CompositeIdentityRegistry
/// @notice Minimal identity registry used for testing the rule engine. Intentionally omits ERC-3643's `registerIdentity`
///         interface so that compliance rules depending on it will fail.
contract CompositeIdentityRegistry {
    // 关联的身份存储合约地址
    address public identityStorageAddress;
    // 关联的主题注册表地址
    address public topicsRegistryAddress;
    // 关联的可信发行人注册表地址
    address public issuersRegistryAddress;

    // 保存投资者对应的身份合约
    mapping(address => address) private identities;
    // 标记投资者是否已被验证
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
        // 故意忽略传入的存储地址，让审计检测到未绑定情形
        identityStorageAddress = address(0);
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
    /// @dev enrollIdentity 被故意设计为不兼容接口，方便测试规则的失败路径。
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

    // 手动删除身份记录，模拟注销流程
    function deleteIdentity(address investor) external {
        address previous = identities[investor];
        delete identities[investor];
        verified[investor] = false;
        emit IdentityRemoved(investor, previous);
    }

    // 测试场景下可重新绑定存储合约
    function setIdentityStorage(address storageAddr) external {
        identityStorageAddress = storageAddr;
        emit IdentityStorageSet(storageAddr);
        emit IdentityRegistryBound(storageAddr);
    }

    // 同步主题注册表
    function setTopicsRegistry(address registry) external {
        topicsRegistryAddress = registry;
        emit TopicsRegistrySet(registry);
    }

    // 同步可信发行人注册表
    function setTrustedIssuersRegistry(address registry) external {
        issuersRegistryAddress = registry;
        emit TrustedIssuersRegistrySet(registry);
    }
}

/// @title CompositeIdentityRegistryStorage
/// @notice Simplified storage shim used for testing audit rules.
contract CompositeIdentityRegistryStorage {
    // 记录绑定到存储的身份注册表集合
    address[] private linkedRegistries;
    // 保存投资者与身份合约的映射
    mapping(address => address) private storedIdentities;

    event IdentityStored(address indexed investor, address indexed identity);
    // 刻意省略 IdentityModified 事件，模拟记录更新缺口
    event IdentityUnstored(address indexed investor, address indexed identity);
    event IdentityRegistryBound(address indexed registry);

    function addIdentityToStorage(address investor, address identityContract) external {
        storedIdentities[investor] = identityContract;
        emit IdentityStored(investor, identityContract);
    }

    // 为测试方便，同一地址的再次写入视为修改
    function modifyStoredIdentity(address investor, address identityContract) external {
        storedIdentities[investor] = identityContract;
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

/// @title CompositeClaimTopicsRegistry
/// @notice Minimal implementation that exposes the ERC-3643 Claim Topics interface.
contract CompositeClaimTopicsRegistry {
    // 存储所有已经登记的主题 ID
    uint256[] private topics;
    // 辅助快速判断主题是否存在
    mapping(uint256 => bool) private exists;

    event ClaimTopicAdded(uint256 indexed topic);
    // 缺少 ClaimTopicRemoved 事件以触发规则不通过

    function addClaimTopic(uint256 topic) external {
        if (exists[topic]) return;
        exists[topic] = true;
        topics.push(topic);
        emit ClaimTopicAdded(topic);
    }

    function removeClaimTopic(uint256 topic) external {
        if (!exists[topic]) return;
        exists[topic] = false;
        // array compaction omitted for brevity
    }

    function getClaimTopics() external view returns (uint256[] memory) {
        return topics;
    }
}

/// @title CompositeTrustedIssuersRegistry
/// @notice Simplified trusted issuer governance contract for testing.
contract CompositeTrustedIssuersRegistry {
    struct IssuerInfo {
        bool active;
        uint256[] topics;
    }

    // 保存添加顺序，便于遍历
    address[] private issuerList;
    // issuer 到其状态/主题的映射
    mapping(address => IssuerInfo) private issuers;

    event TrustedIssuerAdded(address indexed issuer, uint256[] topics);
    event TrustedIssuerRemoved(address indexed issuer);
    event ClaimTopicsUpdated(address indexed issuer, uint256[] topics);

    function addTrustedIssuer(address issuer, uint256[] calldata topics) external {
        if (!issuers[issuer].active) issuerList.push(issuer);
        issuers[issuer].active = true;
        issuers[issuer].topics = topics;
        emit TrustedIssuerAdded(issuer, topics);
    }

    function removeTrustedIssuer(address issuer) external {
        issuers[issuer].active = false;
        emit TrustedIssuerRemoved(issuer);
    }

    function updateIssuerClaimTopics(address issuer, uint256[] calldata topics) external {
        issuers[issuer].topics = topics;
        emit ClaimTopicsUpdated(issuer, topics);
    }

    function getTrustedIssuers() external view returns (address[] memory) {
        return issuerList;
    }

    function isTrustedIssuer(address issuer) external view returns (bool) {
        return issuers[issuer].active;
    }

    function getTrustedIssuerClaimTopics(address issuer) external view returns (uint256[] memory) {
        return issuers[issuer].topics;
    }
}

/// @title CompositeCompliance
/// @notice Modular compliance stub exposing the ERC-3643 interface surface.
contract CompositeCompliance {
    // 被绑定的可转代币地址
    address private boundToken;
    // 已登记的合规模块列表
    address[] private modules;
    // 模块激活状态缓存
    mapping(address => bool) private moduleActive;

    event ModuleAdded(address indexed module);
    // 刻意不公开 ModuleRemoved 事件
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
        }
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

    // canTransfer 恒返回 true，用于验证规则是否检测到宽松实现
    function canTransfer(address, address, uint256) external view returns (bool) {
        return true;
    }

    function transferred(address, address, uint256) external pure {
        // 空操作，占位实现接口
    }
}
