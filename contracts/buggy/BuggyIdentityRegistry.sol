// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

// Minimal, intentionally buggy IdentityRegistry to simulate AMLO rule violations.
// Differences versus a compliant ERC‑3643 IdentityRegistry:
// - Missing functions: identity(address), batchRegisterIdentity(...)
// - Missing lifecycle events (IdentityRegistered, IdentityUpdated, etc.)
// - identityStorage() returns address(0) (runtime record‑keeping failure)
// - isVerified(address) always returns true (runtime sanctions/identity gating failure)

contract BuggyIdentityRegistry {
    address private _topicsRegistry;
    address private _issuersRegistry;
    address private _identityStorage;

    bool private _initialized;

    function init(
        address issuersRegistry_,
        address topicsRegistry_,
        address identityStorage_
    ) external {
        require(!_initialized, "already init");
        _initialized = true;
        _issuersRegistry = issuersRegistry_;
        _topicsRegistry = topicsRegistry_;
        // Intentionally ignore provided storage and keep zero to simulate defect
        _identityStorage = address(0);
    }

    // Expose the minimal getters used by surrounding system
    function topicsRegistry() external view returns (address) {
        return _topicsRegistry;
    }

    function issuersRegistry() external view returns (address) {
        return _issuersRegistry;
    }

    // Intentionally returns zero to break record‑keeping wiring
    function identityStorage() external view returns (address) {
        return _identityStorage;
    }

    // Intentionally permissive: always returns true to bypass identity gating
    function isVerified(address /* investor */) external pure returns (bool) {
        return true;
    }
}

