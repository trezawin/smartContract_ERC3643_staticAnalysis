// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

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
        identityStorageAddress = storageAddr;
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
