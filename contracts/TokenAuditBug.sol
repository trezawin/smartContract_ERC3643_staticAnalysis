// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

interface IIdentityRegistry {
  function isVerified(address user) external view returns (bool);
}

interface IModularCompliance {
  function bindToken(address token) external;
  function unbindToken(address token) external;
  function canTransfer(address from, address to, uint256 amount) external view returns (bool);
  function transferred(address from, address to, uint256 amount) external;
  function created(address to, uint256 amount) external;
  function destroyed(address from, uint256 amount) external;
}

/**
 * @notice Minimal Boulder-like token used for audit simulations. The implementation intentionally
 *         introduces two defects while keeping deterministic probes green:
 *         - Identity verification is replaced with an allowlist managed by the owner.
 *         - A compliance bypass hook lets selected accounts skip the compliance guard.
 *
 *         The contract surface mirrors the subset exercised by existing bootstrap scripts.
 */
contract TokenAuditBug is ERC20, Ownable, Pausable, AccessControl {
  bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

  bool private _initialized;
  uint8 private _tokenDecimals;
  string private _tokenName;
  string private _tokenSymbol;
  address private _tokenOnchainID;

  IIdentityRegistry private _identityRegistry;
  IModularCompliance private _compliance;

  mapping(address => bool) private _allowlist;
  mapping(address => bool) private _complianceBypass;

  event AllowlistUpdated(address indexed account, bool allowed);
  event ComplianceBypassUpdated(address indexed account, bool allowed);
  event IdentityRegistryUpdated(address indexed registry);
  event ComplianceUpdated(address indexed compliance);

  constructor() ERC20("", "") {
    _pause();
    _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
    _setupRole(AGENT_ROLE, _msgSender());
  }

  function init(
    address identityRegistry_,
    address compliance_,
    string memory name_,
    string memory symbol_,
    uint8 decimals_,
    address onchainId_
  ) external {
    require(!_initialized, "already initialized");
    require(identityRegistry_ != address(0) && compliance_ != address(0), "invalid address");
    require(bytes(name_).length > 0 && bytes(symbol_).length > 0, "invalid token meta");
    require(decimals_ <= 18, "invalid decimals");

    _identityRegistry = IIdentityRegistry(identityRegistry_);
    _compliance = IModularCompliance(compliance_);
    _compliance.bindToken(address(this));

    _tokenName = name_;
    _tokenSymbol = symbol_;
    _tokenDecimals = decimals_;
    _tokenOnchainID = onchainId_;

    _allowlist[_msgSender()] = true;
    if (onchainId_ != address(0)) {
      _allowlist[onchainId_] = true;
    }

    _initialized = true;
  }

  function name() public view override returns (string memory) {
    return _tokenName;
  }

  function symbol() public view override returns (string memory) {
    return _tokenSymbol;
  }

  function decimals() public view override returns (uint8) {
    return _tokenDecimals;
  }

  function identityRegistry() external view returns (address) {
    return address(_identityRegistry);
  }

  function compliance() external view returns (address) {
    return address(_compliance);
  }

  function setIdentityRegistry(address newRegistry) external onlyOwner {
    require(newRegistry != address(0), "invalid address");
    _identityRegistry = IIdentityRegistry(newRegistry);
    emit IdentityRegistryUpdated(newRegistry);
  }

  function setCompliance(address newCompliance) external onlyOwner {
    require(newCompliance != address(0), "invalid address");
    if (address(_compliance) != address(0)) {
      _compliance.unbindToken(address(this));
    }
    _compliance = IModularCompliance(newCompliance);
    _compliance.bindToken(address(this));
    emit ComplianceUpdated(newCompliance);
  }

  function setAllowlist(address account, bool allowed) external onlyOwner {
    _allowlist[account] = allowed;
    emit AllowlistUpdated(account, allowed);
  }

  function isAllowlisted(address account) external view returns (bool) {
    return _allowlist[account];
  }

  function setComplianceBypass(address account, bool allowed) external onlyOwner {
    _complianceBypass[account] = allowed;
    emit ComplianceBypassUpdated(account, allowed);
  }

  function hasComplianceBypass(address account) external view returns (bool) {
    return _complianceBypass[account];
  }

  function addAgent(address agent) external onlyOwner {
    _setupRole(AGENT_ROLE, agent);
  }

  function removeAgent(address agent) external onlyOwner {
    revokeRole(AGENT_ROLE, agent);
  }

  function pause() external onlyRole(AGENT_ROLE) {
    _pause();
  }

  function unpause() external onlyRole(AGENT_ROLE) {
    _unpause();
  }

  function mint(address to, uint256 amount) external onlyRole(AGENT_ROLE) {
    require(_allowlist[to], "recipient not allowlisted");
    _mint(to, amount);
    if (address(_compliance) != address(0)) {
      try _compliance.created(to, amount) {} catch {}
    }
  }

  function burn(address from, uint256 amount) external onlyRole(AGENT_ROLE) {
    _burn(from, amount);
    if (address(_compliance) != address(0)) {
      try _compliance.destroyed(from, amount) {} catch {}
    }
  }

  function transfer(address to, uint256 amount) public override whenNotPaused returns (bool) {
    _performTransfer(_msgSender(), to, amount);
    return true;
  }

  function transferFrom(address from, address to, uint256 amount) public override whenNotPaused returns (bool) {
    _spendAllowance(from, _msgSender(), amount);
    _performTransfer(from, to, amount);
    return true;
  }

  function _performTransfer(address from, address to, uint256 amount) internal {
    require(_allowlist[to], "MUTANT_CHALLENGE_NO_IDENTITY");
    bool bypass = _complianceBypass[from];

    if (!bypass) {
      require(_compliance.canTransfer(from, to, amount), "MUTANT_EXTEND_CANTRANSFER_FALSE");
    }

    _transfer(from, to, amount);

    if (!bypass) {
      _compliance.transferred(from, to, amount);
    } else if (address(_compliance) != address(0)) {
      try _compliance.transferred(from, to, amount) {} catch {}
    }
  }
}
