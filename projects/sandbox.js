const sdk = require("@defillama/sdk")
const BigNumber = require("bignumber.js")
const { unwrapUniswapLPs } = require("./helper/unwrapLPs");

// LP tokens staked on sushiswap (mainnet against weth)  
const SAND_WETH_LP_sushi = '0x3dd49f67e9d5bc4c5e6634b3f70bfd9dc1b6bd74'
const stakingContracts = [
  '0xeae6fd7d8c1740f3f1b03e9a5c35793cd260b9a6', // v2
  '0xce7467531f0fa949e6cd09a3b8f39e287eec33b8'  // v1
]

async function staking(timestamp, ethBlock, chainBlocks) { 
  // Sushiswap LP SAND/WETH staking
  const { output: SAND_WETH_LP_tokens } = await sdk.api.abi.multiCall({
    abi: 'erc20:balanceOf',
    calls: stakingContracts.map(a => ({target: SAND_WETH_LP_sushi, params: a})), 
    block: ethBlock, 
    chain: 'ethereum' 
  })
  const lpBalances = [
    { 'token': SAND_WETH_LP_sushi, 'balance': SAND_WETH_LP_tokens.reduce((acc, cur) => acc.plus(BigNumber(cur.output)), BigNumber(0)) }, 
  ]
  // console.log('Sushiswap SAND/WETH LP staked in staking contract', lpBalances[0]['balance'] / 1e18, )
  const balances = {}
  await unwrapUniswapLPs(balances, lpBalances, ethBlock);
  return balances
}

module.exports = {
  methodology: "TVL of Sandbox corresponds to staking which consists of SAND/WETYH sushi LP staked on mainnet two staking contracts",
  ethereum: {
    staking,
    tvl: () => ({})
  }
}
