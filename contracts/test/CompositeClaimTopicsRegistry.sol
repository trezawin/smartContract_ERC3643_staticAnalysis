// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @title CompositeClaimTopicsRegistry
/// @notice Minimal implementation that exposes the ERC-3643 Claim Topics interface.
contract CompositeClaimTopicsRegistry {
    uint256[] private topics;
    mapping(uint256 => bool) private exists;

    event ClaimTopicAdded(uint256 indexed topic);
    event ClaimTopicRemoved(uint256 indexed topic);

    function addClaimTopic(uint256 topic) external {
        if (exists[topic]) return;
        exists[topic] = true;
        topics.push(topic);
        emit ClaimTopicAdded(topic);
    }

    function removeClaimTopic(uint256 topic) external {
        if (!exists[topic]) return;
        exists[topic] = false;
        emit ClaimTopicRemoved(topic);
        // array compaction omitted for brevity
    }

    function getClaimTopics() external view returns (uint256[] memory) {
        return topics;
    }
}
