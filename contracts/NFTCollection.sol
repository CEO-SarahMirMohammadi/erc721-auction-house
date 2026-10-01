// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract NFTCollection is ERC721, ERC721URIStorage, Ownable, ReentrancyGuard {
    error InvalidMaxSupply();
    error MaxSupplyReached();
    error IncorrectMintPayment(uint256 required, uint256 received);
    error NothingToWithdraw();
    error WithdrawalFailed();

    uint256 public immutable maxSupply;
    uint256 public mintPrice;
    uint256 public totalMinted;
    uint256 private _nextTokenId = 1;

    event Minted(address indexed minter, uint256 indexed tokenId, string tokenURI);
    event MintPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event Withdrawal(address indexed recipient, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        uint256 mintPrice_,
        address initialOwner_
    ) ERC721(name_, symbol_) Ownable(initialOwner_) {
        if (maxSupply_ == 0) revert InvalidMaxSupply();
        maxSupply = maxSupply_;
        mintPrice = mintPrice_;
    }

    function mint(string calldata uri) external payable nonReentrant returns (uint256 tokenId) {
        if (totalMinted >= maxSupply) revert MaxSupplyReached();
        if (msg.value != mintPrice) revert IncorrectMintPayment(mintPrice, msg.value);

        tokenId = _nextTokenId++;
        totalMinted++;
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);

        emit Minted(msg.sender, tokenId, uri);
    }

    function setMintPrice(uint256 newPrice) external onlyOwner {
        emit MintPriceUpdated(mintPrice, newPrice);
        mintPrice = newPrice;
    }

    function withdraw() external onlyOwner nonReentrant {
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToWithdraw();

        (bool success,) = payable(owner()).call{value: amount}("");
        if (!success) revert WithdrawalFailed();

        emit Withdrawal(owner(), amount);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
