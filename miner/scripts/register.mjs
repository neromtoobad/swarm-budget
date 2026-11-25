// Register (or update) the miner on the Telegraph Diamond, Ethereum Sepolia testnet.
//
//   node --env-file=../.env scripts/register.mjs --yaml-url <https url of the YAML> --dry-run
//   node --env-file=../.env scripts/register.mjs --yaml-url <url>                 register
//   node --env-file=../.env scripts/register.mjs --yaml-url <url> --update <id>   replace registration <id>
//
// It checks before it spends: the hosted YAML must match the local file byte for byte, every intent
// must be canonical on-chain, the id and slug must be free on the node, and the call is simulated first.
// The bond (1 USDC for the first intent, 0.10 for each further one) is taken in test USDC and comes
// back on deregistration.
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, decodeEventLog } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const rpc = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const USDC = process.env.USDC || "0xcc194e1a843B658526D0D5C431f670028582Ae17";
const DIAMOND = process.env.DIAMOND || "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b";
const NODE = process.env.TELEGRAPH_NODE || "https://devnode.telegraphprotocol.com";
const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const dryRun = args.includes("--dry-run");
const yamlUrl = arg("--yaml-url");
const updateId = arg("--update");
const MIN_PRICE = 10000n; // 0.01 USDC, the network floor
if (!yamlUrl) throw new Error("--yaml-url is required");

const local = readFileSync(new URL("../pinpoint-weather.yaml", import.meta.url));
const hosted = Buffer.from(await (await fetch(yamlUrl)).arrayBuffer());
const sha = (b) => `0x${createHash("sha256").update(b).digest("hex")}`;
if (sha(local) !== sha(hosted)) throw new Error(`The hosted YAML differs from the local file.\n local  ${sha(local)}\n hosted ${sha(hosted)}`);
const yamlHash = sha(hosted);
const text = local.toString("utf8");
const id = text.match(/^id:\s*(\d+)/m)[1];
const slug = text.match(/^slug:\s*([a-z0-9-]+)/m)[1];
const intents = [...text.split(/^semantics:/m)[1].matchAll(/^\s+-\s+([A-Z_]+)\s*$/gm)].map((m) => m[1]);
console.log(`YAML ${yamlUrl}\n sha256 ${yamlHash}\n id ${id}  slug ${slug}\n intents ${intents.join(", ")}`);

const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const diamond = parseAbi([
  "function isCanonicalIntent(string) view returns (bool)",
  "function quoteMinerBond(uint256) view returns (uint256,uint256)",
  "function minerBondOf(address) view returns (uint256,uint256,uint256)",
  "function registerMiner(string,bytes32,address,uint256,string[]) returns (uint256)",
  "function updateMiner(uint256,string,bytes32,address,uint256,string[]) returns (uint256)",
  "event MinerRegistered(uint256 indexed registrationId, address indexed miner, string yamlUrl, bytes32 yamlHash, address feeAddress, uint256 minPriceUsdc, string[] supportedIntents)",
]);
const read = (functionName, a = []) => pub.readContract({ address: DIAMOND, abi: diamond, functionName, args: a });

for (const i of intents) if (!(await read("isCanonicalIntent", [i]))) throw new Error(`${i} is not a canonical intent on this Diamond`);
console.log("every intent is canonical on-chain");

const live = await fetch(`${NODE}/api/miners`).then((r) => r.json());
const clash = live.filter((m) => (String(m.id) === id || m.slug === slug) && String(m.wallet_address ?? "").toLowerCase() !== account.address.toLowerCase());
if (clash.length) throw new Error(`id or slug already used by another wallet: ${clash.map((m) => `${m.id}/${m.slug}`).join(", ")}`);
console.log("id and slug are free on the node (or already ours)");

const [bondIntents, bondUsd] = await read("minerBondOf", [account.address]);
const total = updateId ? BigInt(intents.length) : bondIntents + BigInt(intents.length);
const [needUsd] = await read("quoteMinerBond", [total]);
const short = needUsd > bondUsd ? needUsd - bondUsd : 0n;
const bal = await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [account.address] });
console.log(`bond: holds ${formatUnits(bondUsd, 6)} for ${bondIntents} intents; needs ${formatUnits(needUsd, 6)} for ${total}; this call takes ${formatUnits(short, 6)} test USDC (wallet has ${formatUnits(bal, 6)})`);
if (bal < short) throw new Error("not enough test USDC for the bond");

const send = async (label, req) => {
  if (dryRun) return console.log(`[dry run] would send: ${label}`);
  const hash = await wallet.writeContract(req);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label}: ${hash}`);
  return receipt;
};

const allowance = await pub.readContract({ address: USDC, abi: erc20, functionName: "allowance", args: [account.address, DIAMOND] });
if (allowance < short) await send("approve the bond", { address: USDC, abi: erc20, functionName: "approve", args: [DIAMOND, short] });

const fn = updateId ? "updateMiner" : "registerMiner";
const callArgs = updateId ? [BigInt(updateId), yamlUrl, yamlHash, account.address, MIN_PRICE, intents] : [yamlUrl, yamlHash, account.address, MIN_PRICE, intents];
if (dryRun && allowance < short) {
  console.log("[dry run] skipping the simulation: it needs the bond approval, which a dry run does not send");
  process.exit(0);
}
// The RPC can lag a block behind the approval it just confirmed, so give the simulation a few tries.
let sim;
for (let attempt = 1; ; attempt++) {
  try {
    sim = await pub.simulateContract({ address: DIAMOND, abi: diamond, functionName: fn, args: callArgs, account });
    break;
  } catch (e) {
    if (attempt >= 4) throw e;
    await new Promise((r) => setTimeout(r, 6000));
  }
}
console.log(`simulation ok: registration id would be ${sim.result}`);
const receipt = await send(fn, sim.request);
if (!receipt) process.exit(0);

let registrationId = sim.result;
for (const log of receipt.logs) {
  try {
    const ev = decodeEventLog({ abi: diamond, data: log.data, topics: log.topics });
    if (ev.eventName === "MinerRegistered") registrationId = ev.args.registrationId;
  } catch {}
}
console.log(`registered. registrationId ${registrationId}  tx https://sepolia.etherscan.io/tx/${receipt.transactionHash}`);
console.log(`The node reads Sepolia's safe block, so it activates in about 10 to 15 minutes. Check with:\n  curl -s ${NODE}/api/miners/${registrationId} | jq '.miner | {activation_status, rejection_reason}'`);
