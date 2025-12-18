// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title BuggyTokenNoIdentityRegistry
 * @notice Minimal ERC-3643 style token used to simulate the absence of
 *         `identityRegistry()` on the token contract. This mutation intentionally
 *         omits the getter so rule `R-HKMA-53ZRH-REGISTER` fails its
 *         `hasabifn(token.identityRegistry())` check.
 *
 *         The implementation exposes a compliance reference and a basic transfer
 *         function but never surfaces the identity registry address.
 */
contract BuggyTokenNoIdentityRegistry {
    address private _compliance;
    mapping(address => uint256) private _balances;

    event ComplianceSet(address indexed compliance);

    function init(address compliance_) external {
        require(_compliance == address(0), "already initialised");
        _compliance = compliance_;
        emit ComplianceSet(compliance_);
    }

    function mint(address to, uint256 amount) external {
        require(to != address(0), "invalid recipient");
        _balances[to] += amount;
    }

    function balanceOf(address owner) external view returns (uint256) {
        return _balances[owner];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(to != address(0), "invalid recipient");
        require(_balances[msg.sender] >= amount, "insufficient balance");
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        return true;
    }

    // NOTE: The canonical ERC-3643 token exposes:
    // function identityRegistry() external view returns (address);
    //
    // This mutation intentionally omits it so the detector reports the missing
    // identity registry binding.
}
