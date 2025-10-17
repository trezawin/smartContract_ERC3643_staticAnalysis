// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "@tokenysolutions/t-rex/contracts/compliance/modular/modules/AbstractModule.sol";

/**
 * @notice Lightweight module used only during runtime probes to force
 *         deterministic compliance verdicts without modifying production logic.
 *         The module stores a per-compliance boolean flag that can be toggled
 *         via the compliance contract using `callModuleFunction`.
 */
contract ComplianceProbeModule is AbstractModule {
    mapping(address => bool) private _allow;
    mapping(address => bool) private _initialized;

    function moduleTransferAction(address, address, uint256) external override onlyComplianceCall {}
    function moduleMintAction(address, uint256) external override onlyComplianceCall {}
    function moduleBurnAction(address, uint256) external override onlyComplianceCall {}

    function canComplianceBind(address) external pure override returns (bool) {
        return true;
    }

    function isPlugAndPlay() external pure override returns (bool) {
        return true;
    }

    function name() external pure override returns (string memory) {
        return "ComplianceProbeModule";
    }

    function moduleCheck(
        address,
        address,
        uint256,
        address compliance
    ) external view override returns (bool) {
        if (!_initialized[compliance]) {
            return true;
        }
        return _allow[compliance];
    }

    function setResult(bool allowTransfers) external onlyComplianceCall {
        _allow[msg.sender] = allowTransfers;
        _initialized[msg.sender] = true;
    }
}
