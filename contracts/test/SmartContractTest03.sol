// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @title Smart Contract TEST 03
/// @notice Covers ordering-side duties but leaves beneficiary reconciliation and forwarding unimplemented.
contract SmartContractTest03 {
    struct OrderingPayload {
        string originatorName;
        string originatorAccountReference;
        string recipientName;
        string recipientAccountReference;
        string originatorAddress;
        string originatorIdentifier;
        uint256 amountHkd;
    }

    mapping(bytes32 => OrderingPayload) private transferRecord;

    event TransferRecordSaved(bytes32 indexed transferId);

    function recordTransferRecord(bytes32 transferId, OrderingPayload calldata payload) external {
        require(bytes(payload.originatorName).length != 0, "originator name missing");
        require(bytes(payload.originatorAccountReference).length != 0, "originator ref missing");
        require(bytes(payload.recipientName).length != 0, "recipient name missing");
        require(bytes(payload.recipientAccountReference).length != 0, "recipient ref missing");
        if (payload.amountHkd >= 8_000) {
            require(bytes(payload.originatorAddress).length != 0, "address missing");
            require(bytes(payload.originatorIdentifier).length != 0, "identifier missing");
        }
        transferRecord[transferId] = payload;
        emit TransferRecordSaved(transferId);
    }

    /// @dev Ordering institution can export a full structure for transmission, but there is no verification on the beneficiary side.
    function transmitTransferPayloadToBeneficiary(bytes32 transferId) external view returns (OrderingPayload memory) {
        return transferRecord[transferId];
    }
}
