// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @title Smart Contract TEST 02
/// @notice Omits enhanced KYC fields so that threshold controls fail while basic data is captured.
contract SmartContractTest02 {
    struct BasicTransferRecord {
        string originatorName;
        string originatorAccountReference;
        string recipientName;
        string recipientAccountReference;
        uint256 amountHkd;
    }

    struct MinimalPayload {
        bytes32 transferId;
        string originatorName;
        string originatorAccountReference;
        string recipientName;
        string recipientAccountReference;
    }

    mapping(bytes32 => BasicTransferRecord) private transferRecord;
    mapping(bytes32 => MinimalPayload) private payloads;
    mapping(bytes32 => bool) private integrity;

    event TransferRecordSaved(bytes32 indexed transferId);
    event TransmissionPayloadSent(bytes32 indexed transferId);
    event VirtualAssetTransferForwarded(bytes32 indexed transferId, address indexed intermediaryInstitution);

    /// @dev Records only the baseline fields; omits address/identifier/DOB/POB on purpose.
    function recordTransferRecord(bytes32 transferId, BasicTransferRecord calldata recordData) external {
        require(bytes(recordData.originatorName).length != 0, "originator name missing");
        require(bytes(recordData.originatorAccountReference).length != 0, "originator ref missing");
        require(bytes(recordData.recipientName).length != 0, "recipient name missing");
        require(bytes(recordData.recipientAccountReference).length != 0, "recipient ref missing");
        transferRecord[transferId] = recordData;
        emit TransferRecordSaved(transferId);
    }

    /// @dev Sends only the baseline payload subset.
    function transmitTransferPayloadToBeneficiary(bytes32 transferId, MinimalPayload calldata payload) external {
        require(payload.transferId == transferId, "payload mismatch");
        payloads[transferId] = payload;
        integrity[transferId] = true;
        emit TransmissionPayloadSent(transferId);
    }

    /// @dev Beneficiary can check basic integrity only (no address/identifier).
    function verifyPayloadIntegrity(bytes32 transferId) external view returns (bool) {
        return integrity[transferId];
    }

    /// @dev Intermediary simply forwards what it received.
    function forwardFullPayload(bytes32 transferId, address nextInstitution) external returns (MinimalPayload memory) {
        MinimalPayload memory stored = payloads[transferId];
        require(stored.transferId != bytes32(0), "payload missing");
        emit VirtualAssetTransferForwarded(transferId, nextInstitution);
        return stored;
    }
}
