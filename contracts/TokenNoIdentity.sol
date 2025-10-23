// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @notice Minimal token that ignores identity gating but still exposes expected view funcs.
contract TokenNoIdentity {
    string public name;
    string public symbol;
    uint8 public decimals;

    address private _identityRegistry;
    address private _compliance;
    address public owner;
    uint256 public totalSupply;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    function init(
        address identityRegistry_,
        address compliance_,
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address onchainId_
    ) external {
        owner = msg.sender;
        _identityRegistry = identityRegistry_;
        _compliance = compliance_;
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        // mint some supply to owner for testing
        _mint(msg.sender, 1_000_000 * (10 ** uint256(decimals)));
    }

    function identityRegistry() external view returns (address) { return _identityRegistry; }
    function compliance() external view returns (address) { return _compliance; }

    function balanceOf(address a) external view returns (uint256) { return _balances[a]; }
    function allowance(address a, address s) external view returns (uint256) { return _allowances[a][s]; }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0) && to != address(0), "zero address");
        require(_balances[from] >= amount, "insufficient");
        // Note: no identity or compliance checks here (mutant)
        _balances[from] -= amount;
        _balances[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        _balances[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }
}

