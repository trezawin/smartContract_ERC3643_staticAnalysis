// Address: 0x23b64FBc42Ef1775F8A099965659c4c5C91e0CeC
// ContractName: IdFactory
// Compiler: v0.8.17+commit.8df45f5f
// License: GNU GPLv3
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

// Sources flattened with hardhat v2.12.6 https://hardhat.org

// File @openzeppelin/contracts/utils/Context.sol@v4.8.3

// OpenZeppelin Contracts v4.4.1 (utils/Context.sol)

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }
}

// File @openzeppelin/contracts/access/Ownable.sol@v4.8.3

// OpenZeppelin Contracts (last updated v4.7.0) (access/Ownable.sol)

/**
 * @dev Contract module which provides a basic access control mechanism, where
 * there is an account (an owner) that can be granted exclusive access to
 * specific functions.
 *
 * By default, the owner account will be the one that deploys the contract. This
 * can later be changed with {transferOwnership}.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 */
abstract contract Ownable is Context {
    address private _owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Initializes the contract setting the deployer as the initial owner.
     */
    constructor() {
        _transferOwnership(_msgSender());
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view virtual returns (address) {
        return _owner;
    }

    /**
     * @dev Throws if the sender is not the owner.
     */
    function _checkOwner() internal view virtual {
        require(owner() == _msgSender(), "Ownable: caller is not the owner");
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions anymore. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby removing any functionality that is only available to the owner.
     */
    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
        _transferOwnership(newOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Internal function without access restriction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

// File contracts/factory/IIdFactory.sol

interface IIdFactory {

    /// events

    // event emitted whenever a single contract is deployed by the factory
    event Deployed(address indexed _addr);

    // event emitted when a wallet is linked to an ONCHAINID contract
    event WalletLinked(address indexed wallet, address indexed identity);

    // event emitted when a token is linked to an ONCHAINID contract
    event TokenLinked(address indexed token, address indexed identity);

    // event emitted when a wallet is unlinked from an ONCHAINID contract
    event WalletUnlinked(address indexed wallet, address indexed identity);

    // event emitted when an address is registered on the factory as a Token
    // factory address, granting this address the privilege to issue
    // Onchain identities for tokens
    event TokenFactoryAdded(address indexed factory);

    // event emitted when a previously recorded token factory address is removed
    event TokenFactoryRemoved(address indexed factory);

    /// functions

    /**
     *  @dev function used to create a new Identity proxy from the factory
     *  @param _wallet the wallet address of the primary owner of this ONCHAINID contract
     *  @param _salt the salt used by create2 to issue the contract
     *  requires a new salt for each deployment
     *  _wallet cannot be linked to another ONCHAINID
     *  only Owner can call => Owner is supposed to be a smart contract, managing the accessibility
     *  of the function, including calls to oracles for multichain
     *  deployment security (avoid identity theft), defining payment requirements, etc.
     */
    function createIdentity(address _wallet, string memory _salt) external returns (address);

    /**
     *  @dev function used to create a new Identity proxy from the factory, setting the wallet and listed keys as
     * MANAGEMENT keys.
     *  @param _wallet the wallet address of the primary owner of this ONCHAINID contract
     *  @param _salt the salt used by create2 to issue the contract
     *  @param _managementKeys A list of keys hash (keccak256(abiEncoded())) to add as MANAGEMENT keys.
     *  requires a new salt for each deployment
     *  _wallet cannot be linked to another ONCHAINID
     *  only Owner can call => Owner is supposed to be a smart contract, managing the accessibility
     *  of the function, including calls to oracles for multichain
     *  deployment security (avoid identity theft), defining payment requirements, etc.
     */
    function createIdentityWithManagementKeys(
        address _wallet,
        string memory _salt,
        bytes32[] memory _managementKeys
    ) external returns (address);

    /**
     *  @dev function used to create a new Token Identity proxy from the factory
     *  @param _token the address of the token contract
     *  @param _tokenOwner the owner address of the token
     *  @param _salt the salt used by create2 to issue the contract
     *  requires a new salt for each deployment
     *  _token cannot be linked to another ONCHAINID
     *  only Token factory or owner can call (owner should only use its privilege
     *  for tokens not issued by a Token factory onchain
     */
    function createTokenIdentity(address _token, address _tokenOwner, string memory _salt) external returns (address);

    /**
     *  @dev function used to link a new wallet to an existing identity
     *  @param _newWallet the address of the wallet to link
     *  requires msg.sender to be linked to an existing onchainid
     *  the _newWallet will be linked to the same OID contract as msg.sender
     *  _newWallet cannot be linked to an OID yet
     *  _newWallet cannot be address 0
     *  cannot link more than 100 wallets to an OID, for gas consumption reason
     */
    function linkWallet(address _newWallet) external;

    /**
     *  @dev function used to unlink a wallet from an existing identity
     *  @param _oldWallet the address of the wallet to unlink
     *  requires msg.sender to be linked to the same onchainid as _oldWallet
     *  msg.sender cannot be _oldWallet to keep at least 1 wallet linked to any OID
     *  _oldWallet cannot be address 0
     */
    function unlinkWallet(address _oldWallet) external;

    /**
     *  @dev function used to register an address as a token factory
     *  @param _factory the address of the token factory
     *  can be called only by Owner
     *  _factory cannot be registered yet
     *  once the factory has been registered it can deploy token identities
     */
    function addTokenFactory(address _factory) external;

    /**
     *  @dev function used to unregister an address previously registered as a token factory
     *  @param _factory the address of the token factory
     *  can be called only by Owner
     *  _factory has to be registered previously
     *  once the factory has been unregistered it cannot deploy token identities anymore
     */
    function removeTokenFactory(address _factory) external;

    /**
     *  @dev getter for OID contract corresponding to a wallet/token
     *  @param _wallet the wallet/token address
     */
    function getIdentity(address _wallet) external view returns (address);

    /**
     *  @dev getter to fetch the array of wallets linked to an OID contract
     *  @param _identity the address of the OID contract
     *  returns an array of addresses linked to the OID
     */
    function getWallets(address _identity) external view returns (address[] memory);

    /**
     *  @dev getter to fetch the token address linked to an OID contract
     *  @param _identity the address of the OID contract
     *  returns the address linked to the OID
     */
    function getToken(address _identity) external view returns (address);

    /**
     *  @dev getter to know if an address is registered as token factory or not
     *  @param _factory the address of the factory
     *  returns true if the address corresponds to a registered factory
     */
    function isTokenFactory(address _factory) external view returns(bool);

    /**
     *  @dev getter to know if a salt is taken for the create2 deployment
     *  @param _salt the salt used for deployment
     */
    function isSaltTaken(string calldata _salt) external view returns (bool);

    /**
     * @dev getter for the implementation authority used by this factory.
     */
    function implementationAuthority() external view returns (address);
}

// File contracts/interface/IERC734.sol

/**
 * @dev interface of the ERC734 (Key Holder) standard as defined in the EIP.
 */
interface IERC734 {

    /**
     * @dev Emitted when an execution request was approved.
     *
     * Specification: MUST be triggered when approve was successfully called.
     */
    event Approved(uint256 indexed executionId, bool approved);

    /**
     * @dev Emitted when an execute operation was approved and successfully performed.
     *
     * Specification: MUST be triggered when approve was called and the execution was successfully approved.
     */
    event Executed(uint256 indexed executionId, address indexed to, uint256 indexed value, bytes data);

    /**
     * @dev Emitted when an execution request was performed via `execute`.
     *
     * Specification: MUST be triggered when execute was successfully called.
     */
    event ExecutionRequested(uint256 indexed executionId, address indexed to, uint256 indexed value, bytes data);

    /**
     * @dev Emitted when an execute operation was called and failed
     *
     * Specification: MUST be triggered when execute call failed
     */
    event ExecutionFailed(uint256 indexed executionId, address indexed to, uint256 indexed value, bytes data);

    /**
     * @dev Emitted when a key was added to the Identity.
     *
     * Specification: MUST be triggered when addKey was successfully called.
     */
    event KeyAdded(bytes32 indexed key, uint256 indexed purpose, uint256 indexed keyType);

    /**
     * @dev Emitted when a key was removed from the Identity.
     *
     * Specification: MUST be triggered when removeKey was successfully called.
     */
    event KeyRemoved(bytes32 indexed key, uint256 indexed purpose, uint256 indexed keyType);

    /**
     * @dev Adds a _key to the identity. The _purpose specifies the purpose of the key.
     *
     * Triggers Event: `KeyAdded`
     *
     * Specification: MUST only be done by keys of purpose 1, or the identity
     * itself. If it's the identity itself, the approval process will determine its approval.
     */
    function addKey(bytes32 _key, uint256 _purpose, uint256 _keyType) external returns (bool success);

    /**
    * @dev Approves an execution.
    *
    * Triggers Event: `Approved`
    * Triggers on execution successful Event: `Executed`
    * Triggers on execution failure Event: `ExecutionFailed`
    */
    function approve(uint256 _id, bool _approve) external returns (bool success);

    /**
     * @dev Removes _purpose for _key from the identity.
     *
     * Triggers Event: `KeyRemoved`
     *
     * Specification: MUST only be done by keys of purpose 1, or the identity itself.
     * If it's the identity itself, the approval process will determine its approval.
     */
    function removeKey(bytes32 _key, uint256 _purpose) external returns (bool success);

    /**
     * @dev Passes an execution instruction to an ERC734 identity.
     * How the execution is handled is up to the identity implementation:
     * An execution COULD be requested and require `approve` to be called with one or more keys of purpose 1 or 2 to
     * approve this execution.
     * Execute COULD be used as the only accessor for `addKey` and `removeKey`.
     *
     * Triggers Event: ExecutionRequested
     * Triggers on direct execution Event: Executed
     */
    function execute(address _to, uint256 _value, bytes calldata _data) external payable returns (uint256 executionId);

    /**
     * @dev Returns the full key data, if present in the identity.
     */
    function getKey(bytes32 _key) external view returns (uint256[] memory purposes, uint256 keyType, bytes32 key);

    /**
     * @dev Returns the list of purposes associated with a key.
     */
    function getKeyPurposes(bytes32 _key) external view returns(uint256[] memory _purposes);

    /**
     * @dev Returns an array of public key bytes32 held by this identity.
     */
    function getKeysByPurpose(uint256 _purpose) external view returns (bytes32[] memory keys);

    /**
     * @dev Returns TRUE if a key is present and has the given purpose. If the key is not present it returns FALSE.
     */
    function keyHasPurpose(bytes32 _key, uint256 _purpose) external view returns (bool exists);
}

// File contracts/interface/IImplementationAuthority.sol

interface IImplementationAuthority {

    // event emitted when the implementation contract is updated
    event UpdatedImplementation(address newAddress);

    /**
     * @dev updates the address used as implementation by the proxies linked
     * to this ImplementationAuthority contract
     * @param _newImplementation the address of the new implementation contract
     * only Owner can call
     */
    function updateImplementation(address _newImplementation) external;

    /**
     * @dev returns the address of the implementation
     */
    function getImplementation() external view returns(address);
}

// File contracts/proxy/IdentityProxy.sol

contract IdentityProxy {

    /**
     *  @dev constructor of the proxy Identity contract
     *  @param _implementationAuthority the implementation Authority contract address
     *  @param initialManagementKey the management key at deployment
     *  the proxy is going to use the logic deployed on the implementation contract
     *  deployed at an address listed in the ImplementationAuthority contract
     */
    constructor(address _implementationAuthority, address initialManagementKey) {
        require(_implementationAuthority != address(0), "invalid argument - zero address");
        require(initialManagementKey != address(0), "invalid argument - zero address");

        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(0x821f3e4d3d679f19eacc940c87acf846ea6eae24a63058ea750304437a62aafc, _implementationAuthority)
        }

        address logic = IImplementationAuthority(_implementationAuthority).getImplementation();

        // solhint-disable-next-line avoid-low-level-calls
        (bool success,) = logic.delegatecall(abi.encodeWithSignature("initialize(address)", initialManagementKey));
        require(success, "Initialization failed.");
    }

    /**
     *  @dev fallback proxy function used for any transaction call that is made using
     *  the Identity contract ABI and called on the proxy contract
     *  The proxy will update its local storage depending on the behaviour requested
     *  by the implementation contract given by the Implementation Authority
     */
    // solhint-disable-next-line no-complex-fallback
    fallback() external payable {
        address logic = IImplementationAuthority(implementationAuthority()).getImplementation();

        // solhint-disable-next-line no-inline-assembly
        assembly {
        calldatacopy(0x0, 0x0, calldatasize())
        let success := delegatecall(sub(gas(), 10000), logic, 0x0, calldatasize(), 0, 0)
        let retSz := returndatasize()
        returndatacopy(0, 0, retSz)
        switch success
            case 0 {
                revert(0, retSz)
            }
            default {
                return(0, retSz)
            }
        }
    }

    function implementationAuthority() public view returns(address) {
        address implemAuth;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            implemAuth := sload(0x821f3e4d3d679f19eacc940c87acf846ea6eae24a63058ea750304437a62aafc)
        }
        return implemAuth;
    }
}

// File contracts/factory/IdFactory.sol

contract IdFactory is IIdFactory, Ownable {

    mapping(address => bool) private _tokenFactories;

    // address of the _implementationAuthority contract making the link to the implementation contract
    address private immutable _implementationAuthority;

    // as it is not possible to deploy 2 times the same contract address, this mapping allows us to check which
    // salt is taken and which is not
    mapping(string => bool) private _saltTaken;

    // ONCHAINID of the wallet owner
    mapping(address => address) private _userIdentity;

    // wallets currently linked to an ONCHAINID
    mapping(address => address[]) private _wallets;

    // ONCHAINID of the token
    mapping(address => address) private _tokenIdentity;

    // token linked to an ONCHAINID
    mapping(address => address) private _tokenAddress;

    // setting
    constructor (address implementationAuthority) {
        require(implementationAuthority != address(0), "invalid argument - zero address");
        _implementationAuthority = implementationAuthority;
    }

    /**
     *  @dev See {IdFactory-addTokenFactory}.
     */
    function addTokenFactory(address _factory) external override onlyOwner {
        require(_factory != address(0), "invalid argument - zero address");
        require(!isTokenFactory(_factory), "already a factory");
        _tokenFactories[_factory] = true;
        emit TokenFactoryAdded(_factory);
    }

    /**
     *  @dev See {IdFactory-removeTokenFactory}.
     */
    function removeTokenFactory(address _factory) external override onlyOwner {
        require(_factory != address(0), "invalid argument - zero address");
        require(isTokenFactory(_factory), "not a factory");
        _tokenFactories[_factory] = false;
        emit TokenFactoryRemoved(_factory);
    }

    /**
     *  @dev See {IdFactory-createIdentity}.
     */
    function createIdentity(
        address _wallet,
        string memory _salt)
    external onlyOwner override returns (address) {
        require(_wallet != address(0), "invalid argument - zero address");
        require(keccak256(abi.encode(_salt)) != keccak256(abi.encode("")), "invalid argument - empty string");
        string memory oidSalt = string.concat("OID",_salt);
        require (!_saltTaken[oidSalt], "salt already taken");
        require (_userIdentity[_wallet] == address(0), "wallet already linked to an identity");
        address identity = _deployIdentity(oidSalt, _implementationAuthority, _wallet);
        _saltTaken[oidSalt] = true;
        _userIdentity[_wallet] = identity;
        _wallets[identity].push(_wallet);
        emit WalletLinked(_wallet, identity);
        return identity;
    }

    /**
     *  @dev See {IdFactory-createIdentityWithManagementKeys}.
     */
    function createIdentityWithManagementKeys(
        address _wallet,
        string memory _salt,
        bytes32[] memory _managementKeys
    ) external onlyOwner override returns (address) {
        require(_wallet != address(0), "invalid argument - zero address");
        require(keccak256(abi.encode(_salt)) != keccak256(abi.encode("")), "invalid argument - empty string");
        string memory oidSalt = string.concat("OID",_salt);
        require (!_saltTaken[oidSalt], "salt already taken");
        require (_userIdentity[_wallet] == address(0), "wallet already linked to an identity");
        require(_managementKeys.length > 0, "invalid argument - empty list of keys");

        address identity = _deployIdentity(oidSalt, _implementationAuthority, address(this));

        for (uint i = 0; i < _managementKeys.length; i++) {
            require(
                _managementKeys[i] != keccak256(abi.encode(_wallet))
                , "invalid argument - wallet is also listed in management keys");
            IERC734(identity).addKey(
                _managementKeys[i],
                1,
                1
            );
        }

        IERC734(identity).removeKey(
            keccak256(abi.encode(address(this))),
            1
        );

        _saltTaken[oidSalt] = true;
        _userIdentity[_wallet] = identity;
        _wallets[identity].push(_wallet);
        emit WalletLinked(_wallet, identity);

        return identity;
    }

    /**
     *  @dev See {IdFactory-createTokenIdentity}.
     */
    function createTokenIdentity(
        address _token,
        address _tokenOwner,
        string memory _salt)
    external override returns (address) {
        require(isTokenFactory(msg.sender) || msg.sender == owner(), "only Factory or owner can call");
        require(_token != address(0), "invalid argument - zero address");
        require(_tokenOwner != address(0), "invalid argument - zero address");
        require(keccak256(abi.encode(_salt)) != keccak256(abi.encode("")), "invalid argument - empty string");
        string memory tokenIdSalt = string.concat("Token",_salt);
        require(!_saltTaken[tokenIdSalt], "salt already taken");
        require(_tokenIdentity[_token] == address(0), "token already linked to an identity");
        address identity = _deployIdentity(tokenIdSalt, _implementationAuthority, _tokenOwner);
        _saltTaken[tokenIdSalt] = true;
        _tokenIdentity[_token] = identity;
        _tokenAddress[identity] = _token;
        emit TokenLinked(_token, identity);
        return identity;
    }

    /**
     *  @dev See {IdFactory-linkWallet}.
     */
    function linkWallet(address _newWallet) external override {
        require(_newWallet != address(0), "invalid argument - zero address");
        require(_userIdentity[msg.sender] != address(0), "wallet not linked to an identity contract");
        require(_userIdentity[_newWallet] == address(0), "new wallet already linked");
        require(_tokenIdentity[_newWallet] == address(0), "invalid argument - token address");
        address identity = _userIdentity[msg.sender];
        require(_wallets[identity].length < 101, "max amount of wallets per ID exceeded");
        _userIdentity[_newWallet] = identity;
        _wallets[identity].push(_newWallet);
        emit WalletLinked(_newWallet, identity);
    }

    /**
     *  @dev See {IdFactory-unlinkWallet}.
     */
    function unlinkWallet(address _oldWallet) external override {
        require(_oldWallet != address(0), "invalid argument - zero address");
        require(_oldWallet != msg.sender, "cannot be called on sender address");
        require(_userIdentity[msg.sender] == _userIdentity[_oldWallet], "only a linked wallet can unlink");
        address _identity = _userIdentity[_oldWallet];
        delete _userIdentity[_oldWallet];
        uint256 length = _wallets[_identity].length;
        for (uint256 i = 0; i < length; i++) {
            if (_wallets[_identity][i] == _oldWallet) {
                _wallets[_identity][i] = _wallets[_identity][length - 1];
                _wallets[_identity].pop();
                break;
            }
        }
        emit WalletUnlinked(_oldWallet, _identity);
    }

    /**
     *  @dev See {IdFactory-getIdentity}.
     */
    function getIdentity(address _wallet) external override view returns (address) {
        if(_tokenIdentity[_wallet] != address(0)) {
            return _tokenIdentity[_wallet];
        }
        else {
            return _userIdentity[_wallet];
        }
    }

    /**
     *  @dev See {IdFactory-isSaltTaken}.
     */
    function isSaltTaken(string calldata _salt) external override view returns (bool) {
        return _saltTaken[_salt];
    }

    /**
     *  @dev See {IdFactory-getWallets}.
     */
    function getWallets(address _identity) external override view returns (address[] memory) {
        return _wallets[_identity];
    }

    /**
     *  @dev See {IdFactory-getToken}.
     */
    function getToken(address _identity) external override view returns (address) {
        return _tokenAddress[_identity];
    }

    /**
     *  @dev See {IdFactory-isTokenFactory}.
     */
    function isTokenFactory(address _factory) public override view returns(bool) {
        return _tokenFactories[_factory];
    }

    /**
     *  @dev See {IdFactory-implementationAuthority}.
     */
    function implementationAuthority() public override view returns (address) {
        return _implementationAuthority;
    }

    // deploy function with create2 opcode call
    // returns the address of the contract created
    function _deploy(string memory salt, bytes memory bytecode) private returns (address) {
        bytes32 saltBytes = bytes32(keccak256(abi.encodePacked(salt)));
        address addr;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let encoded_data := add(0x20, bytecode) // load initialization code.
            let encoded_size := mload(bytecode)     // load init code's length.
            addr := create2(0, encoded_data, encoded_size, saltBytes)
            if iszero(extcodesize(addr)) {
                revert(0, 0)
            }
        }
        emit Deployed(addr);
        return addr;
    }

    // function used to deploy an identity using CREATE2
    function _deployIdentity
    (
        string memory _salt,
        address implementationAuthority,
        address _wallet
    ) private returns (address){
        bytes memory _code = type(IdentityProxy).creationCode;
        bytes memory _constructData = abi.encode(implementationAuthority, _wallet);
        bytes memory bytecode = abi.encodePacked(_code, _constructData);
        return _deploy(_salt, bytecode);
    }
}