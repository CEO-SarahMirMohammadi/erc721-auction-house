const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;

  console.log(`Deploying from ${deployer.address} on chain ${network.chainId}`);
  console.log(`Treasury: ${treasury}`);

  const Collection = await ethers.getContractFactory("NFTCollection");
  const collection = await Collection.deploy(
    "Auction House Collection",
    "AHN",
    1000,
    ethers.parseEther("0.01"),
    deployer.address
  );
  await collection.waitForDeployment();

  const Auction = await ethers.getContractFactory("EnglishAuction");
  const auction = await Auction.deploy(treasury);
  await auction.waitForDeployment();

  console.log(`NFTCollection: ${await collection.getAddress()}`);
  console.log(`EnglishAuction: ${await auction.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
