# ERC-721 Auction House

A focused NFT marketplace for fixed-duration English auctions. Sellers deposit ERC-721 tokens into contract escrow, bidders compete with ETH, and the winner claims the NFT after the auction ends. Refunds, sale proceeds, and platform fees use pull-based withdrawals.

## Features

- ERC-721 collection with URI metadata, capped supply, configurable mint price, and owner withdrawal.
- English auctions with configurable starting price and duration.
- A minimum bid increment of 5% over the current highest bid.
- NFT escrow from listing through cancellation or settlement.
- Pull-payment refunds, seller proceeds, and treasury fees.
- Fixed platform fee of 2.5% of the winning bid.
- Seller cancellation before the first bid and no-bid settlement after expiry.
- Solidity custom errors, events, and reentrancy guards.

## Architecture

```text
Seller -> NFTCollection.approve(EnglishAuction, tokenId)
Seller -> EnglishAuction.createAuction(...) -> NFT held in escrow
Bidders -> EnglishAuction.bid(...) -> ETH accounted as highest bid
After expiry -> settle(...) -> NFT to winner; seller/treasury balances credited
Accounts -> withdraw() -> individually claim credited ETH
```

### Contracts

- `NFTCollection.sol`: ERC-721 collection built on OpenZeppelin `ERC721URIStorage` and `Ownable`. The owner configures mint price and withdraws paid mint proceeds.
- `EnglishAuction.sol`: Holds listed tokens in escrow, tracks auction state and bidder balances, applies the fee, and exposes withdrawals. The treasury address is immutable and set at deployment.

## Auction Lifecycle

1. The seller mints or owns an NFT and approves the auction contract for that token.
2. The seller creates an auction by selecting a starting price and duration. The NFT transfers into escrow immediately.
3. Bidders send ETH to `bid`. The first bid must meet the starting price. Later bids must be at least the current bid plus 5%, rounded up to the next wei.
4. When outbid, the prior leader's full bid becomes a withdrawable balance; no refund transfer occurs during bidding.
5. After expiry, anyone may call `settle`. With a bid, the winner receives the NFT and seller/treasury balances are credited. Without bids, the NFT returns to the seller.
6. A seller may cancel only before any bid. The seller, treasury, and outbid bidders call `withdraw` to claim their credited ETH.

## Security Considerations

- **Pull payments:** Refunds and sale proceeds are recorded as liabilities rather than sent during bids or settlement. This prevents a recipient's fallback behavior from blocking the auction, separates payment failures from core state transitions, and lets each account withdraw independently. A failed withdrawal reverts only that caller's transaction.
- **NFT escrow:** The auction contract takes custody when a listing is created. This prevents a seller from transferring the listed NFT elsewhere while bidders rely on the auction. The contract returns the token on cancellation/no-bid settlement or transfers it to the winner on settlement.
- **Platform fees:** The fee is 250 basis points (2.5%) of the winning bid. Integer division rounds the fee down to the nearest wei; the seller is credited with the remainder, so the two credits always sum to the winning bid. No fee is charged if the auction has no bids.
- **Reentrancy mitigation:** State changes and withdrawal-balance clearing happen before external calls, and the contracts guard minting, escrow operations, settlement, and withdrawals with OpenZeppelin `ReentrancyGuard`. Solidity's checked arithmetic also applies.
- **Cancellation after bids:** Sellers cannot cancel once bidding begins. This prevents a seller from invalidating a live competition after bidders have committed funds and preserves the auction's expectations for all participants.
- **Operational limits:** This example uses a single immutable treasury and a fixed fee, and does not implement pausing, emergency recovery, royalties, or upgradeability. Review and test contracts independently before handling valuable assets.

## Tech Stack

- Solidity 0.8.24
- Hardhat 2 and JavaScript
- OpenZeppelin Contracts 5
- Ethers 6, Chai, and Hardhat Toolbox

## Project Structure

```text
.
├── contracts/
│   ├── EnglishAuction.sol
│   └── NFTCollection.sol
├── scripts/
│   └── deploy.js
├── test/
│   └── AuctionHouse.js
├── .env.example
├── .gitignore
├── hardhat.config.js
├── package.json
├── README.md
└── requirements.txt
```

## Installation

Requires Node.js 18 or later and npm.

```bash
npm install
```

## Compile

```bash
npm run compile
```

## Test

```bash
npm test
```

The Hardhat suite covers minting and metadata, maximum supply and payment checks, listing and escrow, first bids and 5% increments, outbid refunds, settlement and fee accounting, no-bid settlement, cancellation, withdrawals, and invalid operations.

## Local Deployment

Start a local Hardhat JSON-RPC node in one terminal:

```bash
npx hardhat node
```

In another terminal, deploy to that node:

```bash
npm run deploy:local
```

The script prints deployed contract addresses. The local network's default deployer is used as collection owner and, unless configured otherwise, as treasury.

## Example Environment Configuration

Copy `.env.example` to `.env` and set the Sepolia RPC endpoint and deployer private key to deploy to Sepolia. Set `TREASURY_ADDRESS` to override the default treasury address. Keep `.env` private and never commit real keys.

```dotenv
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID
PRIVATE_KEY=0xyour_deployer_private_key
TREASURY_ADDRESS=0xYourTreasuryAddress
```

Then deploy with:

```bash
npm run deploy:sepolia
```

The Sepolia network configuration is enabled only when both `SEPOLIA_RPC_URL` and `PRIVATE_KEY` are set.

## Design Decisions

- A single collection contract demonstrates supply and mint-price controls without adding a factory.
- Each auction is independent and stored by monotonically increasing ID; the treasury is shared and immutable.
- Anyone can settle an expired auction, avoiding dependence on the seller or winner being online.
- ETH is credited using pull payments, while the NFT stays escrowed through the auction.
- The minimum increment is rounded up, preventing fractional-wei rounding from allowing a bid below 5%.
- `requirements.txt` is included as requested; Python dependencies are not used by this Solidity/Hardhat project.

## Future Improvements

- Add events or indexing-friendly views for auction discovery and pagination.
- Add configurable fee governance, pausing, and carefully scoped emergency procedures.
- Add royalty support and additional ERC-721 compatibility tests.
- Expand fuzzing, invariant testing, and testnet deployment automation.

## Resume-Ready Summary

Built a Solidity 0.8.24 ERC-721 English auction marketplace using Hardhat, JavaScript, and OpenZeppelin. Implemented NFT escrow, 5% bid increments, outbid refunds and proceeds through pull payments, 2.5% treasury fees, expiry settlement, seller cancellation rules, and reentrancy protections, with automated tests for core and invalid flows.
