// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title BuggyClaimTopicsRegistryMinimal
 * @notice Minimal mutation that omits add/remove/get functions and events so
 *         rule checks for licence condition management fail.
 */
contract BuggyClaimTopicsRegistryMinimal {
    address private _owner;

    function init() external {
        require(_owner == address(0), "already init");
        _owner = msg.sender;
    }

    function owner() external view returns (address) {
        return _owner;
    }

    // The contract intentionally omits:
    // - addClaimTopic(uint256)
    // - removeClaimTopic(uint256)
    // - getClaimTopics()
    // - ClaimTopicAdded / ClaimTopicRemoved events
}
