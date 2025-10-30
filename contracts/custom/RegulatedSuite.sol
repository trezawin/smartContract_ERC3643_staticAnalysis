// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title ERC-3643 Simplified Compliance Suite
 * @notice A near-realistic implementation of an ERC-3643 style token ecosystem including identity, compliance and governance.
 * @dev This contract bundle mimics a modular identity and compliance system for regulated tokens.
 */

/// ------------------------------------------------------------
///  Ownable Access Control
/// ------------------------------------------------------------
abstract contract Ownable {
    address private _owner;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    constructor() {
        _owner = msg.sender;
        emit OwnershipTransferred(address(0), _owner);
    }

    modifier onlyOwner() {
        require(msg.sender == _owner, "Not authorized");
        _;
    }

    function owner() public view returns (address) {
        return _owner;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }
}

/// ------------------------------------------------------------
///  CompositeIdentityRegistry
/// ------------------------------------------------------------
contract IdentityRegistry is Ownable {
    struct IdentityRecord {
        address identityContract;
        bool verified;
        uint16 country;
    }

    mapping(address => IdentityRecord) private _identities;
    event IdentityRegistered(address indexed investor, address indexed identityContract, uint16 country);
    event IdentityUpdated(address indexed investor, address indexed identityContract);
    event IdentityRemoved(address indexed investor);

    function registerIdentity(address investor, address identityContract, uint16 country) external onlyOwner {
        require(investor != address(0), "invalid investor");
        _identities[investor] = IdentityRecord(identityContract, true, country);
        emit IdentityRegistered(investor, identityContract, country);
    }

    function updateIdentity(address investor, address identityContract) external onlyOwner {
        require(_identities[investor].verified, "not registered");
        _identities[investor].identityContract = identityContract;
        emit IdentityUpdated(investor, identityContract);
    }

    function removeIdentity(address investor) external onlyOwner {
        require(_identities[investor].verified, "not registered");
        delete _identities[investor];
        emit IdentityRemoved(investor);
    }

    function isVerified(address investor) public view returns (bool) {
        return _identities[investor].verified;
    }

    function countryOf(address investor) public view returns (uint16) {
        return _identities[investor].country;
    }
}

/// ------------------------------------------------------------
///  Compliance Module
/// ------------------------------------------------------------
contract Compliance is Ownable {
    IdentityRegistry public identityRegistry;
    mapping(address => bool) private blacklisted;
    event Blacklisted(address indexed user, bool status);

    constructor(address registry) {
        identityRegistry = IdentityRegistry(registry);
    }

    function setBlacklist(address user, bool status) external onlyOwner {
        blacklisted[user] = status;
        emit Blacklisted(user, status);
    }

    function isAllowedTransfer(address from, address to, uint256) public view returns (bool) {
        if (blacklisted[from] || blacklisted[to]) return false;
        if (!identityRegistry.isVerified(from) || !identityRegistry.isVerified(to)) return false;
        return true;
    }
}

/// ------------------------------------------------------------
///  Regulated Token (ERC-3643 style)
/// ------------------------------------------------------------
contract RegulatedToken is Ownable {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    mapping(address => bool) private _frozen;
    mapping(address => uint256) private _partiallyFrozen;

    IdentityRegistry public identityRegistry;
    Compliance public compliance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event AddressFrozen(address indexed addr, bool frozen);
    event TokensFrozen(address indexed addr, uint256 amount);
    event TokensUnfrozen(address indexed addr, uint256 amount);

    constructor(string memory name_, string memory symbol_, address idRegistry, address compliance_) {
        name = name_;
        symbol = symbol_;
        identityRegistry = IdentityRegistry(idRegistry);
        compliance = Compliance(compliance_);
    }

    // --- Basic ERC20 ---
    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function allowance(address owner_, address spender) public view returns (uint256) {
        return _allowances[owner_][spender];
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) public returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        uint256 allowed = _allowances[from][msg.sender];
        require(allowed >= amount, "allowance exceeded");
        _allowances[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    // --- Compliance Aware Transfer ---
    function _transfer(address from, address to, uint256 amount) internal {
        require(!_frozen[from], "sender frozen");
        require(!_frozen[to], "receiver frozen");
        require(_balances[from] >= amount, "insufficient balance");
        require(compliance.isAllowedTransfer(from, to, amount), "transfer blocked by compliance");
        require(_balances[from] - _partiallyFrozen[from] >= amount, "partially frozen balance");

        _balances[from] -= amount;
        _balances[to] += amount;

        emit Transfer(from, to, amount);
    }

    // --- Minting / Burning ---
    function mint(address to, uint256 amount) external onlyOwner {
        require(identityRegistry.isVerified(to), "unverified recipient");
        _balances[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(address from, uint256 amount) external onlyOwner {
        require(_balances[from] >= amount, "insufficient");
        _balances[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    // --- Freezing Logic ---
    function freezeAddress(address investor, bool status) external onlyOwner {
        _frozen[investor] = status;
        emit AddressFrozen(investor, status);
    }

    function freezePartial(address investor, uint256 amount) external onlyOwner {
        _partiallyFrozen[investor] += amount;
        emit TokensFrozen(investor, amount);
    }

    function unfreezePartial(address investor, uint256 amount) external onlyOwner {
        if (amount >= _partiallyFrozen[investor]) {
            emit TokensUnfrozen(investor, _partiallyFrozen[investor]);
            _partiallyFrozen[investor] = 0;
        } else {
            _partiallyFrozen[investor] -= amount;
            emit TokensUnfrozen(investor, amount);
        }
    }

    // --- Getters ---
    function isFrozen(address investor) public view returns (bool) {
        return _frozen[investor];
    }

    function partiallyFrozenOf(address investor) public view returns (uint256) {
        return _partiallyFrozen[investor];
    }
}
