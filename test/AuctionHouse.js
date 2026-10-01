const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("ERC-721 Auction House", function () {
  let owner;
  let seller;
  let bidderOne;
  let bidderTwo;
  let treasury;
  let collection;
  let auction;

  const mintPrice = ethers.parseEther("0.01");
  const startingPrice = ethers.parseEther("1");
  const duration = 3600;
  const metadataURI = "ipfs://bafybeigdyrzt/example.json";

  async function createListedAuction(price = startingPrice, length = duration) {
    await collection.connect(seller).mint(metadataURI, { value: mintPrice });
    await collection.connect(seller).approve(auction.target, 1);
    await auction.connect(seller).createAuction(collection.target, 1, price, length);
  }

  async function movePastAuctionEnd() {
    const current = await ethers.provider.getBlock("latest");
    await network.provider.send("evm_setNextBlockTimestamp", [current.timestamp + duration + 1]);
    await network.provider.send("evm_mine");
  }

  beforeEach(async function () {
    [owner, seller, bidderOne, bidderTwo, treasury] = await ethers.getSigners();

    const Collection = await ethers.getContractFactory("NFTCollection");
    collection = await Collection.deploy("Auction House Collection", "AHN", 10, mintPrice, owner.address);

    const Auction = await ethers.getContractFactory("EnglishAuction");
    auction = await Auction.deploy(treasury.address);
  });

  describe("NFT collection", function () {
    it("mints with the exact configured price and stores metadata", async function () {
      await expect(collection.connect(seller).mint(metadataURI, { value: mintPrice }))
        .to.emit(collection, "Minted")
        .withArgs(seller.address, 1, metadataURI);

      expect(await collection.ownerOf(1)).to.equal(seller.address);
      expect(await collection.tokenURI(1)).to.equal(metadataURI);
      expect(await collection.totalMinted()).to.equal(1);
    });

    it("rejects incorrect payment and mints beyond maximum supply", async function () {
      await expect(collection.connect(seller).mint(metadataURI, { value: 0 }))
        .to.be.revertedWithCustomError(collection, "IncorrectMintPayment")
        .withArgs(mintPrice, 0);

      for (let tokenId = 0; tokenId < 10; tokenId++) {
        await collection.connect(seller).mint(metadataURI, { value: mintPrice });
      }
      await expect(collection.connect(seller).mint(metadataURI, { value: mintPrice }))
        .to.be.revertedWithCustomError(collection, "MaxSupplyReached");
    });

    it("lets the owner update mint price and withdraw mint proceeds", async function () {
      await collection.connect(seller).mint(metadataURI, { value: mintPrice });
      await expect(collection.withdraw())
        .to.changeEtherBalances([collection, owner], [-mintPrice, mintPrice]);

      await collection.setMintPrice(ethers.parseEther("0.02"));
      expect(await collection.mintPrice()).to.equal(ethers.parseEther("0.02"));
      await expect(collection.connect(seller).withdraw())
        .to.be.revertedWithCustomError(collection, "OwnableUnauthorizedAccount")
        .withArgs(seller.address);
    });
  });

  describe("auctions", function () {
    it("escrows the NFT when the seller creates an auction", async function () {
      await createListedAuction();

      expect(await collection.ownerOf(1)).to.equal(auction.target);
      const listing = await auction.auctions(1);
      expect(listing.seller).to.equal(seller.address);
      expect(listing.startingPrice).to.equal(startingPrice);
      expect(listing.endTime).to.be.greaterThan(0);
    });

    it("accepts the first bid at or above the starting price", async function () {
      await createListedAuction();
      await expect(auction.connect(bidderOne).bid(1, { value: startingPrice }))
        .to.emit(auction, "BidPlaced")
        .withArgs(1, bidderOne.address, startingPrice);

      const listing = await auction.auctions(1);
      expect(listing.highestBidder).to.equal(bidderOne.address);
      expect(listing.highestBid).to.equal(startingPrice);
    });

    it("enforces a minimum bid increment of 5 percent", async function () {
      await createListedAuction();
      await auction.connect(bidderOne).bid(1, { value: startingPrice });

      const minimumBid = startingPrice + startingPrice / 20n;
      expect(await auction.minimumNextBid(1)).to.equal(minimumBid);
      await expect(auction.connect(bidderTwo).bid(1, { value: minimumBid - 1n }))
        .to.be.revertedWithCustomError(auction, "BidTooLow")
        .withArgs(minimumBid);
      await auction.connect(bidderTwo).bid(1, { value: minimumBid });
    });

    it("credits the previous highest bidder with a withdrawable refund", async function () {
      await createListedAuction();
      await auction.connect(bidderOne).bid(1, { value: startingPrice });
      await auction.connect(bidderTwo).bid(1, { value: startingPrice + startingPrice / 20n });

      expect(await auction.pendingWithdrawals(bidderOne.address)).to.equal(startingPrice);
      await expect(auction.connect(bidderOne).withdraw())
        .to.changeEtherBalances([auction, bidderOne], [-startingPrice, startingPrice]);
      expect(await auction.pendingWithdrawals(bidderOne.address)).to.equal(0);
    });

    it("settles after expiry, transfers the NFT, and credits seller and treasury", async function () {
      await createListedAuction();
      await auction.connect(bidderOne).bid(1, { value: startingPrice });
      await movePastAuctionEnd();

      const fee = (startingPrice * 250n) / 10_000n;
      await expect(auction.settle(1))
        .to.emit(auction, "AuctionSettled")
        .withArgs(1, bidderOne.address, startingPrice, fee);

      expect(await collection.ownerOf(1)).to.equal(bidderOne.address);
      expect(await auction.pendingWithdrawals(seller.address)).to.equal(startingPrice - fee);
      expect(await auction.pendingWithdrawals(treasury.address)).to.equal(fee);
      expect(await auction.pendingWithdrawals(seller.address) + await auction.pendingWithdrawals(treasury.address))
        .to.equal(startingPrice);
    });

    it("settles an auction without bids by returning the NFT to the seller", async function () {
      await createListedAuction();
      await movePastAuctionEnd();
      await auction.settle(1);

      expect(await collection.ownerOf(1)).to.equal(seller.address);
      expect(await auction.pendingWithdrawals(seller.address)).to.equal(0);
    });

    it("allows cancellation only to the seller and only before any bid", async function () {
      await createListedAuction();
      await expect(auction.connect(bidderOne).cancel(1))
        .to.be.revertedWithCustomError(auction, "NotAuctionSeller");

      await auction.connect(seller).cancel(1);
      expect(await collection.ownerOf(1)).to.equal(seller.address);
      await expect(auction.settle(1)).to.be.revertedWithCustomError(auction, "AuctionNotActive");
    });

    it("prevents cancellation once bidding has started", async function () {
      await createListedAuction();
      await auction.connect(bidderOne).bid(1, { value: startingPrice });
      await expect(auction.connect(seller).cancel(1))
        .to.be.revertedWithCustomError(auction, "AuctionHasBids");
    });

    it("rejects invalid listings, bids, settlement, and withdrawals", async function () {
      await expect(auction.connect(seller).createAuction(collection.target, 1, 0, duration))
        .to.be.revertedWithCustomError(auction, "InvalidStartingPrice");
      await expect(auction.connect(seller).createAuction(collection.target, 1, startingPrice, 0))
        .to.be.revertedWithCustomError(auction, "InvalidDuration");
      await expect(auction.connect(seller).createAuction(collection.target, 999, startingPrice, duration))
        .to.be.reverted;
      await expect(auction.connect(bidderOne).bid(99, { value: startingPrice }))
        .to.be.revertedWithCustomError(auction, "AuctionNotFound");
      await expect(auction.connect(bidderOne).withdraw())
        .to.be.revertedWithCustomError(auction, "NothingToWithdraw");

      await createListedAuction();
      await expect(auction.connect(seller).bid(1, { value: startingPrice }))
        .to.be.revertedWithCustomError(auction, "SellerCannotBid");
      await expect(auction.settle(1)).to.be.revertedWithCustomError(auction, "AuctionStillActive");

      await movePastAuctionEnd();
      await expect(auction.connect(bidderTwo).bid(1, { value: startingPrice }))
        .to.be.revertedWithCustomError(auction, "AuctionNotActive");
      await auction.settle(1);
      await expect(auction.settle(1)).to.be.revertedWithCustomError(auction, "AuctionNotActive");
    });
  });
});
