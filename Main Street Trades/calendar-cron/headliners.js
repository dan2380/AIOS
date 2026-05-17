'use strict';

// Headliner universe — S&P 500 + Nasdaq 100 + Dow 30 plus a small allow-list
// of high-attention names that aren't (yet) in the indexes (DJT, RDDT,
// CRWV, SMCI's peers, etc.). Used to filter the weekly earnings preview to
// "names members actually care about" instead of every micro-cap reporting.
//
// Discipline: every name here should have $5B+ market cap OR be a top-50
// retail-attention symbol. Micro-caps and SPAC-shell names go elsewhere.
//
// Maintenance: refresh quarterly after index rebalances or whenever a major
// earnings name is missing from the post. Wikipedia constituents lists are
// the canonical source.

const HEADLINERS = new Set([
  // ---- Mega-cap ----
  'AAPL','MSFT','GOOGL','GOOG','AMZN','META','NVDA','TSLA','AVGO','BRK.B',

  // ---- Financials ----
  'JPM','BAC','WFC','GS','MS','C','BLK','SCHW','AXP','V','MA','PYPL',
  'USB','PNC','TFC','COF','BX','KKR','APO','ARES','AIG','MET','PRU','ALL',
  'TRV','PGR','CB','MMC','AON','MCO','SPGI','ICE','CME','NDAQ','LPLA','STT','BK',

  // ---- Tech & SaaS (large) ----
  'ORCL','CRM','ADBE','NOW','INTU','IBM','CSCO','QCOM','TXN','AMD','INTC','MU',
  'LRCX','KLAC','AMAT','MRVL','ADI','NXPI','ON','MCHP','PANW','CRWD','ZS','OKTA',
  'FTNT','DDOG','SNOW','MDB','NET','TEAM','SHOP','UBER','LYFT','DASH','ABNB',
  'BKNG','EXPE','PLTR','SNPS','CDNS','ANSS','FICO','GRMN','APH','FTV','KEYS',
  'WDAY','HUBS','VEEV','TYL','PTC','PCTY','PAYC','SPLK','BILL','TWLO','ZM',
  'DBX','BOX','ESTC','MNDY','TENB',

  // ---- Semiconductors (top tier) ----
  'TSM','ASML','SMCI','ARM','MPWR','SWKS','QRVO','WDC','STX','HPQ','DELL','NTAP','HPE',

  // ---- China / Asia ADRs ----
  'BABA','JD','PDD','BIDU','NIO','XPEV','LI','BILI','IQ','TME','TCEHY','SE','GRAB',
  'CPNG','MELI',

  // ---- Communication / media ----
  'NFLX','DIS','CMCSA','VZ','T','TMUS','CHTR','WBD','PARA','EA','TTWO','RBLX',
  'SPOT','PINS','SNAP','RDDT','MTCH',

  // ---- Consumer discretionary ----
  'HD','MCD','NKE','SBUX','LOW','TJX','MAR','HLT','RCL','CCL','NCLH','LULU',
  'TGT','COST','WMT','DG','DLTR','BBY','ROST','ULTA','LVS','WYNN','MGM','DKNG',
  'F','GM','RIVN','LCID','STLA','TM','HMC','PCAR',

  // ---- Consumer staples ----
  'PG','KO','PEP','MDLZ','MO','PM','KHC','CL','GIS','K','HSY','STZ','TAP',
  'BUD','CHD','CLX','EL',

  // ---- Energy ----
  'XOM','CVX','COP','SLB','EOG','MPC','PSX','VLO','OXY','HES','PXD','DVN','FANG',
  'OKE','KMI','WMB','TRGP','LNG','ET','BTU',

  // ---- Healthcare ----
  'UNH','JNJ','LLY','PFE','ABBV','MRK','ABT','TMO','DHR','ISRG','BMY','AMGN',
  'GILD','REGN','VRTX','BIIB','MRNA','ZTS','SYK','MDT','BSX','EW','BAX','BDX',
  'CI','HUM','ELV','CNC','MOH','HCA','UHS','DGX','LH','IDXX','IQV','CVS','WBA',
  'BNTX','BMRN','ALNY','LEGN',

  // ---- Industrials ----
  'BA','CAT','DE','HON','GE','LMT','RTX','NOC','GD','LHX','TDG','HEI','HWM',
  'UPS','FDX','CSX','UNP','NSC','ODFL','XPO','SAIA','JBHT','CHRW','EXPD','WAB',
  'UAL','DAL','AAL','LUV','MMM','EMR','ETN','ITW','PH','ROK','DOV','XYL','FAST',
  'GWW','PWR','URI','J','WM','RSG','WCN','PCAR',

  // ---- Materials ----
  'LIN','SHW','APD','ECL','FCX','NEM','GOLD','NUE','STLD','RS','PKG','IP','BLL',
  'ALB','MOS','CF','FMC','LYB','DOW','DD','EMN','PPG','CE','VMC','MLM',

  // ---- Real estate ----
  'PLD','AMT','CCI','EQIX','PSA','SPG','O','VICI','DLR','WELL','VTR','EXR',
  'ARE','BXP','HST',

  // ---- Utilities ----
  'NEE','SO','DUK','D','AEP','SRE','EXC','XEL','PEG','ED','EIX','WEC','ETR',
  'AWK','PCG','VST',

  // ---- High-attention non-index large caps ----
  'COIN','HOOD','MSTR','GBTC','IBIT','FBTC', // crypto vehicles, big AUM
  'DJT','RUM',                                // political-beta
  'CRWV','NBIS','APLD','IREN','VRT',         // AI infra
  'OKLO','SMR','LEU','CCJ',                   // nuclear / uranium (large enough)
  'HIMS','OSCR',                              // consumer health (mid-cap)
  'CART','RBLX','SOFI','AFRM','UPST',         // fintech mid-cap
  'TOST','CHWY','MELI','GTLB','S',            // recent IPOs that are mid+
  'BIRK','APP','GRAB','WIX','SQSP',
  'VST','TLN','CEG',                          // AI-power plays
  'PYPL','BLOCK','SQ',
]);

module.exports = { HEADLINERS };
