// Show burner balances; if it has Sepolia ETH for gas and < 5 test USDC, mint 10 test USDC (open-mint token).
import { createPublicClient, createWalletClient, http, formatEther, formatUnits, parseAbi } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const rpc = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const USDC = process.env.USDC || "0xcc194e1a843B658526D0D5C431f670028582Ae17";
const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
const abi = parseAbi(["function mint(address,uint256)", "function balanceOf(address) view returns (uint256)"]);
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });

const show = async () => {
  const [eth, usdc] = await Promise.all([
    pub.getBalance({ address: account.address }),
    pub.readContract({ address: USDC, abi, functionName: "balanceOf", args: [account.address] }),
  ]);
  console.log(`${account.address}  ETH ${formatEther(eth)}  USDC ${formatUnits(usdc, 6)}`);
  return { eth, usdc };
};

const { eth, usdc } = await show();
if (eth === 0n) {
  console.log("No Sepolia ETH yet: send ~0.01 from a faucet, then rerun `npm run fund`.");
  process.exit(0);
}
if (usdc < 5_000_000n) {
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
  const hash = await wallet.writeContract({ address: USDC, abi, functionName: "mint", args: [account.address, 10_000_000n] });
  console.log("mint tx", hash);
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log("status", rc.status);
  await new Promise((r) => setTimeout(r, 4000));
  await show();
}
