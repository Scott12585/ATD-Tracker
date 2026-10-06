/***************************************************************
 * NFL RESEARCH MODEL EXPANSION — PHASE 2
 * -------------------------------------------------------------
 * Position-specific QB / RB / TE research model using the FTN
 * tables confirmed by the Phase 1 discovery test.
 *
 * SAFE / ISOLATED:
 * - Does not replace the working WR model.
 * - Does not change the existing Supabase sync.
 * - Writes only to: Player Research Expansion
 *
 * RUN:
 *   buildPlayerResearchExpansion()
 *
 * OUTPUT SCORES (0-100):
 * QB: Pass TD, Pass Yards, Rush TD, Rush Yards, Overall TD
 * RB: Rush TD, Rush Yards, Receiving, Overall TD, Yardage
 * TE: Receiving TD, Receiving Yards, Overall TD, Yardage
 ***************************************************************/

const RESEARCH_EXPANSION = {
  SHEET: 'Player Research Expansion',
  PAGE_SIZE: 500,
  SEASON_TYPE: 'REG'
};

function buildPlayerResearchExpansion() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const season = NFL.SEASON;

  console.log('========================================');
  console.log('BUILDING QB / RB / TE RESEARCH MODEL');
  console.log('Season: ' + season);
  console.log('========================================');

  const tables = {
    passOverview: fetchFTNExpansionTable_('passing', 'overview'),
    passEfficiency: fetchFTNExpansionTable_('passing', 'efficiency'),
    passAnalytics: fetchFTNExpansionTable_('passing', 'analytics'),
    passPressure: fetchFTNExpansionTable_('passing', 'pressure'),

    rushOverview: fetchFTNExpansionTable_('rushing', 'overview'),
    rushUsage: fetchFTNExpansionTable_('rushing', 'usage'),
    rushEfficiency: fetchFTNExpansionTable_('rushing', 'efficiency'),
    rushAnalytics: fetchFTNExpansionTable_('rushing', 'analytics'),

    recUsage: fetchFTNExpansionTable_('receiving', 'usage'),
    recOverview: fetchFTNExpansionTable_('receiving', 'overview'),
    recEfficiency: fetchFTNExpansionTable_('receiving', 'efficiency'),
    recAnalytics: fetchFTNExpansionTable_('receiving', 'analytics'),
    recAir: fetchFTNExpansionTable_('receiving', 'air-yards')
  };

  const players = mergeExpansionPlayers_(tables);
  const scored = scoreExpansionPlayers_(players);
  writeExpansionSheet_(ss, scored, season);

  console.log('Players written: ' + scored.length);
  console.log('QB: ' + scored.filter(x => x.position === 'QB').length);
  console.log('RB: ' + scored.filter(x => x.position === 'RB').length);
  console.log('TE: ' + scored.filter(x => x.position === 'TE').length);
  console.log('BUILD COMPLETE');
  console.log('========================================');

  return scored;
}

function fetchFTNExpansionTable_(category, table) {
  const url =
    'https://stats.ftnfantasy.com/api/v1/stats/categories/' +
    encodeURIComponent(category) + '/tables/' +
    encodeURIComponent(table) + '?season=' +
    encodeURIComponent(NFL.SEASON) +
    '&seasonType=' + RESEARCH_EXPANSION.SEASON_TYPE +
    '&qualified=true&page=1&pageSize=' + RESEARCH_EXPANSION.PAGE_SIZE;

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: { Accept: 'application/json' }
  });

  const status = response.getResponseCode();
  if (status !== 200) {
    throw new Error(
      'FTN request failed: ' + category + '/' + table +
      ' (' + status + ') ' + response.getContentText().slice(0, 300)
    );
  }

  const json = JSON.parse(response.getContentText());
  const rows = json && json.data && Array.isArray(json.data.rows)
    ? json.data.rows : [];

  console.log(category + '/' + table + ': ' + rows.length + ' rows');
  return rows;
}

function mergeExpansionPlayers_(tables) {
  const map = {};

  function addRows(rows, prefix) {
    rows.forEach(row => {
      const position = normalizePosition(row.position);
      if (!['QB', 'RB', 'TE'].includes(position)) return;

      const id = String(row.playerId || row.entityId || row.playerName || '');
      if (!id) return;

      if (!map[id]) {
        map[id] = {
          playerId: row.playerId || row.entityId || '',
          playerName: row.playerName || row.entityName || '',
          team: row.team || '',
          teamId: row.teamId || '',
          position: position,
          stats: {}
        };
      }

      // Keep current identity values when present.
      if (row.playerName) map[id].playerName = row.playerName;
      if (row.team) map[id].team = row.team;
      if (row.teamId) map[id].teamId = row.teamId;
      map[id].position = position;

      Object.keys(row).forEach(key => {
        if (key.indexOf('nfl.') === 0) {
          map[id].stats[key] = row[key];
        }
      });
    });
  }

  addRows(tables.passOverview, 'passOverview');
  addRows(tables.passEfficiency, 'passEfficiency');
  addRows(tables.passAnalytics, 'passAnalytics');
  addRows(tables.passPressure, 'passPressure');
  addRows(tables.rushOverview, 'rushOverview');
  addRows(tables.rushUsage, 'rushUsage');
  addRows(tables.rushEfficiency, 'rushEfficiency');
  addRows(tables.rushAnalytics, 'rushAnalytics');
  addRows(tables.recUsage, 'recUsage');
  addRows(tables.recOverview, 'recOverview');
  addRows(tables.recEfficiency, 'recEfficiency');
  addRows(tables.recAnalytics, 'recAnalytics');
  addRows(tables.recAir, 'recAir');

  return Object.values(map);
}

function scoreExpansionPlayers_(players) {
  const groups = {
    QB: players.filter(p => p.position === 'QB'),
    RB: players.filter(p => p.position === 'RB'),
    TE: players.filter(p => p.position === 'TE')
  };

  const output = [];

  Object.keys(groups).forEach(position => {
    const group = groups[position];
    const metricRanks = buildExpansionMetricRanks_(group);

    group.forEach(player => {
      let scores;
      if (position === 'QB') scores = scoreQBExpansion_(player, metricRanks);
      if (position === 'RB') scores = scoreRBExpansion_(player, metricRanks);
      if (position === 'TE') scores = scoreTEExpansion_(player, metricRanks);

      output.push(Object.assign({}, player, scores));
    });
  });

  output.sort((a, b) => {
    const posOrder = { QB: 1, RB: 2, TE: 3 };
    if (posOrder[a.position] !== posOrder[b.position]) {
      return posOrder[a.position] - posOrder[b.position];
    }
    return (b.overallTDScore || 0) - (a.overallTDScore || 0);
  });

  return output;
}

function buildExpansionMetricRanks_(players) {
  const keys = new Set();
  players.forEach(p => Object.keys(p.stats).forEach(k => keys.add(k)));

  const ranks = {};
  Array.from(keys).forEach(key => {
    const vals = players
      .map(p => numExpansion_(p.stats[key]))
      .filter(v => v !== null)
      .sort((a, b) => a - b);
    ranks[key] = vals;
  });
  return ranks;
}

function pctExpansion_(player, ranks, key, reverse) {
  const value = numExpansion_(player.stats[key]);
  const vals = ranks[key] || [];
  if (value === null || !vals.length) return null;
  if (vals.length === 1) return 50;

  let below = 0;
  let equal = 0;
  vals.forEach(v => {
    if (v < value) below++;
    else if (v === value) equal++;
  });

  let pct = ((below + Math.max(0, equal - 1) / 2) / (vals.length - 1)) * 100;
  pct = Math.max(0, Math.min(100, pct));
  return reverse ? 100 - pct : pct;
}

function weightedExpansionScore_(items) {
  let total = 0;
  let weight = 0;
  items.forEach(item => {
    if (item.value === null || item.value === undefined || isNaN(item.value)) return;
    total += item.value * item.weight;
    weight += item.weight;
  });
  return weight ? Math.round((total / weight) * 10) / 10 : '';
}

function P_(p, r, key, weight, reverse) {
  return { value: pctExpansion_(p, r, key, !!reverse), weight: weight };
}

function scoreQBExpansion_(p, r) {
  const passTD = weightedExpansionScore_([
    P_(p,r,'nfl.passing.touchdowns',20),
    P_(p,r,'nfl.passing.touchdown_throw_rate',25),
    P_(p,r,'nfl.passing.explosive_throw_rate',10),
    P_(p,r,'nfl.passing.epa_per_dropback',15),
    P_(p,r,'nfl.passing.success_rate',10),
    P_(p,r,'nfl.passing.yards_per_attempt_over_expected',10),
    P_(p,r,'nfl.passing.turnover_worthy_throw_rate',10,true)
  ]);

  const passYards = weightedExpansionScore_([
    P_(p,r,'nfl.passing.yards',15),
    P_(p,r,'nfl.passing.attempts',15),
    P_(p,r,'nfl.passing.yards_per_attempt',15),
    P_(p,r,'nfl.passing.adjusted_completion_pct',15),
    P_(p,r,'nfl.passing.epa_per_dropback',10),
    P_(p,r,'nfl.passing.completion_pct_over_expected',10),
    P_(p,r,'nfl.passing.yards_per_attempt_over_expected',15),
    P_(p,r,'nfl.passing.sack_rate',5,true)
  ]);

  const rushTD = weightedExpansionScore_([
    P_(p,r,'nfl.rushing.touchdowns',30),
    P_(p,r,'nfl.rushing.attempt_share',20),
    P_(p,r,'nfl.rushing.opportunity_share',15),
    P_(p,r,'nfl.rushing.attempts',15),
    P_(p,r,'nfl.rushing.success_rate',10),
    P_(p,r,'nfl.rushing.epa_per_attempt',10)
  ]);

  const rushYards = weightedExpansionScore_([
    P_(p,r,'nfl.rushing.yards',20),
    P_(p,r,'nfl.rushing.attempts',15),
    P_(p,r,'nfl.rushing.yards_per_attempt',15),
    P_(p,r,'nfl.rushing.rush_yards_over_expected_per_attempt',20),
    P_(p,r,'nfl.rushing.explosive_run_pct',15),
    P_(p,r,'nfl.rushing.success_rate',15)
  ]);

  return {
    passTDScore: passTD,
    passYardScore: passYards,
    rushTDScore: rushTD,
    rushYardScore: rushYards,
    receivingScore: '',
    receivingTDScore: '',
    receivingYardScore: '',
    overallTDScore: weightedExpansionScore_([
      { value: passTD, weight: 65 },
      { value: rushTD, weight: 35 }
    ]),
    yardageScore: weightedExpansionScore_([
      { value: passYards, weight: 75 },
      { value: rushYards, weight: 25 }
    ])
  };
}

function scoreRBExpansion_(p, r) {
  const rushTD = weightedExpansionScore_([
    P_(p,r,'nfl.rushing.touchdowns',25),
    P_(p,r,'nfl.rushing.attempt_share',20),
    P_(p,r,'nfl.rushing.touch_share',15),
    P_(p,r,'nfl.rushing.opportunity_share',20),
    P_(p,r,'nfl.rushing.success_rate',10),
    P_(p,r,'nfl.rushing.epa_per_attempt',10)
  ]);

  const rushYards = weightedExpansionScore_([
    P_(p,r,'nfl.rushing.yards',15),
    P_(p,r,'nfl.rushing.attempt_share',15),
    P_(p,r,'nfl.rushing.yards_per_attempt',15),
    P_(p,r,'nfl.rushing.rush_yards_over_expected_per_attempt',20),
    P_(p,r,'nfl.rushing.yards_after_contact',10),
    P_(p,r,'nfl.rushing.avoided_tackle_pct',10),
    P_(p,r,'nfl.rushing.explosive_run_pct',10),
    P_(p,r,'nfl.rushing.stuffed_run_pct',5,true)
  ]);

  const recTD = weightedExpansionScore_([
    P_(p,r,'nfl.receiving.touchdowns',25),
    P_(p,r,'nfl.receiving.target_share',20),
    P_(p,r,'nfl.receiving.route_participation',15),
    P_(p,r,'nfl.receiving.first_read_target_rate',15),
    P_(p,r,'nfl.receiving.target_per_route',10),
    P_(p,r,'nfl.receiving.epa_target',10),
    P_(p,r,'nfl.receiving.separation_rate',5)
  ]);

  const recYards = weightedExpansionScore_([
    P_(p,r,'nfl.receiving.yards',15),
    P_(p,r,'nfl.receiving.target_share',15),
    P_(p,r,'nfl.receiving.route_participation',10),
    P_(p,r,'nfl.receiving.yards_per_route_run',20),
    P_(p,r,'nfl.receiving.target_per_route',10),
    P_(p,r,'nfl.receiving.yards_over_expectation',10),
    P_(p,r,'nfl.receiving.air_yards_share',10),
    P_(p,r,'nfl.receiving.wopr',10)
  ]);

  return {
    passTDScore: '',
    passYardScore: '',
    rushTDScore: rushTD,
    rushYardScore: rushYards,
    receivingScore: weightedExpansionScore_([
      { value: recTD, weight: 45 }, { value: recYards, weight: 55 }
    ]),
    receivingTDScore: recTD,
    receivingYardScore: recYards,
    overallTDScore: weightedExpansionScore_([
      { value: rushTD, weight: 70 }, { value: recTD, weight: 30 }
    ]),
    yardageScore: weightedExpansionScore_([
      { value: rushYards, weight: 70 }, { value: recYards, weight: 30 }
    ])
  };
}

function scoreTEExpansion_(p, r) {
  const recTD = weightedExpansionScore_([
    P_(p,r,'nfl.receiving.touchdowns',20),
    P_(p,r,'nfl.receiving.target_share',20),
    P_(p,r,'nfl.receiving.target_rate',10),
    P_(p,r,'nfl.receiving.route_participation',15),
    P_(p,r,'nfl.receiving.first_read_target_rate',15),
    P_(p,r,'nfl.receiving.target_per_route',10),
    P_(p,r,'nfl.receiving.epa_target',5),
    P_(p,r,'nfl.receiving.separation_rate',5)
  ]);

  const recYards = weightedExpansionScore_([
    P_(p,r,'nfl.receiving.yards',15),
    P_(p,r,'nfl.receiving.target_share',15),
    P_(p,r,'nfl.receiving.route_participation',10),
    P_(p,r,'nfl.receiving.yards_per_route_run',20),
    P_(p,r,'nfl.receiving.target_per_route',10),
    P_(p,r,'nfl.receiving.air_yards_share',10),
    P_(p,r,'nfl.receiving.average_depth_of_target',5),
    P_(p,r,'nfl.receiving.wopr',10),
    P_(p,r,'nfl.receiving.yards_over_expectation',5)
  ]);

  return {
    passTDScore: '',
    passYardScore: '',
    rushTDScore: '',
    rushYardScore: '',
    receivingScore: weightedExpansionScore_([
      { value: recTD, weight: 45 }, { value: recYards, weight: 55 }
    ]),
    receivingTDScore: recTD,
    receivingYardScore: recYards,
    overallTDScore: recTD,
    yardageScore: recYards
  };
}

function writeExpansionSheet_(ss, players, season) {
  let sheet = ss.getSheetByName(RESEARCH_EXPANSION.SHEET);
  if (!sheet) sheet = ss.insertSheet(RESEARCH_EXPANSION.SHEET);
  sheet.clear();

  const headers = [
    'Season','Position','Player','Team','Player ID','Games',
    'Overall TD Score','Yardage Score',
    'Pass TD Score','Pass Yards Score','Rush TD Score','Rush Yards Score',
    'Receiving Score','Receiving TD Score','Receiving Yards Score',
    'Pass Yards','Pass TD','TD Throw Rate','EPA / Dropback','CPOE','Pressure Rate',
    'Rush Attempts','Rush Yards','Rush TD','Rush Attempt Share','Rush Opportunity Share','RYOE / Att',
    'Targets','Receptions','Rec Yards','Rec TD','Target Share','Route Participation','First Read Rate','YPRR','WOPR','Air Yards Share'
  ];

  const rows = players.map(p => {
    const s = p.stats;
    return [
      season,p.position,p.playerName,p.team,p.playerId,
      firstExpansion_(s['nfl.passing.games'],s['nfl.rushing.games'],s['nfl.receiving.games']),
      p.overallTDScore,p.yardageScore,
      p.passTDScore,p.passYardScore,p.rushTDScore,p.rushYardScore,
      p.receivingScore,p.receivingTDScore,p.receivingYardScore,
      valExpansion_(s['nfl.passing.yards']),valExpansion_(s['nfl.passing.touchdowns']),
      valExpansion_(s['nfl.passing.touchdown_throw_rate']),valExpansion_(s['nfl.passing.epa_per_dropback']),
      valExpansion_(s['nfl.passing.completion_pct_over_expected']),valExpansion_(s['nfl.passing.rate_pressured_dropback']),
      valExpansion_(s['nfl.rushing.attempts']),valExpansion_(s['nfl.rushing.yards']),valExpansion_(s['nfl.rushing.touchdowns']),
      valExpansion_(s['nfl.rushing.attempt_share']),valExpansion_(s['nfl.rushing.opportunity_share']),
      valExpansion_(s['nfl.rushing.rush_yards_over_expected_per_attempt']),
      valExpansion_(s['nfl.receiving.targets']),valExpansion_(s['nfl.receiving.receptions']),
      valExpansion_(s['nfl.receiving.yards']),valExpansion_(s['nfl.receiving.touchdowns']),
      valExpansion_(s['nfl.receiving.target_share']),valExpansion_(s['nfl.receiving.route_participation']),
      valExpansion_(s['nfl.receiving.first_read_target_rate']),valExpansion_(s['nfl.receiving.yards_per_route_run']),
      valExpansion_(s['nfl.receiving.wopr']),valExpansion_(s['nfl.receiving.air_yards_share'])
    ];
  });

  sheet.getRange(1,1,1,headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2,1,rows.length,headers.length).setValues(rows);

  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,headers.length)
    .setFontWeight('bold')
    .setBackground('#1f4e78')
    .setFontColor('#ffffff');

  if (rows.length) {
    // Scores.
    sheet.getRange(2,7,rows.length,9).setNumberFormat('0.0');
    // Percentage/rate fields.
    [18,20,21,25,26,32,33,34,36,37].forEach(col => {
      sheet.getRange(2,col,rows.length,1).setNumberFormat('0.0%');
    });
    sheet.getRange(1,1,rows.length + 1,headers.length).createFilter();
  }

  sheet.autoResizeColumns(1, headers.length);
  sheet.setColumnWidth(3, 180);
  sheet.setColumnWidth(4, 160);
}

function numExpansion_(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return isFinite(n) ? n : null;
}

function valExpansion_(value) {
  const n = numExpansion_(value);
  return n === null ? '' : n;
}

function firstExpansion_() {
  for (let i = 0; i < arguments.length; i++) {
    const n = numExpansion_(arguments[i]);
    if (n !== null) return n;
  }
  return '';
}

/***************************************************************
 * QUICK VALIDATION
 * -------------------------------------------------------------
 * Run after buildPlayerResearchExpansion(). It logs the top 5
 * players at each position by Overall TD Score and Yardage Score.
 ***************************************************************/
function testPlayerResearchExpansion() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RESEARCH_EXPANSION.SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    throw new Error('Run buildPlayerResearchExpansion() first.');
  }

  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  const idx = {};
  headers.forEach((h,i) => idx[h] = i);

  ['QB','RB','TE'].forEach(pos => {
    const rows = data.filter(r => r[idx['Position']] === pos);

    const td = rows.slice().sort((a,b) => Number(b[idx['Overall TD Score']] || 0) - Number(a[idx['Overall TD Score']] || 0)).slice(0,5);
    const yd = rows.slice().sort((a,b) => Number(b[idx['Yardage Score']] || 0) - Number(a[idx['Yardage Score']] || 0)).slice(0,5);

    console.log('----------------------------------------');
    console.log(pos + ' TOP 5 — OVERALL TD SCORE');
    td.forEach(r => console.log(r[idx['Player']] + ' | ' + r[idx['Team']] + ' | ' + r[idx['Overall TD Score']]));
    console.log(pos + ' TOP 5 — YARDAGE SCORE');
    yd.forEach(r => console.log(r[idx['Player']] + ' | ' + r[idx['Team']] + ' | ' + r[idx['Yardage Score']]));
  });

  console.log('VALIDATION COMPLETE');
}
