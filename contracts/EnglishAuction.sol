// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract EnglishAuction is ERC721Holder, ReentrancyGuard {
    uint256 public constant PLATFORM_FEE_BPS = 250;
    uint256 public constant MIN_BID_INCREMENT_BPS = 500;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    error ZeroAddress();
    error InvalidStartingPrice();
    error InvalidDuration();
    error AuctionNotFound();
    error NotAuctionSeller();
    error AuctionNotActive();
    error AuctionStillActive();
    error SellerCannotBid();
    error BidTooLow(uint256 minimumBid);
    error AuctionHasBids();
    error NothingToWithdraw();
    error WithdrawalFailed();

    struct Auction {
        address seller;
        IERC721 nft;
        uint256 tokenId;
        uint256 startingPrice;
        uint256 highestBid;
        address highestBidder;
        uint256 endTime;
        bool settled;
        bool cancelled;
    }

    address public immutable treasury;
    uint256 public nextAuctionId = 1;
    mapping(uint256 auctionId => Auction auction) public auctions;
    mapping(address account => uint256 amount) public pendingWithdrawals;

    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed seller,
        address indexed nft,
        uint256 tokenId,
        uint256 startingPrice,
        uint256 endTime
    );
    event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 amount);
    event AuctionSettled(
        uint256 indexed auctionId,
        address indexed winner,
        uint256 amount,
        uint256 platformFee
    );
    event AuctionCancelled(uint256 indexed auctionId);
    event Withdrawal(address indexed account, uint256 amount);

    constructor(address treasury_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
    }

    function createAuction(IERC721 nft, uint256 tokenId, uint256 startingPrice, uint256 duration)
        external
        nonReentrant
        returns (uint256 auctionId)
    {
        if (address(nft) == address(0)) revert ZeroAddress();
        if (startingPrice == 0) revert InvalidStartingPrice();
        if (duration == 0) revert InvalidDuration();

        auctionId = nextAuctionId++;
        uint256 endTime = block.timestamp + duration;
        auctions[auctionId] = Auction({
            seller: msg.sender,
            nft: nft,
            tokenId: tokenId,
            startingPrice: startingPrice,
            highestBid: 0,
            highestBidder: address(0),
            endTime: endTime,
            settled: false,
            cancelled: false
        });

        nft.safeTransferFrom(msg.sender, address(this), tokenId);
        emit AuctionCreated(auctionId, msg.sender, address(nft), tokenId, startingPrice, endTime);
    }

    function bid(uint256 auctionId) external payable nonReentrant {
        Auction storage auction = _activeAuction(auctionId);
        if (block.timestamp >= auction.endTime) revert AuctionNotActive();
        if (msg.sender == auction.seller) revert SellerCannotBid();

        uint256 minimumBid = auction.highestBid == 0
            ? auction.startingPrice
            : _minimumNextBid(auction.highestBid);
        if (msg.value < minimumBid) revert BidTooLow(minimumBid);

        if (auction.highestBidder != address(0)) {
            pendingWithdrawals[auction.highestBidder] += auction.highestBid;
        }
        auction.highestBid = msg.value;
        auction.highestBidder = msg.sender;

        emit BidPlaced(auctionId, msg.sender, msg.value);
    }

    function settle(uint256 auctionId) external nonReentrant {
        Auction storage auction = _activeAuction(auctionId);
        if (block.timestamp < auction.endTime) revert AuctionStillActive();

        auction.settled = true;
        if (auction.highestBidder == address(0)) {
            auction.nft.safeTransferFrom(address(this), auction.seller, auction.tokenId);
            emit AuctionSettled(auctionId, address(0), 0, 0);
            return;
        }

        uint256 fee = (auction.highestBid * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        pendingWithdrawals[auction.seller] += auction.highestBid - fee;
        pendingWithdrawals[treasury] += fee;
        auction.nft.safeTransferFrom(address(this), auction.highestBidder, auction.tokenId);

        emit AuctionSettled(auctionId, auction.highestBidder, auction.highestBid, fee);
    }

    function cancel(uint256 auctionId) external nonReentrant {
        Auction storage auction = _activeAuction(auctionId);
        if (msg.sender != auction.seller) revert NotAuctionSeller();
        if (auction.highestBidder != address(0)) revert AuctionHasBids();

        auction.cancelled = true;
        auction.nft.safeTransferFrom(address(this), auction.seller, auction.tokenId);
        emit AuctionCancelled(auctionId);
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0;
        (bool success,) = payable(msg.sender).call{value: amount}("");
        if (!success) revert WithdrawalFailed();

        emit Withdrawal(msg.sender, amount);
    }

    function minimumNextBid(uint256 auctionId) external view returns (uint256) {
        Auction storage auction = auctions[auctionId];
        if (auction.seller == address(0)) revert AuctionNotFound();
        return auction.highestBid == 0
            ? auction.startingPrice
            : _minimumNextBid(auction.highestBid);
    }

    function _activeAuction(uint256 auctionId) private view returns (Auction storage auction) {
        auction = auctions[auctionId];
        if (auction.seller == address(0)) revert AuctionNotFound();
        if (auction.settled || auction.cancelled) revert AuctionNotActive();
    }

    function _minimumNextBid(uint256 highestBid) private pure returns (uint256) {
        uint256 increment = (highestBid / 20) + (highestBid % 20 == 0 ? 0 : 1);
        return highestBid + increment;
    }
}
