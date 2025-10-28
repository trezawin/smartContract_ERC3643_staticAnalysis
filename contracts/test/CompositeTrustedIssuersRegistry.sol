// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @title CompositeTrustedIssuersRegistry
/// @notice Simplified trusted issuer governance contract for testing.
contract CompositeTrustedIssuersRegistry {
    struct IssuerInfo {
        bool active;
        uint256[] topics;
    }

    address[] private issuerList;
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
