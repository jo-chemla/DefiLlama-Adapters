const sdk = require("@defillama/sdk");
const { getBlock } = require('../helper/getBlock');
const { chainExports } = require('../helper/exports');
const { request, gql } = require("graphql-request");
const { staking } = require('../helper/staking');

const AKRO_ethereum = '0x8ab7404063ec4dbcfd4598215992dc3f8ec853d7'
const AKRO_staking = '0x3501Ec11d205fa249f2C42f5470e137b529b35D0'

const thegraph_url = 'https://api.thegraph.com/subgraphs/name/'
const subgraphs = {
  ethereum: 'in19farkt/delphi-stable-mainnet',
  bsc: 'in19farkt/delphi-stable-mainnet-bsc',
  arbitrum: 'in19farkt/delphi-stable-mainnet-arbitrum',
}
const graphQuery = gql`
query GET_VORTEX ($block: Int) {
  basisVaults(
    first: 1000
    block: { number: $block }
  ) {
      id
      name
      isActive
  }
}`
const basisVault_want_abi = {"inputs":[],"name":"want","outputs":[{"internalType":"contract IERC20","name":"","type":"address"}],"stateMutability":"view","type":"function"}

function chainTvl(chain) {
  return async (timestamp, ethBlock, chainBlocks) => {
    const balances = {};
    const block = await getBlock(timestamp, chain, chainBlocks) - 500; // subgraphs out of sync
    const transformAddress = id=>`${chain}:${id}`;

    // Get vortex BasisVaults
    const { basisVaults } = await request(
      thegraph_url + subgraphs[chain],
      graphQuery, 
      {block}
    );
    const vaults = basisVaults.filter(v => v.isActive).map(v => v.id)
    
    // Get balance of wanted Tokens for each Basis Vault
    const tokensWanted = await sdk.api.abi.multiCall({
      calls: vaults.map(v => ({target: v})), 
      abi: basisVault_want_abi, 
      chain, 
      block
    })
    const vaultsBalances = await sdk.api.abi.multiCall({
      calls: tokensWanted.output.map((t, i) => ({target: t.output, params: vaults[i]})), 
      abi: 'erc20:balanceOf', 
      chain, 
      block
    })
    sdk.util.sumMultiBalanceOf(balances, vaultsBalances, true, transformAddress)
    
    return balances
  };
}

module.exports = chainExports(chainTvl, [
  'ethereum', 
  'bsc', 
  'arbitrum', 
]),
module.exports.ethereum.staking = staking(AKRO_staking, AKRO_ethereum, 'ethereum'),
module.exports.methodology = 'Hashflow TVL is made of all pools token balances. Pools and their tokens are retrieved by Hashflow HTTP REST API.'
