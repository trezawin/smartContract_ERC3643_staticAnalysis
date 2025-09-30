# Phase-1 Static Analysis Summary (Slither)

**Date:** 2025-09-30T14:10:07.464Z

## Scope & Inputs
- Tool: Slither (Python CLI)
- Raw outputs: `reports/slither.json`, `reports/slither.sarif`

## Contract Inventory
| Contract | File(s) |
|---|---|
| __Context_init | node_modules/@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol |
| __Context_init_unchained | node_modules/@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol |
| __gap | node_modules/@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol<br>node_modules/@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/storage/CTRStorage.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/storage/IRSStorage.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/storage/IRStorage.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/storage/TIRStorage.sol<br>node_modules/@tokenysolutions/t-rex/contracts/token/TokenStorage.sol |
| __IncludeTrexToken | contracts/_IncludeTrexToken.sol |
| __Ownable_init | node_modules/@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol |
| __Ownable_init_unchained | node_modules/@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol |
| _addedValue | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _agent | node_modules/@tokenysolutions/t-rex/contracts/roles/AgentRoleUpgradeable.sol |
| _amount | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _amounts | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _balances[_from] = _balances[_from] - _amount | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _balances[_to] = _balances[_to] + _amount | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _burn | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _claimTopic | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/ClaimTopicsRegistry.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/TrustedIssuersRegistry.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/interface/ITrustedIssuersRegistry.sol |
| _claimTopics | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/ClaimTopicsRegistry.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/TrustedIssuersRegistry.sol |
| _claimTopicsRegistry | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| _compliance | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _countries | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| _country | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistryStorage.sol |
| _decimals | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _freeze | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _from | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _fromList | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _frozen[_lostWallet] == true | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _frozen[_userAddress] = _freeze | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _frozenTokens[_from] = _frozenTokens[_from] - (tokensToUnfreeze) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _frozenTokens[_userAddress] = _frozenTokens[_userAddress] + (_amount) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _identities | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| _identity | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistryStorage.sol |
| _identityRegistries | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistryStorage.sol |
| _identityRegistry | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistryStorage.sol<br>node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _identityRegistryStorage | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| _identityStorage | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| _investorOnchainID | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _issuer | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/TrustedIssuersRegistry.sol |
| _lostWallet | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _mint | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _name | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _newWallet | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _onchainID | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _owner | node_modules/@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol<br>node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _revert | node_modules/@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol |
| _spender | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _subtractedValue | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _symbol | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _to | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _tokenCompliance | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _tokenCompliance = IModularCompliance(_compliance) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _tokenIdentityRegistry | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _tokenIdentityStorage | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| _tokenOnchainID = _onchainID | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _toList | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _totalSupply = _totalSupply - _amount | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _totalSupply = _totalSupply + _amount | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _trustedIssuer | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/TrustedIssuersRegistry.sol |
| _trustedIssuers | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/TrustedIssuersRegistry.sol |
| _trustedIssuersRegistry | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| _userAddress | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistryStorage.sol<br>node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _userAddresses | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol<br>node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| _validity = IClaimIssuer(issuer) | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| (foundClaimTopic,scheme,issuer,sig,data,None) = identity(_userAddress) | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| (success,returndata) = target | node_modules/@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol |
| (success) = recipient | node_modules/@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol |
| ^0 | node_modules/@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol<br>node_modules/@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol<br>node_modules/@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol<br>node_modules/@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol<br>node_modules/@openzeppelin/contracts/token/ERC20/IERC20.sol |
| 0 | contracts/TREXImports_0817.sol<br>contracts/_IncludeTrexToken.sol<br>node_modules/@onchain-id/solidity/contracts/interface/IClaimIssuer.sol<br>node_modules/@onchain-id/solidity/contracts/interface/IERC734.sol<br>node_modules/@onchain-id/solidity/contracts/interface/IERC735.sol<br>node_modules/@onchain-id/solidity/contracts/interface/IIdentity.sol<br>node_modules/@tokenysolutions/t-rex/contracts/compliance/modular/IModularCompliance.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/ClaimTopicsRegistry.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistryStorage.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/TrustedIssuersRegistry.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/interface/IClaimTopicsRegistry.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/interface/IIdentityRegistry.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/interface/IIdentityRegistryStorage.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/interface/ITrustedIssuersRegistry.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/storage/CTRStorage.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/storage/IRSStorage.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/storage/IRStorage.sol<br>node_modules/@tokenysolutions/t-rex/contracts/registry/storage/TIRStorage.sol<br>node_modules/@tokenysolutions/t-rex/contracts/roles/AgentRoleUpgradeable.sol<br>node_modules/@tokenysolutions/t-rex/contracts/roles/Roles.sol<br>node_modules/@tokenysolutions/t-rex/contracts/token/IToken.sol<br>node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol<br>node_modules/@tokenysolutions/t-rex/contracts/token/TokenStorage.sol |
| AddressFrozen(_userAddress,_freeze,msg | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| burn | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| claimTopics | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/TrustedIssuersRegistry.sol |
| ComplianceAdded(_compliance) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| CountryUpdated(_userAddress,_country) | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| deleteIdentity | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| forcedTransfer | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| forcedTransfer(_lostWallet,_newWallet,investorTokens) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| freezePartialTokens(_newWallet,frozenTokens) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| functionCallWithValue | node_modules/@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol |
| functionDelegateCall | node_modules/@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol |
| functionStaticCall | node_modules/@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol |
| identity | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| IdentityRegistered(_userAddress,_identity) | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| IdentityRemoved(_userAddress,oldIdentity) | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| IdentityUpdated(oldIdentity,_identity) | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| init | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| isVerified | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| mint | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| recoveryAddress | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| RecoverySuccess(_lostWallet,_newWallet,_investorOnchainID) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| registerIdentity | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| removeClaimTopic | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/ClaimTopicsRegistry.sol |
| removeTrustedIssuer | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/TrustedIssuersRegistry.sol |
| require(bool,string)(_tokenCompliance | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| require(bool,string)(_tokenIdentityRegistry | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| require(bool,string)(0 <= _decimals && _decimals <= 18,decimals between 0 and 18) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| sendValue | node_modules/@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol |
| setAddressFrozen(_newWallet,true) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| setCompliance | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| setCompliance(_compliance) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| TokensFrozen(_userAddress,_amount) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| TokensUnfrozen(_from,tokensToUnfreeze) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| transfer | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| Transfer(_from,_to,_amount) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| trustedIssuers = _tokenIssuersRegistry | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| unbindIdentityRegistry | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistryStorage.sol |
| updateCountry | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |
| UpdatedTokenInformation(_tokenName,_tokenSymbol,_tokenDecimals,_TOKEN_VERSION,_tokenOnchainID) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol |
| updateIdentity | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol |

## Findings by Severity (all)
- High: 0
- Medium: 4
- Low: 26
- Informational: 160

## Top Detector Patterns
| Rank | Detector | Count |
|---:|---|---:|
| 1 | Informational | naming-convention | 117 |
| 2 | Informational | solc-version | 29 |
| 3 | Low | calls-loop | 13 |
| 4 | Low | reentrancy-events | 8 |
| 5 | Informational | costly-loop | 5 |
| 6 | Informational | low-level-calls | 4 |
| 7 | Medium | reentrancy-no-eth | 2 |
| 8 | Low | shadowing-local | 2 |
| 9 | Low | missing-zero-check | 2 |
| 10 | Informational | similar-names | 2 |

## Sample Findings (first 25)
| Impact | Check | Contract | Function | File:Lines |
|---|---|---|---|---|
| Medium | reentrancy-no-eth | setCompliance | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:515-522 |
| Medium | reentrancy-no-eth | _tokenCompliance | unbindToken(address(this)) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:517 |
| Medium | reentrancy-no-eth | _tokenCompliance = IModularCompliance(_compliance) | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:519 |
| Medium | reentrancy-no-eth | recoveryAddress | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:297-322 |
| Medium | reentrancy-no-eth | _tokenIdentityRegistry | registerIdentity(_newWallet,_onchainID,_tokenIdentityRegistry.investorCountry(_lostWallet)) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:308-309 |
| Medium | reentrancy-no-eth | forcedTransfer(_lostWallet,_newWallet,investorTokens) | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:310 |
| Medium | reentrancy-no-eth | _tokenCompliance | transferred(_from,_to,_amount) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:445 |
| Medium | reentrancy-no-eth | _balances[_from] = _balances[_from] - _amount | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:544 |
| Medium | reentrancy-no-eth | _balances[_to] = _balances[_to] + _amount | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:545 |
| Medium | reentrancy-no-eth | _frozenTokens[_from] = _frozenTokens[_from] - (tokensToUnfreeze) | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:440 |
| Medium | reentrancy-no-eth | freezePartialTokens(_newWallet,frozenTokens) | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:312 |
| Medium | reentrancy-no-eth | _frozenTokens[_userAddress] = _frozenTokens[_userAddress] + (_amount) | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:491 |
| Medium | tautology | init | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:100-132 |
| Medium | tautology | require(bool,string)(0 <= _decimals && _decimals <= 18,decimals between 0 and 18) | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:122 |
| Medium | unused-return | isVerified | — | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol:173-223 |
| Medium | unused-return | (foundClaimTopic,scheme,issuer,sig,data,None) = identity(_userAddress) | getClaim(claimIds[j]) | node_modules/@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol:198 |
| Low | shadowing-local | _owner | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:334 |
| Low | shadowing-local | _owner | — | node_modules/@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol:22 |
| Low | shadowing-local | _owner | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:579 |
| Low | missing-zero-check | _onchainID | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:107 |
| Low | missing-zero-check | _tokenOnchainID = _onchainID | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:127 |
| Low | missing-zero-check | _onchainID | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:180 |
| Low | missing-zero-check | _tokenOnchainID = _onchainID | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:181 |
| Low | calls-loop | mint | — | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:454-459 |
| Low | calls-loop | require(bool,string)(_tokenCompliance | canTransfer(address(0),_to,_amount),Compliance not followed) | node_modules/@tokenysolutions/t-rex/contracts/token/Token.sol:456 |

## Notes for Thesis
- Phase-1 focuses on **technical** vulnerabilities (tool-based).
- Phase-2 (CRE baseline) will address **regulatory** rules (KYC, jurisdiction, investor-type) that static analyzers don’t model.
