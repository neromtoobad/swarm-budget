// Fund a testnet buyer wallet so it can pay Telegraph from escrow.
//   npm run fund                     show balances; mint 10 test USDC (open-mint token) if the wallet has < 5
//   npm run fund -- --deposit 2      also move 2 test USDC into the Telegraph escrow (approve + depositUSDC on the Diamond)
//   add --dry-run                    simulate the transactions instead of sending them
// Needs Sepolia ETH for gas (any faucet; ~0.01 is plenty). The escrow balance is read from the node's ledger.
import { createPublicClient, createWalletClient, http, formatEther, formatUnits, parseAbi, parseUnits } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const rpc = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const USDC = process.env.USDC || "0xcc194e1a843B658526D0D5C431f670028582Ae17";
const DIAMOND = process.env.DIAMOND || "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b";
const NODE = process.env.TELEGRAPH_NODE || "https://devnode.telegraphprotocol.com";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const depositArg = args.includes("--deposit") ? args[args.indexOf("--deposit") + 1] : null;

const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
const usdcAbi = parseAbi([
  "function mint(address,uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const diamondAbi = parseAbi(["function depositUSDC(uint256)"]);
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });

const show = async () => {
  const [eth, usdc] = await Promise.all([
    pub.getBalance({ address: account.address }),
    pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [account.address] }),
  ]);
  const ledger = await fetch(`${NODE}/v1/ledger/account/${account.address.toLowerCase()}`).then((r) => r.json()).catch(() => null);
  console.log(`${account.address}  ETH ${formatEther(eth)}  wallet USDC ${formatUnits(usdc, 6)}`);
  if (ledger) console.log(`escrow on the node: ${JSON.stringify(ledger)}`);
  return { eth, usdc };
};

// Simulate first (catches a revert before any gas is spent), then send unless --dry-run.
const send = async (label, req) => {
  const { request } = await pub.simulateContract({ account, ...req });
  if (dryRun) return console.log(`${label}: simulation OK (not sent, --dry-run)`);
  const hash = await wallet.writeContract(request);
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log(`${label}: ${rc.status} https://sepolia.etherscan.io/tx/${hash}`);
};

let { eth, usdc } = await show();
if (eth === 0n) {
  console.log("No Sepolia ETH yet: send ~0.01 from a faucet, then rerun `npm run fund`.");
  process.exit(0);
}
if (usdc < 5_000_000n) {
  await send("mint 10 test USDC", { address: USDC, abi: usdcAbi, functionName: "mint", args: [account.address, 10_000_000n] });
  if (!dryRun) ({ usdc } = await show());
}
if (depositArg) {
  const amount = parseUnits(String(depositArg), 6);
  if (!(amount > 0n)) throw new Error("--deposit needs an amount in USDC, e.g. --deposit 2");
  if (!dryRun && usdc < amount) throw new Error(`wallet holds ${formatUnits(usdc, 6)} test USDC, less than the ${depositArg} to deposit`);
  const allowance = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: "allowance", args: [account.address, DIAMOND] });
  if (allowance < amount) await send(`approve the escrow Diamond for ${depositArg} USDC`, { address: USDC, abi: usdcAbi, functionName: "approve", args: [DIAMOND, amount] });
  if (dryRun && allowance < amount) console.log("deposit: not simulated, it needs the approval above to be sent first");
  else await send(`deposit ${depositArg} USDC into escrow`, { address: DIAMOND, abi: diamondAbi, functionName: "depositUSDC", args: [amount] });
  if (!dryRun) {
    await new Promise((r) => setTimeout(r, 4000));
    await show();
  }
}
