const sdk = require("@defillama/sdk");
const { request, gql } = require("graphql-request");
const { BigNumber } = require("bignumber.js");
const utils = require('./helper/utils');


// Can retrieve https://strapi-matic.poly.market/markets?active=true&_sort=end_date:desc 
// Old graphql https://api.thegraph.com/subgraphs/name/tokenunion/polymarket-matic 
// New graphql https://api.thegraph.com/subgraphs/name/polymarket/matic-markets-5

// Useful resources : https://polymarketwhales.info/markets and https://polymarket.com/

// # block: { number: $block }
const graphUrl = 'https://api.thegraph.com/subgraphs/name/polymarket/matic-markets-5'
const graphQuery = gql`
query GET_POLYMARKET($skip: Int, $block: Int) {
    conditions(
      first: 1000
      skip: $skip
      block: { number: $block }
    ) { 
      id
      oracle
      questionId
      outcomeSlotCount
      resolutionTimestamp
      fixedProductMarketMakers(
        orderBy: creationTimestamp
      )
       {
        id
        creationTimestamp
        collateralToken {
          id name symbol decimals
        }
        liquidityParameter
        scaledLiquidityParameter
        collateralVolume
        scaledCollateralVolume
      }
    }  
}
`;
const {sumTokens} = require('./helper/unwrapLPs')

async function getMarketsLiquidity_graphql(timestamp, block, chainBlocks) {
  let scaledLiquidityParameterSum = BigNumber(0)
  let skip = 0
  const balances = {}
  // Continue querying graph while end not reached. Hard cap: skip = 5000
  while (skip !== -1) { 
    const { conditions } = await request(
      graphUrl,
      graphQuery, 
      {skip, block}
    );
    console.log(`${conditions && conditions.length} conditions found for skip: ${skip}`)
    skip += 1000
    if (conditions && conditions.length > 0) {
      conditions.forEach(condition => {
        condition.fixedProductMarketMakers.forEach(fpmm => {
          scaledLiquidityParameterSum = scaledLiquidityParameterSum.plus(BigNumber(fpmm.scaledLiquidityParameter))
          const collat = 'polygon:' + fpmm.collateralToken.id
          balances[collat] = (balances[collat] ? BigNumber(balances[collat]).plus(BigNumber(fpmm.liquidityParameter)) : BigNumber(fpmm.liquidityParameter)).toFixed(0)
          // TODO: FIND THE MISSING USDC! NOT CORRECT TO TAKE VOLUME
          fpmm.collateralVolume = fpmm.collateralVolume < 0? 0 : fpmm.collateralVolume
          // balances[collat] = (balances[collat] ? BigNumber(balances[collat]).plus(BigNumber(fpmm.collateralVolume)) : BigNumber(fpmm.collateralVolume)).toFixed(0)
          // balances[collat] = BigNumber(balances[collat] | 0).plus(BigNumber(fpmm.collateralVolume | 0)).toFixed(0)
        })
      })
    } 
    else {
      // Stop criteria: no conditions returned by graphql api
      skip = -1
    }
  }
  console.log(`${scaledLiquidityParameterSum.div(1e6).toFixed(2)}M scaledLiquidityParameterSum to compare to balances`, balances)
  return balances
  // return scaledLiquidityParameterSum
}

// After a market resolves, then the winning market participants can withdraw their share based on the redemption rate and their contribution at the closing of the market. All participants do not do it immediately though, so volume of every market should be accounted for in TVL
// const polymarket_api_url = 'https://strapi-matic.poly.market/markets?_limit=-1&_sort=closed_time:desc' // &active=true

const conditionalTokensContract = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045'
const polygonUsdcContract = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
const polymarket_api_url = 'https://strapi-matic.poly.market/markets?_limit=-1&_sort=volume:desc' // &active=true
async function getMarketsLiquidity_api() {
  let markets = await utils.fetchURL(polymarket_api_url)
  // Filter out unwanted fields
  markets = markets.data.map(({ id, slug, volume, liquidity, created_at, closed }) => ({id, slug, volume, liquidity, created_at, closed})); 
  markets.forEach(market => {
    market.volume = Number(market.volume) || 0
    market.liquidity = Number(market.liquidity) || 0
    if (market.liquidity < 0) market.liquidity = 0
  }); 
  const marketsLiquidity = markets.reduce((acc, market) => acc.plus(BigNumber(market.liquidity)), BigNumber(0)); 
  return marketsLiquidity
}

async function polygon(timestamp, block, chainBlocks) {
  // Get markets liquidity using API
  //const marketsLiquidity = (await getMarketsLiquidity_api()).times(1e6)
  let balances_fpmmLiquidity = (await getMarketsLiquidity_graphql(timestamp, block, chainBlocks)) // marketsLiquidity.times(1e6)

  console.log(`test using strapi-api: ${BigNumber(await getMarketsLiquidity_api()).div(1e6).toFixed(2)}M`)

  // Also account for USDC held in the conditional tokens contract because a lot of positions are held outside of the LPs
  // Corresponds to open positions that should be counted as TVL (since they still represent USDC locked into the conditional tokens contract)
  
  let conditionalTokensUSDC = await sdk.api.erc20.balanceOf({
    target: polygonUsdcContract,
    owner: conditionalTokensContract,
    block: chainBlocks['polygon'],
    chain: 'polygon'
  })
  console.log(`balanceOf USDC in conditional contract: ${BigNumber(conditionalTokensUSDC.output).div(1e12).toFixed(2)}M`)

  //balances = {}
  const balances_conditionalContract = {}
  await sumTokens(balances_conditionalContract, [[polygonUsdcContract, conditionalTokensContract]], chainBlocks.polygon, 'polygon', addr=>`polygon:${addr}`)
  console.log('balances_fpmmLiquidity', balances_fpmmLiquidity)
  console.log('balances_conditionalContract', balances_conditionalContract)

  // balances = {k: balances_fpmmLiquidity.get(k, 0) + balances_conditionalContract.get(k, 0) for k in set(balances_fpmmLiquidity) | set(balances_conditionalContract)}

  //conditionalTokensUSDC = BigNumber(conditionalTokensUSDC.output)

  // Total open interest: the conditional tokens are held at 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045 and then each market has it's own contract, the address of which is the id of the FixedProductMarketMaker
  //const tvl = marketsLiquidity.plus(conditionalTokensUSDC).toFixed(0)
  //console.log(`-----\n${marketsLiquidity.div(1e12).toFixed(8)}M of marketsLiquidity \n${conditionalTokensUSDC.div(1e12).toFixed(8)}M of conditionalTokensUSDC \nTVL: ${BigNumber(tvl).div(1e12).toFixed(2)}M\n`)
  // return {['polygon:' + polygonUsdcContract]: conditionalTokensUSDC.output}
  return balances
}


module.exports = {
  polygon: {
    tvl: polygon
  },
  methodology: `TVL is the total quantity of USDC held in the conditional tokens contract as well as USDC collateral submitted to every polymarket' markets ever opened - once the markets resolve, participants can withdraw theire share given the redeption rate and their input stake, but they do not all do it.`
}
