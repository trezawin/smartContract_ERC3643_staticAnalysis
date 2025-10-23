// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @title Smart Contract TEST 04
/// @notice Focuses on beneficiary logging but intentionally omits mitigation workflows.
contract SmartContractTest04 {
    struct BeneficiaryIntake {
        bytes32 transferId;
        string originatorName;
        string originatorAccountReference;
        string recipientName;
        string recipientAccountReference;
        string originatorAddress;
        string originatorIdentifier;
    }

    mapping(bytes32 => BeneficiaryIntake) private recordedPayloads;

    event BeneficiaryPayloadRecorded(bytes32 indexed transferId, address indexed beneficiaryInstitution);
    event VirtualAssetTransferForwarded(bytes32 indexed transferId, address indexed intermediaryInstitution);

    function beneficiaryRecordPayload(BeneficiaryIntake calldata intake) external {
        require(bytes(intake.originatorName).length != 0, "missing originator name");
        require(bytes(intake.originatorAccountReference).length != 0, "missing originator ref");
        require(bytes(intake.recipientName).length != 0, "missing recipient name");
        require(bytes(intake.recipientAccountReference).length != 0, "missing recipient ref");
        recordedPayloads[intake.transferId] = intake;
        emit BeneficiaryPayloadRecorded(intake.transferId, msg.sender);
    }

    function verifyPayloadIntegrity(bytes32 transferId, address orderingInstitution) external view returns (bool) {
        orderingInstitution;
        return recordedPayloads[transferId].transferId != bytes32(0);
    }

    /// @dev Provides a forwarding hook but no missing-information mitigation.
    function forwardFullPayload(bytes32 transferId, address nextInstitution) external returns (BeneficiaryIntake memory) {
        BeneficiaryIntake memory stored = recordedPayloads[transferId];
        require(stored.transferId != bytes32(0), "payload missing");
        emit VirtualAssetTransferForwarded(transferId, nextInstitution);
        return stored;
    }
}
