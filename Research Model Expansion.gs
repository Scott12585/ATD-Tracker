/***************************************************************
 * NFL RESEARCH MODEL EXPANSION — PHASE 3
 * -------------------------------------------------------------
 * Position-specific QB / RB / TE research model using the FTN
 * tables confirmed by the Phase 1 discovery test.
 *
 * SAFE / ISOLATED:
 * - Does not replace the working WR model.
 * - Does not change the existing Supabase sync.
 * - Writes only to: Player Research Expansion / Player Research Matchups
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
  logExpansionQBCoverage_(players);
  logExpansionCategoryCoverage_(players);
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
  // Fetch both populations for every category; false selects the
  // nonqualified group. The player merge deduplicates overlapping rows.
  const qualifiedRows = fetchFTNExpansionPopulation_(category, table, true);
  const otherRows = fetchFTNExpansionPopulation_(category, table, false);
  console.log(category+'/'+table+': combining '+qualifiedRows.length+
    ' qualified and '+otherRows.length+' nonqualified rows');
  return qualifiedRows.concat(otherRows);
}

function fetchFTNExpansionPopulation_(category, table, qualified) {
  const base =
    'https://stats.ftnfantasy.com/api/v1/stats/categories/' +
    encodeURIComponent(category) + '/tables/' + encodeURIComponent(table) +
    '?season=' + encodeURIComponent(NFL.SEASON) +
    '&seasonType=' + RESEARCH_EXPANSION.SEASON_TYPE +
    '&qualified=' + qualified + '&pageSize=' + RESEARCH_EXPANSION.PAGE_SIZE;
  const output = [], signatures = new Set();
  for (let page = 1; page <= 40; page++) {
    const response = UrlFetchApp.fetch(base + '&page=' + page, {
      method: 'get', muteHttpExceptions: true, headers: { Accept: 'application/json' }
    });
    const status = response.getResponseCode();
    if (status !== 200) throw new Error('FTN request failed: '+category+'/'+table+
      ' page '+page+' ('+status+') '+response.getContentText().slice(0,300));
    const json = JSON.parse(response.getContentText());
    if (!json || !json.data || !Array.isArray(json.data.rows)) {
      throw new Error('Unexpected FTN rows response: '+category+'/'+table);
    }
    const rows = json.data.rows;
    if (!rows.length) break;
    const signature = JSON.stringify(rows);
    if (signatures.has(signature)) throw new Error('FTN pagination repeated a page: '+category+'/'+table);
    signatures.add(signature);
    output.push.apply(output,rows);
    if (rows.length < RESEARCH_EXPANSION.PAGE_SIZE) break;
    if (page === 40) throw new Error('FTN pagination limit reached: '+category+'/'+table);
  }
  console.log(category+'/'+table+': '+output.length+' rows; qualified='+qualified+
    '; QB rows='+output.filter(r => normalizePosition(r.position) === 'QB').length);
  return output;
}

function expansionIdentityName_(row, position) {
  const name = String(row.playerName || row.entityName || '').trim().toLowerCase()
    .replace(/[.']/g,'').replace(/\s+/g,' ');
  const team = normalizeNFLTeam(row.team || '');
  return name && team ? name+'|'+position+'|'+team : '';
}

function mergeExpansionPlayers_(tables) {
  const players = [], ids = {}, names = {};
  function addRows(rows, source) {
    rows.forEach(row => {
      const position = normalizePosition(row.position);
      if (!['QB','RB','TE'].includes(position)) return;
      const rawId = row.playerId || row.entityId || '';
      const id = rawId === '' ? '' : String(rawId)+'|'+position;
      const nameKey = expansionIdentityName_(row,position);
      if (!id && !nameKey) return;
      let player = id ? ids[id] : null;
      // A name fallback requires matching position and normalized team.
      // Never join on a short/display name alone.
      if (!player && nameKey && names[nameKey]) player = names[nameKey];
      if (player && nameKey && names[nameKey] && names[nameKey] !== player) {
        throw new Error('Ambiguous FTN identity: '+nameKey+' in '+source);
      }
      if (!player) {
        player = {playerId:rawId, playerName:row.playerName || row.entityName || '',
          team:row.team || '', teamId:row.teamId || '', position:position, stats:{}, sources:{}};
        players.push(player);
      }
      if (id) ids[id] = player;
      if (nameKey) names[nameKey] = player;
      if (row.playerName || row.entityName) player.playerName = row.playerName || row.entityName;
      if (row.team) player.team = row.team;
      if (row.teamId) player.teamId = row.teamId;
      player.sources[source] = true;
      Object.keys(row).forEach(key => {
        // Missing fields in another table must not erase populated values.
        if (key.indexOf('nfl.') === 0 && numExpansion_(row[key]) !== null) player.stats[key] = row[key];
      });
    });
  }
  Object.keys(tables).forEach(source => addRows(tables[source],source));
  return players;
}

function logExpansionQBCoverage_(players) {
  const qbs = players.filter(p => p.position === 'QB');
  console.log('QB COVERAGE: '+qbs.length+' merged QBs');
  ['nfl.rushing.attempts','nfl.rushing.yards','nfl.rushing.touchdowns'].forEach(key => {
    const covered = qbs.filter(p => numExpansion_(p.stats[key]) !== null);
    console.log(key+': '+covered.length+'/'+qbs.length+' QBs');
    const missing = qbs.filter(p => numExpansion_(p.stats[key]) === null);
    if (missing.length) console.log('Missing '+key+': '+missing.map(p => p.playerName+' ('+p.team+')').join(', '));
  });
  qbs.forEach(p => console.log('QB SOURCE: '+p.playerName+' | '+p.team+' | rush attempts '+
    valExpansion_(p.stats['nfl.rushing.attempts'])+' | rush TD '+valExpansion_(p.stats['nfl.rushing.touchdowns'])+
    ' | '+Object.keys(p.sources || {}).join(', ')));
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
    if (item.value === null || item.value === undefined || item.value === '' || !isFinite(Number(item.value))) return;
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
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.clear();

  const headers = [
    'Season','Position','Player','Team','Player ID','Games',
    'Overall TD Score','Yardage Score',
    'Pass TD Score','Pass Yards Score','Rush TD Score','Rush Yards Score',
    'Receiving Score','Receiving TD Score','Receiving Yards Score',
    'Pass Yards','Pass TD','TD Throw Rate','EPA / Dropback','CPOE','Pressure Rate',
    'Rush Attempts','Rush Yards','Rush TD','Rush Attempt Share','Rush Opportunity Share','RYOE / Att',
    'Targets','Receptions','Rec Yards','Rec TD','Target Share','Route Participation','First Read Rate','YPRR','WOPR','Air Yards Share',
    'Pass Games','Rush Games','Receiving Games','Pass Attempts'
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
      valExpansion_(s['nfl.receiving.wopr']),valExpansion_(s['nfl.receiving.air_yards_share']),
      valExpansion_(s['nfl.passing.games']),valExpansion_(s['nfl.rushing.games']),
      valExpansion_(s['nfl.receiving.games']),valExpansion_(s['nfl.passing.attempts'])
    ];
  });

  if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(),headers.length-sheet.getMaxColumns());
  if (sheet.getMaxRows() < rows.length+1) sheet.insertRowsAfter(sheet.getMaxRows(),rows.length+1-sheet.getMaxRows());
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


/***************************************************************
 * PHASE 3: WEEKLY MATCHUPS (isolated; no Best Plays/sync writes)
 * Run buildPlayerResearchMatchups(), then testPlayerResearchMatchups().
 * Defense: season-to-date per-game allowance percentile, shrunk
 * toward neutral with games/(games+4); blend 75% player / 25% defense.
 * Scores are research indices, not probabilities or yard projections.
 * FTN base scores are the current season snapshot, NOT backtest inputs.
 ***************************************************************/
function expansionTable_(ss, name, required) {
  const sheet = ss.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Missing data: ' + name);
  const data = sheet.getDataRange().getValues();
  const headers = data.shift().map(x => String(x).trim());
  required.forEach(k => { if (!headers.includes(k)) throw new Error(name + ': missing column ' + k); });
  return data.filter(r => r.some(x => x !== '')).map(r => {
    const o = {}; headers.forEach((k,i) => o[k] = r[i]); return o;
  });
}

function buildPlayerResearchMatchups() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const week = Number(getCurrentWeek());
  if (!Number.isInteger(week) || week < 1 || week > 18) throw new Error('Select a regular-season week (1–18) in Settings!B3.');
  const season = Number(NFL.SEASON);
  const players = expansionTable_(ss, RESEARCH_EXPANSION.SHEET,
    ['Season','Position','Player','Team','Pass TD Score','Pass Yards Score','Rush TD Score','Rush Yards Score','Receiving TD Score','Receiving Yards Score','Pass Games','Rush Games','Receiving Games','Pass Attempts']);
  const schedule = expansionTable_(ss, NFL.SHEETS.SCHEDULE,
    ['Season','Week','Away','Home','Game ID','Status','Date','Time ET']);
  const logs = expansionTable_(ss, NFL.SHEETS.GAME_LOG,
    ['Season','Week','Defense','Game ID','Pass TD','QB Rush TD','RB Rush TD','RB Rec TD','TE TD']);
  const raw = expansionTable_(ss, NFL.SHEETS.RAW_PLAYERS,
    ['season','week','position','passing_yards','rushing_yards','receiving_yards']);
  if (!raw.some(r => Object.prototype.hasOwnProperty.call(r,'recent_team') || Object.prototype.hasOwnProperty.call(r,'team'))) {
    throw new Error('Raw Player Stats: missing recent_team/team');
  }
  const context = expansionDefenseContext_(schedule, logs, raw, season, week);
  const results = expansionWeeklyRows_(players, context, season, week);
  if (!results.length) throw new Error('No QB/RB/TE players matched this season/week. Check player model and schedule.');
  const headers = ['Season','Week','Position','Player','Team','Opponent','Game ID','Date','Time ET','Game Status','Defense Games',
    'Anytime TD Score','Pass TD Score','Pass Yards Score','Rush TD Score','Rush Yards Score','Receiving TD Score','Receiving Yards Score',
    'Base Pass TD','Base Pass Yards','Base Rush TD','Base Rush Yards','Base Receiving TD','Base Receiving Yards',
    'Defense Pass TD Index','Defense Pass Yards Index','Defense Position Rush TD Index','Defense Position Rush Yards Index',
    'Defense Position Rec TD Index','Defense Position Rec Yards Index',
    'Pass Workload','Rush Workload','Receiving Workload','Availability','Notes'];
  let sheet = ss.getSheetByName('Player Research Matchups');
  if (!sheet) sheet = ss.insertSheet('Player Research Matchups');
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.clear();
  if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length-sheet.getMaxColumns());
  if (sheet.getMaxRows() < results.length+1) sheet.insertRowsAfter(sheet.getMaxRows(), results.length+1-sheet.getMaxRows());
  sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#1f4e78').setFontColor('#ffffff');
  sheet.getRange(2,1,results.length,headers.length).setValues(results.map(r => headers.map(k => r[k] === undefined ? '' : r[k])));
  sheet.getRange(2,12,results.length,19).setNumberFormat('0.0');
  sheet.getRange(1,1,results.length+1,headers.length).createFilter();
  sheet.setFrozenRows(1); sheet.autoResizeColumns(1,headers.length); sheet.setColumnWidth(4,180); sheet.setColumnWidth(headers.length,420);
  console.log('MATCHUPS BUILT: season ' + season + ', week ' + week + ', players ' + results.length);
  console.log('Excluded players without a game: ' + (players.filter(p => Number(p.Season) === season).length-results.length));
  console.log('Defense history excludes week ' + week + ' and later. FTN base scores are current snapshot; not historical backtest scores.');
  return results;
}

function expansionDefenseContext_(schedule, logs, raw, season, week) {
  const current = {}, history = {}, defenses = {};
  schedule.filter(g => Number(g.Season) === season).forEach(g => {
    const away = normalizeNFLTeam(g.Away), home = normalizeNFLTeam(g.Home);
    if (!away || !home || !g['Game ID']) throw new Error('Incomplete Schedule game');
    if (Number(g.Week) === week) {
      [[away,home],[home,away]].forEach(pair => {
        if (current[pair[0]]) throw new Error('Duplicate weekly schedule for ' + pair[0]);
        current[pair[0]] = { opponent: pair[1], game: g };
      });
    }
    if (Number(g.Week) < 1 || Number(g.Week) >= week || String(g.Status).toLowerCase() !== 'final') return;
    [[away,home],[home,away]].forEach(pair => {
      const key = g['Game ID'] + '|' + pair[0];
      if (history[key]) throw new Error('Duplicate historical schedule game: ' + key);
      const item = { team: pair[0], offense: pair[1], week: Number(g.Week), values: {}, present: {} };
      history[key] = item;
      if (!defenses[pair[0]]) defenses[pair[0]] = [];
      defenses[pair[0]].push(item);
    });
  });
  if (!Object.keys(current).length) throw new Error('No Schedule games for selected week.');
  const tdKeys = {'Pass TD':'passTD','QB Rush TD':'QBrushTD','RB Rush TD':'RBrushTD','RB Rec TD':'RBrecTD','TE TD':'TErecTD'};
  const seenLogs = new Set();
  logs.filter(r => Number(r.Season) === season && Number(r.Week) < week).forEach(r => {
    const key = r['Game ID'] + '|' + normalizeNFLTeam(r.Defense), game = history[key];
    if (!game) return;
    if (seenLogs.has(key)) throw new Error('Duplicate Team Game Log row: ' + key);
    seenLogs.add(key);
    Object.keys(tdKeys).forEach(k => {
      const n = numExpansion_(r[k]);
      if (n !== null && n >= 0) { game.values[tdKeys[k]] = n; game.present[tdKeys[k]] = true; }
    });
  });
  // Resolve opponent from completed schedule, avoiding reliance on optional raw opponent columns.
  const offenseWeek = {};
  Object.values(history).forEach(g => {
    const key = g.offense + '|' + g.week;
    if (offenseWeek[key]) throw new Error('Ambiguous team/week history: ' + key);
    offenseWeek[key] = g;
  });
  const seenPlayers = new Set();
  raw.filter(r => Number(r.season) === season && Number(r.week) >= 1 && Number(r.week) < week && (!r.season_type || r.season_type === 'REG')).forEach(r => {
    const team = normalizeNFLTeam(r.recent_team || r.team), game = offenseWeek[team+'|'+Number(r.week)];
    if (!game) return;
    const pos = normalizePosition(r.position);
    // Raw stats also contain WRs, kickers, and other positions that
    // do not feed these defensive yardage metrics.
    if (!['QB','RB','TE'].includes(pos)) return;
    const id = String(r.player_id || r.gsis_id || '').trim();
    const name = String(r.player_display_name || r.player_name || r.player || '').trim();
    const identity = id ? 'id:'+id : name ? 'name:'+name.toLowerCase()+'|'+pos : '';
    if (!identity) {
      // Do not silently omit relevant yards: mark this game's affected
      // metrics unavailable so the model uses its labeled neutral fallback.
      const affected = pos === 'QB' ? ['passYards','QBrushYards'] :
        pos === 'RB' ? ['RBrushYards','RBrecYards'] : ['TErecYards'];
      if (!game.invalid) game.invalid = {};
      affected.forEach(k => game.invalid[k] = true);
      console.log('Raw Player Stats: unidentified '+pos+' row for '+team+
        ' week '+r.week+'; affected defensive yardage uses neutral fallback.');
      return;
    }
    const key = identity+'|'+team+'|'+Number(r.week);
    if (seenPlayers.has(key)) throw new Error('Duplicate weekly player stats: ' + key);
    seenPlayers.add(key);
    const metrics = [];
    if (pos === 'QB') metrics.push(['passing_yards','passYards'],['rushing_yards','QBrushYards']);
    if (pos === 'RB') metrics.push(['rushing_yards','RBrushYards'],['receiving_yards','RBrecYards']);
    if (pos === 'TE') metrics.push(['receiving_yards','TErecYards']);
    metrics.forEach(pair => {
      const n = numExpansion_(r[pair[0]]);
      if (n === null) return;
      game.values[pair[1]] = (game.values[pair[1]] || 0) + n;
      game.present[pair[1]] = true;
    });
  });
  // Missing source rows are never silently converted into zero allowance.
  const keys = ['passTD','passYards','QBrushTD','QBrushYards','RBrushTD','RBrushYards','RBrecTD','RBrecYards','TErecTD','TErecYards'];
  const rates = {}, indices = {}, games = {};
  Object.keys(defenses).forEach(team => {
    const list = defenses[team]; games[team] = list.length; rates[team] = {}; indices[team] = {};
    keys.forEach(k => {
      if (list.every(g => g.present[k] && !(g.invalid && g.invalid[k]))) rates[team][k] = list.reduce((s,g) => s+g.values[k],0)/list.length;
    });
  });
  keys.forEach(k => {
    const values = Object.keys(rates).filter(t => rates[t][k] !== undefined).map(t => rates[t][k]).sort((a,b) => a-b);
    Object.keys(rates).forEach(team => {
      const v = rates[team][k];
      if (v === undefined || values.length < 2) return;
      const below = values.filter(x => x < v).length, equal = values.filter(x => x === v).length;
      const percentile = 100*(below+(equal-1)/2)/(values.length-1);
      indices[team][k] = Math.round((50+(percentile-50)*games[team]/(games[team]+4))*10)/10;
    });
  });
  return { current: current, indices: indices, games: games };
}

function expansionMatchupScore_(base, defense) {
  const b = numExpansion_(base);
  if (b === null) return '';
  const d = numExpansion_(defense);
  return Math.round(Math.max(0,Math.min(100,b*0.75+(d === null ? 50 : d)*0.25))*10)/10;
}

function expansionWeeklyRows_(players, context, season, week) {
  const rows = [];
  players.filter(p => Number(p.Season) === season && ['QB','RB','TE'].includes(p.Position)).forEach(p => {
    const team = normalizeNFLTeam(p.Team), matchup = context.current[team];
    if (!matchup) return;
    const pos = p.Position, d = context.indices[matchup.opponent] || {}, g = matchup.game;
    const row = {'Season':season,'Week':week,'Position':pos,'Player':p.Player,'Team':team,'Opponent':matchup.opponent,
      'Game ID':g['Game ID'],'Date':g.Date,'Time ET':g['Time ET'],'Game Status':g.Status,'Defense Games':context.games[matchup.opponent] || 0};
    const metrics = [];
    if (pos === 'QB') metrics.push(['Pass TD','passTD'],['Pass Yards','passYards'],['Rush TD','QBrushTD'],['Rush Yards','QBrushYards']);
    if (pos === 'RB') metrics.push(['Rush TD','RBrushTD'],['Rush Yards','RBrushYards'],['Receiving TD','RBrecTD'],['Receiving Yards','RBrecYards']);
    if (pos === 'TE') metrics.push(['Receiving TD','TErecTD'],['Receiving Yards','TErecYards']);
    const missing = [];
    metrics.forEach(pair => {
      const label = pair[0], key = pair[1], base = p[label+' Score'];
      row['Base '+label] = base;
      row[label+' Score'] = expansionMatchupScore_(base,d[key]);
      const defenseLabel = label.replace('Rush','Position Rush').replace('Receiving','Position Rec');
      row['Defense '+defenseLabel+' Index'] = d[key] === undefined ? '' : d[key];
      if (d[key] === undefined) missing.push(label);
    });
    row['Anytime TD Score'] = pos === 'QB' ? row['Rush TD Score'] : pos === 'TE' ? row['Receiving TD Score'] : weightedExpansionScore_([
      {value:numExpansion_(row['Rush TD Score']),weight:70},{value:numExpansion_(row['Receiving TD Score']),weight:30}]);
    const workload = expansionWorkload_(p);
    row['Pass Workload'] = workload.pass;
    row['Rush Workload'] = workload.rush;
    row['Receiving Workload'] = workload.receiving;
    row.Availability = 'Unverified';
    row.Notes = 'Research index; current FTN snapshot; availability unverified. Workload checks are heuristic screening, not confirmed roles.' + (pos === 'QB' ? ' ATD uses rushing only; passing TDs are separate.' : '') +
      (missing.length ? ' Neutral defense fallback: '+missing.join(', ')+'.' : '');
    rows.push(row);
  });
  return rows.sort((a,b) => a.Position.localeCompare(b.Position) || (numExpansion_(b['Anytime TD Score']) || 0)-(numExpansion_(a['Anytime TD Score']) || 0));
}

function testPlayerResearchMatchups() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rows = expansionTable_(ss,'Player Research Matchups',['Season','Week','Position','Player','Opponent','Anytime TD Score','Notes']);
  const week = Number(getCurrentWeek());
  const scoreFields = ['Anytime TD Score','Pass TD Score','Pass Yards Score','Rush TD Score','Rush Yards Score','Receiving TD Score','Receiving Yards Score'];
  rows.forEach(r => {
    if (Number(r.Season) !== Number(NFL.SEASON) || Number(r.Week) !== week) throw new Error('Stale matchup output; rebuild for selected season/week.');
    scoreFields.forEach(k => { const n = numExpansion_(r[k]); if (n !== null && (n < 0 || n > 100)) throw new Error('Invalid score: '+r.Player+' '+k); });
    if (r.Position === 'QB' && r['Anytime TD Score'] !== r['Rush TD Score']) throw new Error('QB ATD incorrectly includes passing TDs.');
  });
  ['QB','RB','TE'].forEach(pos => {
    console.log('----------------------------------------');
    scoreFields.forEach(field => {
      const ranked = rows.filter(r => r.Position === pos && numExpansion_(r[field]) !== null && expansionMarketWorkloadOK_(r,field)).sort((a,b) => Number(b[field])-Number(a[field])).slice(0,5);
      if (!ranked.length) return;
      console.log(pos+' TOP 5 — '+field.toUpperCase()+' (WORKLOAD SCREEN PASSED; AVAILABILITY UNVERIFIED)');
      ranked.forEach(r => console.log(r.Player+' | '+r.Team+' vs '+r.Opponent+' | '+r[field]+' | defense games '+r['Defense Games']));
    });
  });
  console.log('Rows passing ATD workload screen: '+rows.filter(r => expansionMarketWorkloadOK_(r,'Anytime TD Score')).length+'/'+rows.length);
  console.log('Neutral defense fallback rows: '+rows.filter(r => String(r.Notes).includes('fallback')).length+'/'+rows.length);
  console.log('MATCHUP VALIDATION COMPLETE — research indices, not probabilities; check injury/role status before integration.');
}

/***************************************************************
 * COVERAGE AND WORKLOAD SCREENING
 * Heuristic thresholds, not trained/calibrated betting cutoffs.
 * All research rows remain visible; validation top lists exclude
 * low/unknown workload. Availability is never inferred from stats.
 ***************************************************************/
function logExpansionCategoryCoverage_(players) {
  const checks = [
    ['QB','nfl.passing.attempts'],['QB','nfl.passing.yards'],
    ['QB','nfl.rushing.attempts'],['RB','nfl.rushing.attempts'],
    ['RB','nfl.receiving.targets'],['TE','nfl.receiving.targets']
  ];
  checks.forEach(pair => {
    const group = players.filter(p => p.position === pair[0]);
    const covered = group.filter(p => numExpansion_(p.stats[pair[1]]) !== null);
    console.log('CATEGORY COVERAGE '+pair[0]+' '+pair[1]+': '+covered.length+'/'+group.length);
    const missing = group.filter(p => numExpansion_(p.stats[pair[1]]) === null);
    if (missing.length) console.log('Missing '+pair[1]+': '+missing.map(p => p.playerName).join(', '));
  });
}

function expansionWorkload_(p) {
  function check(total, games, threshold) {
    const count = numExpansion_(total), n = numExpansion_(games);
    if (count === null || n === null || n <= 0) return 'Unknown';
    if (n < 2 || count/n < threshold) return 'Low';
    return 'Screen passed';
  }
  return {
    pass: p.Position === 'QB' ? check(p['Pass Attempts'],p['Pass Games'],10) : 'N/A',
    rush: ['QB','RB'].includes(p.Position) ? check(p['Rush Attempts'],p['Rush Games'],p.Position === 'QB' ? 3 : 5) : 'N/A',
    receiving: ['RB','TE'].includes(p.Position) ? check(p.Targets,p['Receiving Games'],2) : 'N/A'
  };
}

function expansionMarketWorkloadOK_(row, field) {
  if (field === 'Anytime TD Score') {
    if (row.Position === 'QB') return row['Rush Workload'] === 'Screen passed';
    if (row.Position === 'TE') return row['Receiving Workload'] === 'Screen passed';
    return row['Rush Workload'] === 'Screen passed' || row['Receiving Workload'] === 'Screen passed';
  }
  if (field.indexOf('Pass') === 0) return row['Pass Workload'] === 'Screen passed';
  if (field.indexOf('Rush') === 0) return row['Rush Workload'] === 'Screen passed';
  if (field.indexOf('Receiving') === 0) return row['Receiving Workload'] === 'Screen passed';
  return false;
}

/***************************************************************
 * BEST PLAYS INTEGRATION
 * Run buildExpandedBestPlays(), then testExpandedBestPlays().
 * Rebuilds legacy WR Best Plays, appends screened QB/RB/TE ATD
 * candidates, and creates Player Prop Research for other markets.
 * Does not send data externally or change automatic triggers.
 * Legacy WR Confidence and expansion indices are different models.
 ***************************************************************/
function expansionIntegrationRows_(matchups, season, week) {
  const atd = [], props = [], seen = new Set();
  const markets = [
    ['Passing TD','Pass TD Score'],['Passing Yards','Pass Yards Score'],
    ['Rushing TD','Rush TD Score'],['Rushing Yards','Rush Yards Score'],
    ['Receiving TD','Receiving TD Score'],['Receiving Yards','Receiving Yards Score']
  ];
  matchups.forEach(r => {
    if (Number(r.Season) !== season || Number(r.Week) !== week) throw new Error('Player Research Matchups is stale. Rebuild it for Settings!B3.');
    const team = normalizeNFLTeam(r.Team), opponent = normalizeNFLTeam(r.Opponent);
    const key = String(r.Player).trim().toLowerCase()+'|'+team;
    if (!r.Player || !team || !opponent || !['QB','RB','TE'].includes(r.Position)) throw new Error('Invalid matchup identity.');
    if (seen.has(key)) throw new Error('Duplicate matchup player: '+key);
    seen.add(key);
    // Unverified remains explicitly labeled. Block known unavailable
    // statuses if they are provided in the source; never infer injury status.
    const availability = String(r.Availability || 'Unverified').trim();
    if (expansionUnavailable_(availability)) return;
    markets.forEach(pair => {
      const score = numExpansion_(r[pair[1]]);
      if (score === null || !expansionMarketWorkloadOK_(r,pair[1])) return;
      if (score < 0 || score > 100) throw new Error('Invalid '+pair[0]+' index for '+r.Player);
      props.push({Season:season,Week:week,Position:r.Position,Player:r.Player,Team:team,Opponent:opponent,
        'Game ID':r['Game ID'],Market:pair[0],'Research Score':score,Availability:availability,
        'Score Basis':'Position-specific FTN player index + defensive allowance index; not probability or projected yards',
        Notes:r.Notes || ''});
    });
    const score = numExpansion_(r['Anytime TD Score']);
    if (score === null || !expansionMarketWorkloadOK_(r,'Anytime TD Score') || score < 60) return;
    if (score > 100) throw new Error('Invalid ATD index for '+r.Player);
    if (r.Position === 'QB' && score !== numExpansion_(r['Rush TD Score'])) throw new Error('QB ATD includes passing TDs.');
    atd.push({row:r,team:team,opponent:opponent,score:score,availability:availability});
  });
  atd.sort((a,b) => b.score-a.score || a.row.Player.localeCompare(b.row.Player));
  props.sort((a,b) => a.Market.localeCompare(b.Market) || a.Position.localeCompare(b.Position) || b['Research Score']-a['Research Score']);
  return {atd:atd,props:props};
}

function buildExpandedBestPlays() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), season = Number(NFL.SEASON), week = Number(getCurrentWeek());
  const matchups = expansionTable_(ss,'Player Research Matchups',[
    'Season','Week','Position','Player','Team','Opponent','Anytime TD Score',
    'Pass Workload','Rush Workload','Receiving Workload','Availability','Notes']);
  const availabilityContext = expansionAvailabilityRows_(ss,season,week);
  if (availabilityContext) expansionApplyCurrentContext_(matchups,availabilityContext);
  // Validate all source inputs before changing the legacy board.
  const prepared = expansionIntegrationRows_(matchups,season,week);
  const schedule = expansionTable_(ss,NFL.SHEETS.SCHEDULE,['Season','Week','Away','Home','Game ID']);
  const locations = {};
  schedule.filter(g => Number(g.Season) === season && Number(g.Week) === week).forEach(g => {
    locations[normalizeNFLTeam(g.Away)] = 'A'; locations[normalizeNFLTeam(g.Home)] = 'H';
  });
  if (typeof buildBestPlays !== 'function' || typeof buildGameBestPlays !== 'function') {
    throw new Error('The main tracker must include buildBestPlays and buildGameBestPlays.');
  }
  buildBestPlays();
  const sheet = ss.getSheetByName('Best Plays'), original = sheet.getDataRange().getValues();
  const baseHeaders = original[0].map(x => String(x).trim());
  ['Rank','Player','Team','Opponent','H/A','Play Type','Confidence','Matchup Score','Key Reason'].forEach(k => {
    if (!baseHeaders.includes(k)) throw new Error('Best Plays: missing '+k);
  });
  const extra = ['Position','Research Model','Availability','Season','Week','Score Basis'];
  const headers = baseHeaders.concat(extra);
  const output = original.slice(1).filter(r => {
    if (!r[baseHeaders.indexOf('Player')]) return false;
    if (!availabilityContext) return true;
    const context = availabilityContext.get(expansionNameKey_(r[baseHeaders.indexOf('Player')],r[baseHeaders.indexOf('Team')]));
    return context && !expansionUnavailable_(context.Availability) && context['Receiving Workload'] === 'Screen passed';
  }).map((r,index) => {
    const cells = r.slice(0,baseHeaders.length);
    while (cells.length < baseHeaders.length) cells.push('');
    cells[baseHeaders.indexOf('Rank')] = index+1;
    const context = availabilityContext && availabilityContext.get(expansionNameKey_(r[baseHeaders.indexOf('Player')],r[baseHeaders.indexOf('Team')]));
    if (context) cells[baseHeaders.indexOf('Key Reason')] = String(cells[baseHeaders.indexOf('Key Reason')] || '')+' [Current context] '+context.Notes+' Source: '+context['Status Source'];
    return cells.concat(['WR','Legacy WR TD model',context ? context.Availability : 'Unverified',season,week,'Legacy WR Confidence; research signal, not probability']);
  });
  prepared.atd.forEach(p => {
    const r = p.row, obj = {};
    obj.Rank = output.length+1; obj.Player = r.Player; obj.Team = p.team; obj.Opponent = p.opponent;
    obj['H/A'] = locations[p.team] || '';
    obj['Play Type'] = r.Position+' Anytime TD';
    // Retain compatibility with existing consumers without inventing
    // WR usage, red-zone, coverage or historical TD fields for these players.
    obj.Confidence = p.score; obj['Matchup Score'] = p.score;
    obj['Key Reason'] = r.Position+' ATD research index '+p.score+
      '; workload screen passed; availability '+p.availability.toLowerCase()+
      (r.Position === 'QB' ? '; rushing TD signal only' : '')+
      '; different model from WR Confidence; not a calibrated probability. '+(r.Notes || '');
    obj.Position = r.Position; obj['Research Model'] = 'QB/RB/TE expansion';
    obj.Availability = p.availability; obj.Season = season; obj.Week = week;
    obj['Score Basis'] = 'Expansion ATD research index; 60+ screen; not calibrated against WR Confidence';
    output.push(headers.map(k => obj[k] === undefined ? '' : obj[k]));
  });
  expansionWriteBoard_(ss,'Best Plays',headers,output);
  sheet.getRange('A1').setNote('WR rows retain their original ordering and scores. Screened QB/RB/TE ATD rows follow, ordered by expansion index. Confidence carries different research models; neither is a probability. Availability is unverified unless explicitly supplied. Other prop markets are in Player Prop Research. Run buildExpandedBestPlays to refresh this combined board; buildBestPlays alone rebuilds WR only.');
  const propHeaders = ['Season','Week','Position','Player','Team','Opponent','Game ID','Market','Research Score','Availability','Score Basis','Notes'];
  expansionWriteBoard_(ss,'Player Prop Research',propHeaders,prepared.props.map(p => propHeaders.map(k => p[k])));
  buildGameBestPlays();
  console.log('EXPANDED BEST PLAYS BUILT: '+(output.length-prepared.atd.length)+' WR rows + '+prepared.atd.length+' expansion ATD rows (index >=60).');
  console.log('PLAYER PROP RESEARCH: '+prepared.props.length+' market-specific rows. Passing TDs and yards stay outside ATD Best Plays.');
  console.log('Game Best Plays rebuilt using existing ranking logic. Scores from different models are not calibrated against one another.');
  console.log('No external sync performed. Original buildBestPlays remains WR-only; use buildExpandedBestPlays for the combined board.');
}

function expansionWriteBoard_(ss,name,headers,rows) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.clearContents();
  if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(),headers.length-sheet.getMaxColumns());
  if (sheet.getMaxRows() < rows.length+1) sheet.insertRowsAfter(sheet.getMaxRows(),rows.length+1-sheet.getMaxRows());
  sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#0d293f').setFontColor('#ffffff');
  if (rows.length) {
    sheet.getRange(2,1,rows.length,headers.length).setValues(rows);
    sheet.getRange(1,1,rows.length+1,headers.length).createFilter();
  }
  sheet.setFrozenRows(1); sheet.autoResizeColumns(1,headers.length);
  headers.forEach((k,i) => {
    if (['Confidence','Matchup Score','Research Score'].includes(k) && rows.length) sheet.getRange(2,i+1,rows.length,1).setNumberFormat('0.0');
    if (['Notes','Key Reason','Score Basis'].includes(k)) sheet.setColumnWidth(i+1,420);
  });
}

function testExpandedBestPlays() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), season = Number(NFL.SEASON), week = Number(getCurrentWeek());
  const matchups = expansionTable_(ss,'Player Research Matchups',['Season','Week','Position','Player','Team','Opponent']);
  const currentContext = expansionAvailabilityRows_(ss,season,week);
  if (currentContext) expansionApplyCurrentContext_(matchups,currentContext);
  const expected = expansionIntegrationRows_(matchups,season,week);
  const best = expansionTable_(ss,'Best Plays',['Position','Research Model','Availability','Season','Week','Play Type','Player','Team','Confidence']);
  const props = expansionTable_(ss,'Player Prop Research',['Season','Week','Position','Market','Player','Team','Research Score','Availability']);
  const expansion = best.filter(r => r['Research Model'] === 'QB/RB/TE expansion');
  if (expansion.length !== expected.atd.length || props.length !== expected.props.length) throw new Error('Stale/missing integrated output; run buildExpandedBestPlays again.');
  best.concat(props).forEach(r => {
    if (Number(r.Season) !== season || Number(r.Week) !== week) throw new Error('Stale integrated season/week.');
    if (!r.Availability) throw new Error('Missing availability label.');
  });
  expected.atd.forEach(p => {
    const found = expansion.filter(r => r.Player === p.row.Player && normalizeNFLTeam(r.Team) === p.team);
    if (found.length !== 1 || Number(found[0].Confidence) !== p.score || found[0]['Play Type'] !== p.row.Position+' Anytime TD' || found[0].Availability !== p.availability) throw new Error('Incorrect ATD output: '+p.row.Player);
  });
  const seen = new Set();
  props.forEach(r => {
    const key = r.Player+'|'+normalizeNFLTeam(r.Team)+'|'+r.Market;
    if (seen.has(key)) throw new Error('Duplicate prop: '+key);
    seen.add(key);
    const source = expected.props.find(p => p.Player === r.Player && p.Team === normalizeNFLTeam(r.Team) && p.Market === r.Market);
    if (!source || source['Research Score'] !== Number(r['Research Score']) || source.Availability !== r.Availability) throw new Error('Incorrect prop output: '+key);
  });
  console.log('WR rows retained: '+best.filter(r => r.Position === 'WR').length);
  ['QB','RB','TE'].forEach(pos => {
    const ranked = expansion.filter(r => r.Position === pos).sort((a,b) => Number(b.Confidence)-Number(a.Confidence));
    console.log(pos+' ATD CANDIDATES: '+ranked.length);
    ranked.slice(0,3).forEach(r => console.log(r.Player+' | '+r.Team+' vs '+r.Opponent+' | '+r.Confidence+' | '+r.Availability));
  });
  Array.from(new Set(props.map(r => r.Market))).sort().forEach(m => console.log(m+': '+props.filter(r => r.Market === m).length+' rows'));
  console.log('EXPANDED BEST PLAYS VALIDATION COMPLETE: ATD-only main board; separate prop markets; availability labeled; no external sync.');
}

/***************************************************************
 * EXPANDED SUPABASE SYNC
 * Required Script Properties: SUPABASE_URL, SUPABASE_ANON_KEY,
 * NFL_RESEARCH_SYNC_TOKEN (private writer token; never in GitHub).
 * Run syncExpandedNFLResearchToSupabase().
 ***************************************************************/
function expansionSyncTeam_(team) {
  const normalized = normalizeNFLTeam(team);
  return normalized === 'LA' ? 'LAR' : normalized;
}
function expansionSyncPayload_(ss,season,week) {
  const bestSheetRows = expansionTable_(ss,'Best Plays',['Season','Week','Player','Team','Position','Research Model','Availability','Score Basis']);
  const metadata = new Map();
  bestSheetRows.forEach(r => {
    if (Number(r.Season) !== season || Number(r.Week) !== week) throw new Error('Stale Best Plays. Run buildExpandedBestPlays first.');
    const key = r.Player+'|'+expansionSyncTeam_(r.Team);
    if (metadata.has(key)) throw new Error('Duplicate Best Plays player '+key);
    metadata.set(key,{position:r.Position,availability:r.Availability || 'Unverified',research_model:r['Research Model'],score_basis:r['Score Basis']});
  });
  const best = buildBestPlaySyncRows_(season,week).map(r => {
    const meta = metadata.get(r.player+'|'+expansionSyncTeam_(r.team));
    if (!meta) throw new Error('Best Plays metadata mismatch: '+r.player);
    return Object.assign({},r,{team:expansionSyncTeam_(r.team),opponent:expansionSyncTeam_(r.opponent)},meta);
  });
  const gameSheet = ss.getSheetByName('Game Best Plays');
  if (!gameSheet) throw new Error('Game Best Plays is missing. Rebuild expanded boards.');
  const gameData = gameSheet.getDataRange().getValues();
  const weekColumn = gameData[0].map(String).indexOf('Week');
  if (weekColumn < 0 || gameData.slice(1).some(r => Number(r[weekColumn]) !== week)) throw new Error('Game Best Plays is stale. Rebuild expanded boards.');
  const games = buildGameBestPlaySyncRows_(season,week).map(r => {
    const meta = metadata.get(r.player+'|'+expansionSyncTeam_(r.player_team));
    if (!meta) throw new Error('Game Best Plays player missing from current Best Plays: '+r.player);
    return Object.assign({},r,{player_team:expansionSyncTeam_(r.player_team),opponent:expansionSyncTeam_(r.opponent),away_team:expansionSyncTeam_(r.away_team),home_team:expansionSyncTeam_(r.home_team)},meta);
  });
  const props = expansionTable_(ss,'Player Prop Research',['Season','Week','Position','Player','Team','Opponent','Market','Research Score','Availability']).map(r => {
    if (Number(r.Season) !== season || Number(r.Week) !== week) throw new Error('Stale Player Prop Research. Rebuild expanded boards.');
    return {season:season,week:week,position:r.Position,player:r.Player,team:expansionSyncTeam_(r.Team),opponent:expansionSyncTeam_(r.Opponent),game_id:r['Game ID'] || null,
      market:r.Market,research_score:numExpansion_(r['Research Score']),availability:r.Availability || 'Unverified',score_basis:r['Score Basis'] || '',notes:r.Notes || ''};
  });
  return {season:season,week:week,best_plays:best,game_best_plays:games,player_props:props,player_details:buildExpansionProductionSyncRows_(ss,season,week)};
}

function syncExpandedNFLResearchToSupabase() {
  testExpandedBestPlays();
  const ss = SpreadsheetApp.getActiveSpreadsheet(),season = Number(NFL.SEASON),week = Number(getCurrentWeek());
  const payload = expansionSyncPayload_(ss,season,week);
  const props = PropertiesService.getScriptProperties();
  const base = String(props.getProperty('SUPABASE_URL') || '').replace(/\/$/,'');
  const anon = props.getProperty('SUPABASE_ANON_KEY');
  const token = props.getProperty('NFL_RESEARCH_SYNC_TOKEN');
  if (!base || !anon || !token) throw new Error('Required Script Properties: SUPABASE_URL, SUPABASE_ANON_KEY, NFL_RESEARCH_SYNC_TOKEN.');
  const response = UrlFetchApp.fetch(base+'/functions/v1/atd-expanded-research-sync',{
    method:'post',contentType:'application/json',muteHttpExceptions:true,
    headers:{apikey:anon,Authorization:'Bearer '+anon,'x-research-sync-token':token},payload:JSON.stringify(payload)
  });
  const status = response.getResponseCode(), result = response.getContentText();
  console.log('Expanded research HTTP '+status); console.log(result);
  if (status < 200 || status >= 300) throw new Error('Expanded research sync failed: HTTP '+status+' '+result);
  sendNFLResearchToSupabase_('defense_targets',buildDefenseTargetSyncRows_(season,week));
  sendNFLResearchToSupabase_('wr_matchups',buildWRMatchupSyncRows_(season,week));
  console.log('EXPANDED NFL SYNC COMPLETE: '+payload.best_plays.length+' Best Plays, '+payload.game_best_plays.length+' game plays, '+payload.player_props.length+' prop rows.');
  ss.toast('Expanded research synced to Bet Tracker.','Complete',8);
}

/***************************************************************
 * CURRENT AVAILABILITY AND RECENT USAGE
 * Run buildPlayerAvailabilityAndUsage(), buildExpandedBestPlays(),
 * then testPlayerAvailabilityAndUsage() and syncExpandedNFLResearchToSupabase().
 * Sources: weekly raw stats + current roster + selected-week injury
 * reports + fresh nflverse depth snapshots for near-term games.
 * Roster ACT and depth rank 1 do NOT confirm game-day availability.
 ***************************************************************/
function expansionNameKey_(name,team) {
  return String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9 ]/g,' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g,'').replace(/\s+/g,' ').trim()+'|'+expansionSyncTeam_(team);
}
function expansionCSVObjects_(url,required) {
  const data = fetchCSV(url);
  if (!data || data.length < 2) throw new Error('Empty CSV source: '+url);
  const headers = data[0].map(x => String(x).trim());
  required.forEach(k => { if (!headers.includes(k)) throw new Error('Missing source column '+k); });
  return data.slice(1).filter(r => r.some(x => x !== '')).map(r => {
    const o = {}; headers.forEach((k,i) => o[k] = r[i]); return o;
  });
}
function expansionRosterIndex_(rows,season,week) {
  const names = {}, ids = {};
  rows.filter(r => Number(r.season) === season && Number(r.week) <= week && (!r.game_type || r.game_type === 'REG')).forEach(r => {
    const key = expansionNameKey_(r.full_name,r.team), previous = names[key];
    if (previous && Number(previous.week) > Number(r.week)) return;
    if (previous && Number(previous.week) === Number(r.week) && previous.gsis_id && r.gsis_id && previous.gsis_id !== r.gsis_id) {
      names[key] = {ambiguous:true,week:r.week}; return;
    }
    if (previous && previous.ambiguous && Number(previous.week) === Number(r.week)) return;
    names[key] = r;
    if (r.gsis_id && (!ids[r.gsis_id] || Number(ids[r.gsis_id].week) <= Number(r.week))) ids[r.gsis_id] = r;
  });
  return {names:names,ids:ids};
}
function expansionRecentUsage_(raw,schedule,rosters,season,week) {
  const games = {}, coverage = {}, stats = {}, duplicate = new Set();
  schedule.filter(g => Number(g.Season) === season && Number(g.Week) < week && String(g.Status).toLowerCase() === 'final').forEach(g => {
    [g.Away,g.Home].forEach(t => {
      const team = expansionSyncTeam_(t);
      if (!games[team]) games[team] = [];
      if (games[team].includes(Number(g.Week))) throw new Error('Duplicate completed team/week '+team+' '+g.Week);
      games[team].push(Number(g.Week));
    });
  });
  Object.values(games).forEach(a => a.sort((a,b) => b-a));
  raw.filter(r => Number(r.season) === season && Number(r.week) > 0 && Number(r.week) < week && (!r.season_type || r.season_type === 'REG')).forEach(r => {
    const team = expansionSyncTeam_(r.recent_team || r.team), w = Number(r.week);
    if (!(games[team] || []).includes(w)) return;
    const pos = normalizePosition(r.position);
    if (!['QB','RB','WR','TE'].includes(pos)) return;
    const id = String(r.player_id || r.gsis_id || '');
    const roster = rosters.ids[id];
    const name = r.player_display_name || r.player_name || r.player || (roster && roster.full_name);
    if (!name) return;
    const key = expansionNameKey_(name,team), identity = (id || key)+'|'+team+'|'+w;
    if (duplicate.has(identity)) throw new Error('Duplicate recent player row '+identity);
    duplicate.add(identity);
    coverage[team+'|'+w] = true;
    if (!stats[key]) stats[key] = {};
    if (stats[key][w]) { stats[key][w].ambiguous = true; return; }
    stats[key][w] = {position:pos,team:team,pass:numExpansion_(r.attempts !== undefined ? r.attempts : r.passing_attempts),rush:numExpansion_(r.carries !== undefined ? r.carries : r.rushing_attempts),targets:numExpansion_(r.targets)};
  });
  return {games:games,coverage:coverage,stats:stats};
}
function expansionRecentProfile_(player,recent) {
  const key = expansionNameKey_(player.Player,player.Team), team = expansionSyncTeam_(player.Team);
  const weeks = (recent.games[team] || []).slice(0,3), history = recent.stats[key] || {};
  const complete = weeks.length > 0 && weeks.every(w => recent.coverage[team+'|'+w]);
  function average(metric,list) {
    if (!list.length || !list.every(w => recent.coverage[team+'|'+w])) return null;
    let total = 0;
    for (const w of list) {
      const s = history[w];
      // In a covered team game, absence from player stats is zero usage.
      if (!s) continue;
      if (s.ambiguous || s[metric] === null) return null;
      total += s[metric];
    }
    return Math.round(total/list.length*10)/10;
  }
  const pass = complete ? average('pass',weeks) : null, rush = complete ? average('rush',weeks) : null, targets = complete ? average('targets',weeks) : null;
  function screen(value,threshold) { return value === null || weeks.length < 2 ? 'Unknown' : value >= threshold ? 'Screen passed' : 'Low'; }
  const pos = player.Position;
  const primary = pos === 'QB' ? 'pass' : pos === 'RB' ? 'rush' : 'targets';
  const before = (recent.games[team] || []).slice(3,6), prior = average(primary,before), current = average(primary,weeks);
  const trend = prior === null || current === null || !before.length ? 'Insufficient history' : prior === 0 ? (current > 0 ? 'New usage' : 'Flat') : current >= prior*1.25 ? 'Up' : current <= prior*0.75 ? 'Down' : 'Stable';
  return {weeks:weeks.join(', '),games:weeks.length,pass:pass,rush:rush,targets:targets,trend:trend,
    passScreen:pos === 'QB' ? screen(pass,10) : 'N/A',rushScreen:['QB','RB'].includes(pos) ? screen(rush,pos === 'QB' ? 3 : 5) : 'N/A',
    recScreen:['RB','WR','TE'].includes(pos) ? screen(targets,pos === 'WR' ? 3 : 2) : 'N/A'};
}
function expansionQBRoleAllowed_(player,recent,availability) {
  if (player.Position !== 'QB') return true;
  if (expansionUnavailable_(availability.availability)) return false;
  if (availability.rank !== null) return availability.rank === 1;
  const team = expansionSyncTeam_(player.Team), key = expansionNameKey_(player.Player,team);
  const latest = (recent.games[team] || [])[0];
  if (!latest || !recent.coverage[team+'|'+latest]) return false;
  const own = (recent.stats[key] || {})[latest];
  if (!own || own.ambiguous || own.position !== 'QB' || own.pass === null || own.pass < 15) return false;
  let total = 0, leaders = 0, invalid = false;
  Object.values(recent.stats).forEach(history => {
    const row = history[latest];
    if (!row || row.team !== team) return;
    if (row.ambiguous || row.pass === null) { invalid = true; return; }
    total += row.pass;
    if (row.position === 'QB' && row.pass >= own.pass) leaders++;
  });
  if (invalid || leaders !== 1 || total <= 0 || own.pass/total < 0.60) return false;
  availability.role = 'Recent passing leader; starter unverified';
  availability.source += '; prior completed team game week '+latest+' passing attempts (role inference)';
  return true;
}
function expansionUnavailable_(status) {
  return /^(out|inactive|injured reserve|ir|suspended|unavailable|reserve|practice squad|released|retired|exempt)(\b|$)/i.test(String(status || '').trim());
}
function expansionFreshJSON_(data,season,now) {
  const stamp = Date.parse(data && data.timestamp || '');
  return Number(data && data.season && data.season.year) === season && Number.isFinite(stamp) && now-stamp >= -3600000 && now-stamp <= 48*3600000;
}
function expansionLiveContext_(schedule,season,week,now) {
  const eligible = new Set();
  const selected = schedule.filter(g => Number(g.Season) === season && Number(g.Week) === week);
  console.log('Live context window: '+new Date(now).toISOString()+'; selected games '+selected.length);
  schedule.filter(g => Number(g.Season) === season && Number(g.Week) === week && String(g.Status).toLowerCase() !== 'final').forEach(g => {
    const stamp = g.Date instanceof Date ? g.Date.getTime() : Date.parse(String(g.Date));
    if (Number.isFinite(stamp) && stamp-now >= -86400000 && stamp-now <= 7*86400000) {
      eligible.add(expansionSyncTeam_(g.Away)); eligible.add(expansionSyncTeam_(g.Home));
    }
  });
  const injuries = {}, depth = {};
  console.log('Live context eligible teams: '+(Array.from(eligible).join(', ') || 'none'));
  if (!eligible.size) selected.slice(0,4).forEach(g => console.log('Schedule context: '+g.Away+' vs '+g.Home+'; date '+String(g.Date)+'; status '+String(g.Status)));
  if (!eligible.size) return {injuries:injuries,depth:depth,eligible:eligible};
  try {
    const url = 'https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_'+season+'.csv.gz';
    const response = UrlFetchApp.fetch(url,{muteHttpExceptions:true});
    if (response.getResponseCode() !== 200) throw new Error('HTTP '+response.getResponseCode());
    const blob = response.getBlob().setContentType('application/gzip');
    const text = Utilities.ungzip(blob).getDataAsString('UTF-8');
    const rows = expansionFreshDepthCSV_(text,now);
    const latest = {};
    rows.forEach(r => {
      const team = expansionSyncTeam_(r.team);
      if (eligible.has(team) && (!latest[team] || r.dt > latest[team])) latest[team] = r.dt;
    });
    rows.forEach(r => {
      const team = expansionSyncTeam_(r.team), pos = normalizePosition(r.pos_abb), rank = Number(r.pos_rank);
      if (!eligible.has(team) || r.dt !== latest[team] || !['QB','RB','WR','TE'].includes(pos) || !Number.isInteger(rank) || rank < 1 || !r.player_name) return;
      const key = expansionNameKey_(r.player_name,team);
      if (depth[key] && depth[key].position !== pos) { depth[key].ambiguous = true; return; }
      if (!depth[key] || rank < depth[key].rank) depth[key] = {rank:rank,position:pos,source:'nflverse depth snapshot '+r.dt};
    });
    Object.keys(depth).forEach(k => { if (depth[k].ambiguous) delete depth[k]; });
    console.log('nflverse fresh depth teams: '+Object.keys(latest).length+'/'+eligible.size+'; matched player entries '+Object.keys(depth).length);
    console.log('Injury status uses selected-week nflverse reports and roster restrictions; missing reports do not confirm availability.');
  } catch(e) { console.log('nflverse depth source unavailable: '+e.message+'; recent passing leader fallback remains labeled unverified.'); }
  return {injuries:injuries,depth:depth,eligible:eligible};
}
function expansionFreshDepthCSV_(text,now) {
  // Keep only fresh rows before CSV parsing: the season file includes many historical snapshots.
  const firstEnd = text.indexOf('\n');
  if (firstEnd < 0) throw new Error('Empty depth CSV');
  const header = text.slice(0,firstEnd).replace(/\r$/,'');
  const fields = Utilities.parseCsv(header)[0];
  if (fields[0] !== 'dt' || !['team','player_name','pos_abb','pos_rank'].every(k => fields.includes(k))) throw new Error('Depth CSV schema changed');
  const lines = [header];
  let offset = firstEnd+1;
  while (offset < text.length) {
    let end = text.indexOf('\n',offset); if (end < 0) end = text.length;
    const comma = text.indexOf(',',offset);
    if (comma >= offset && comma < end) {
      const stamp = Date.parse(text.slice(offset,comma).replace(/^"|"$/g,''));
      if (Number.isFinite(stamp) && now-stamp >= -3600000 && now-stamp <= 48*3600000) lines.push(text.slice(offset,end));
    }
    offset = end+1;
  }
  if (lines.length === 1) throw new Error('No depth snapshots within 48 hours');
  const data = Utilities.parseCsv(lines.join('\n'));
  return data.slice(1).map(row => { const r = {}; fields.forEach((key,i) => r[key] = row[i]); return r; });
}

function expansionAvailability_(p,rosters,reports,live,week) {
  const key = expansionNameKey_(p.Player,p.Team), roster = rosters.names[key], injury = reports[key], current = live.injuries[key], depth = live.depth[key];
  const sources = [], warnings = [];
  let availability = 'Unverified', role = 'Role unverified';
  const rosterStatus = roster && !roster.ambiguous ? String(roster.status || '').toUpperCase() : '';
  const unavailable = {RES:'Reserve',DEV:'Practice squad',INA:'Inactive',CUT:'Released',RET:'Retired',EXE:'Exempt'};
  if (rosterStatus && Number(roster.week) === week) {
    sources.push('nflverse roster week '+roster.week);
    availability = unavailable[rosterStatus] || (rosterStatus === 'ACT' ? 'Active roster; game-day unverified' : 'Unverified');
  }
  if (injury) {
    sources.push('nflverse injury report week '+week);
    if (!expansionUnavailable_(availability) && injury.report_status) availability = String(injury.report_status);
    if (injury.practice_status) warnings.push(String(injury.practice_status));
  }
  if (current) {
    sources.push(current.source);
    if (!expansionUnavailable_(availability)) {
      if (current.status && current.status !== 'Active') availability = current.status;
      else if (availability === 'Unverified') availability = 'No restriction reported; game-day unverified';
    }
  }
  if (depth) {
    sources.push(depth.source);
    role = depth.rank === 1 ? 'Listed starter' : 'Depth rank '+depth.rank;
  }
  if (/questionable|doubtful/i.test(availability)) warnings.push('Check final game-day status');
  return {availability:availability,role:role,rank:depth ? depth.rank : null,roster:rosterStatus,source:sources.join('; ') || 'No current matching source',warnings:warnings.join('; ')};
}

function buildPlayerAvailabilityAndUsage() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(),season = Number(NFL.SEASON),week = Number(getCurrentWeek());
  const rows = expansionTable_(ss,'Player Research Matchups',['Season','Week','Position','Player','Team','Availability','Notes']);
  if (rows.some(r => Number(r.Season) !== season || Number(r.Week) !== week)) throw new Error('Rebuild Player Research Matchups for the selected week first.');
  const schedule = expansionTable_(ss,NFL.SHEETS.SCHEDULE,['Season','Week','Away','Home','Date','Status']);
  const raw = expansionTable_(ss,NFL.SHEETS.RAW_PLAYERS,['season','week','position','targets']);
  if (!raw.some(r => r.attempts !== undefined || r.passing_attempts !== undefined) || !raw.some(r => r.carries !== undefined || r.rushing_attempts !== undefined)) throw new Error('Raw Player Stats lacks passing attempts or rushing carries columns.');
  let rosterRows = [], reportRows = [];
  try { rosterRows = expansionCSVObjects_(NFL.URLS.ROSTER,['season','week','team','full_name','status']); } catch(e) { console.log('Roster unavailable: '+e.message); }
  try { reportRows = expansionCSVObjects_('https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_'+season+'.csv',['season','week','team','full_name','report_status']); } catch(e) { console.log('Injury reports unavailable: '+e.message); }
  const rosters = expansionRosterIndex_(rosterRows,season,week), reports = {};
  reportRows.filter(r => Number(r.season) === season && Number(r.week) === week && (!r.season_type || r.season_type === 'REG')).forEach(r => { reports[expansionNameKey_(r.full_name,r.team)] = r; });
  const recent = expansionRecentUsage_(raw,schedule,rosters,season,week);
  const live = expansionLiveContext_(schedule,season,week,Date.now());
  const allPlayers = rows.slice();
  const wrSheet = ss.getSheetByName('WR Matchups');
  if (wrSheet && wrSheet.getLastRow() > 1) expansionTable_(ss,'WR Matchups',['WR','Team']).forEach(r => allPlayers.push({Player:r.WR,Team:r.Team,Position:'WR'}));
  const audit = [], seen = new Set(), indexed = {};
  allPlayers.forEach(p => {
    const key = expansionNameKey_(p.Player,p.Team);
    if (seen.has(key)) return; seen.add(key);
    const usage = expansionRecentProfile_(p,recent), availability = expansionAvailability_(p,rosters,reports,live,week);
    const qbRoleBlocked = !expansionQBRoleAllowed_(p,recent,availability);
    const passScreen = qbRoleBlocked ? 'Role review' : usage.passScreen;
    const rushScreen = qbRoleBlocked ? 'Role review' : usage.rushScreen;
    const notes = 'Recent team weeks '+(usage.weeks || 'none')+'; pass/G '+(usage.pass === null ? 'unknown' : usage.pass)+'; carries/G '+(usage.rush === null ? 'unknown' : usage.rush)+'; targets/G '+(usage.targets === null ? 'unknown' : usage.targets)+'; '+availability.role+'; usage '+usage.trend+'. '+availability.warnings;
    const row = {Season:season,Week:week,Position:p.Position,Player:p.Player,Team:expansionSyncTeam_(p.Team),Availability:availability.availability,'Current Role':availability.role,
      'Roster Status':availability.roster,'Recent Team Games':usage.games,'Recent Weeks':usage.weeks,'Pass Attempts/Game':usage.pass === null ? '' : usage.pass,'Carries/Game':usage.rush === null ? '' : usage.rush,'Targets/Game':usage.targets === null ? '' : usage.targets,'Usage Trend':usage.trend,
      'Pass Workload':passScreen,'Rush Workload':rushScreen,'Receiving Workload':usage.recScreen,'Status Source':availability.source,'Checked At':new Date().toISOString(),Notes:notes};
    audit.push(row); indexed[key] = row;
  });
  const headers = Object.keys(audit[0] || {});
  if (!audit.length) throw new Error('No availability/usage rows built.');
  expansionWriteBoard_(ss,'Player Availability & Usage',headers,audit.map(r => headers.map(k => r[k])));
  const updated = rows.map(r => {
    const status = indexed[expansionNameKey_(r.Player,r.Team)];
    const copy = Object.assign({},r);
    ['Availability','Pass Workload','Rush Workload','Receiving Workload','Current Role','Status Source','Usage Trend'].forEach(k => copy[k] = status[k]);
    copy.Notes = String(r.Notes || '').replace(/ \[Current context\][\s\S]*$/,'')+' [Current context] '+status.Notes+' Source: '+status['Status Source'];
    return copy;
  });
  const sheetHeaders = Object.keys(updated[0]);
  expansionWriteBoard_(ss,'Player Research Matchups',sheetHeaders,updated.map(r => sheetHeaders.map(k => r[k] === undefined ? '' : r[k])));
  console.log('AVAILABILITY/RECENT USAGE BUILT: '+audit.length+' players; selected week '+week);
  console.log('Unavailable players: '+audit.filter(r => expansionUnavailable_(r.Availability)).length);
  console.log('QB roles needing review: '+audit.filter(r => r.Position === 'QB' && r['Pass Workload'] === 'Role review').length);
  console.log('Injury report rows for selected week: '+Object.keys(reports).length+'; live source applies only to near-term scheduled games.');
  return audit;
}
function expansionAvailabilityRows_(ss,season,week) {
  const sheet = ss.getSheetByName('Player Availability & Usage');
  if (!sheet || sheet.getLastRow() < 2) return null;
  const rows = expansionTable_(ss,'Player Availability & Usage',['Season','Week','Player','Team','Availability','Receiving Workload','Notes']);
  if (rows.some(r => Number(r.Season) !== season || Number(r.Week) !== week || !Number.isFinite(Date.parse(r['Checked At'])) || Date.now()-Date.parse(r['Checked At']) > 24*3600000)) throw new Error('Availability/recent usage is stale. Run buildPlayerAvailabilityAndUsage.');
  return new Map(rows.map(r => [expansionNameKey_(r.Player,r.Team),r]));
}
function testPlayerAvailabilityAndUsage() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(),season = Number(NFL.SEASON),week = Number(getCurrentWeek());
  const indexed = expansionAvailabilityRows_(ss,season,week);
  if (!indexed) throw new Error('Run buildPlayerAvailabilityAndUsage first.');
  const rows = Array.from(indexed.values());
  ['QB','RB','WR','TE'].forEach(pos => {
    const group = rows.filter(r => r.Position === pos);
    console.log(pos+' CONTEXT: '+group.length+' players; unavailable '+group.filter(r => expansionUnavailable_(r.Availability)).length);
    const volume = pos === 'QB' ? 'Pass Attempts/Game' : pos === 'RB' ? 'Carries/Game' : 'Targets/Game';
    group.slice().sort((a,b) => Number(b[volume] || 0)-Number(a[volume] || 0)).slice(0,5).forEach(r => console.log(r.Player+' | recent games '+r['Recent Team Games']+' | '+volume+' '+r[volume]+' | '+r.Availability+' | '+r['Current Role']));
    group.filter(r => expansionUnavailable_(r.Availability) || /questionable|doubtful/i.test(r.Availability)).slice(0,8).forEach(r => console.log(r.Player+' | '+r.Availability+' | '+r['Current Role']));
  });
  rows.forEach(r => {
    if (Number(r['Recent Team Games']) > 3) throw new Error('Recent window exceeds 3 team games');
    if (String(r['Recent Weeks']).split(',').some(w => Number(w.trim()) >= week)) throw new Error('Current/future week leaked into recent usage');
  });
  console.log('AVAILABILITY/USAGE VALIDATION COMPLETE. Listed starters/active rosters are not confirmed game-day availability.');
}

function expansionApplyCurrentContext_(rows,indexed) {
  rows.forEach(r => {
    const context = indexed.get(expansionNameKey_(r.Player,r.Team));
    if (!context) throw new Error('Missing player context: '+r.Player);
    ['Availability','Pass Workload','Rush Workload','Receiving Workload','Current Role'].forEach(k => r[k] = context[k]);
    r.Notes = String(r.Notes || '').replace(/ \[Current context\][\s\S]*$/,'')+' [Current context] '+context.Notes+' Source: '+context['Status Source'];
  });
}


/***************************************************************
 * ONE-CLICK REFRESH
 * Uses existing raw stats, schedule, WR Matchups and expansion
 * sheets. Import/rebuild source models first when those change.
 * Run refreshExpandedNFLResearch() for current context + board
 * rebuild + validation + sync. Does not create a scheduled trigger.
 ***************************************************************/
function refreshExpandedNFLResearch() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Another expanded research refresh is running. Try again after it finishes.');
  const started = Date.now();
  let stage = 'preflight';
  try {
    const season = Number(NFL.SEASON), week = Number(getCurrentWeek());
    if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1 || week > 18) throw new Error('Select a valid regular-season week before refreshing.');
    const props = PropertiesService.getScriptProperties();
    ['SUPABASE_URL','SUPABASE_ANON_KEY','NFL_RESEARCH_SYNC_TOKEN'].forEach(key => {
      if (!props.getProperty(key)) throw new Error('Missing Script Property: '+key);
    });
    console.log('EXPANDED RESEARCH REFRESH START: season '+season+', week '+week);
    const steps = [
      ['availability and recent usage',buildPlayerAvailabilityAndUsage],
      ['availability validation',testPlayerAvailabilityAndUsage],
      ['Best Plays and prop boards',buildExpandedBestPlays],
      // The sync function validates the rebuilt boards before its first request.
      ['board validation and Supabase sync',syncExpandedNFLResearchToSupabase]
    ];
    steps.forEach(step => {
      stage = step[0];
      if (Number(NFL.SEASON) !== season || Number(getCurrentWeek()) !== week) throw new Error('Season/week changed during refresh. Run again with a stable selection.');
      console.log('REFRESH STEP: '+stage);
      step[1]();
    });
    console.log('EXPANDED RESEARCH REFRESH COMPLETE: season '+season+', week '+week+'; '+Math.round((Date.now()-started)/1000)+' seconds.');
  } catch(e) {
    console.log('EXPANDED RESEARCH REFRESH STOPPED during '+stage+': '+e.message);
    throw e;
  } finally {
    lock.releaseLock();
  }
}


// Concrete production and positional opponent allowances for app explanations.
function expansionProductionDetails_(audit,raw,schedule,season,week) {
  const metrics={pass_yards:'passing_yards',rush_yards:'rushing_yards',rec_yards:'receiving_yards',pass_td:'passing_tds',rush_td:'rushing_tds',rec_td:'receiving_tds',attempts:'attempts',carries:'carries',targets:'targets',receptions:'receptions'};
  const history={}, current={}, coverage={}, stats={}, grouped={}, duplicate=new Set();
  schedule.filter(g=>Number(g.Season)===season).forEach(g=>{
    const away=expansionSyncTeam_(g.Away),home=expansionSyncTeam_(g.Home),w=Number(g.Week);
    if(w===week){current[away]=home;current[home]=away;}
    if(w<1||w>=week||String(g.Status).toLowerCase()!=='final')return;
    [[away,home],[home,away]].forEach(([team,opponent])=>{
      if(!history[team])history[team]={};
      if(history[team][w]&&history[team][w]!==opponent)throw new Error('Ambiguous production team/week '+team+' '+w);
      history[team][w]=opponent;
    });
  });
  raw.filter(r=>Number(r.season)===season&&Number(r.week)>0&&Number(r.week)<week&&(!r.season_type||r.season_type==='REG')).forEach(r=>{
    const team=expansionSyncTeam_(r.recent_team||r.team),w=Number(r.week),pos=normalizePosition(r.position);
    if(!history[team]?.[w]||!['QB','RB','WR','TE'].includes(pos))return;
    const name=r.player_display_name||r.player_name||r.player;
    if(!name)throw new Error('Production row missing player name: '+team+' week '+w);
    const key=expansionNameKey_(name,team),id=String(r.player_id||r.gsis_id||key)+'|'+team+'|'+w;
    if(duplicate.has(id))throw new Error('Duplicate production row '+id);duplicate.add(id);
    coverage[team+'|'+w]=true;
    if(!stats[key])stats[key]={};
    const values={};Object.keys(metrics).forEach(k=>{values[k]=numExpansion_(r[metrics[k]]);});
    if(stats[key][w])stats[key][w]={ambiguous:true};else stats[key][w]=values;
    const groupKey=team+'|'+w+'|'+pos;
    if(!grouped[groupKey])grouped[groupKey]={};
    const group=grouped[groupKey];
    Object.keys(metrics).forEach(k=>{
      if(values[k]===null)group[k]=null;
      else if(group[k]!==null)group[k]=(group[k]||0)+values[k];
    });
  });
  const results=[],seen=new Set();
  audit.forEach(p=>{
    const team=expansionSyncTeam_(p.Team),opponent=current[team],key=expansionNameKey_(p.Player,team),pos=p.Position;
    if(!opponent||seen.has(key))return;seen.add(key);
    const weeks=Object.keys(history[team]||{}).map(Number).sort((a,b)=>b-a).slice(0,3),player=stats[key]||{};
    function own(w,k){if(!coverage[team+'|'+w])return null;const row=player[w];return !row?0:row.ambiguous?null:row[k];}
    const latest={},recent={};
    Object.keys(metrics).forEach(k=>{
      latest[k]=weeks.length?own(weeks[0],k):null;
      const values=weeks.map(w=>own(w,k));
      recent[k]=values.length&&values.every(v=>v!==null)?Math.round(values.reduce((a,b)=>a+b,0)/values.length*10)/10:null;
    });
    const defenseWeeks=Object.keys(history[opponent]||{}).map(Number),allowance={games:defenseWeeks.length};
    const positionMetric={pass_yards:'QB',pass_td:'QB',rush_yards:pos,rec_yards:pos,rush_td:pos,rec_td:pos};
    Object.entries(positionMetric).forEach(([metric,sourcePos])=>{
      const values=defenseWeeks.map(w=>{const offense=history[opponent][w],group=grouped[offense+'|'+w+'|'+sourcePos];return group&&group[metric]!==undefined?group[metric]:null;});
      allowance[metric]=values.length&&values.every(v=>v!==null)?Math.round(values.reduce((a,b)=>a+b,0)/values.length*10)/10:null;
    });
    results.push({season:season,week:week,player:p.Player,team:team,opponent:opponent,position:pos,detail:{latest_week:weeks[0]||null,recent_weeks:weeks,recent_games:weeks.length,latest:latest,recent:recent,defense:allowance,availability:p.Availability||'Unverified',role:p['Current Role']||'Role unverified',usage_trend:p['Usage Trend']||'Unknown',source:p['Status Source']||'Raw Player Stats + completed Schedule games',context_checked_at:p['Checked At']||null}});
  });
  return results;
}
function buildExpansionProductionSyncRows_(ss,season,week) {
  const indexed=expansionAvailabilityRows_(ss,season,week);
  if(!indexed)throw new Error('Build current availability before syncing production details.');
  const raw=expansionTable_(ss,NFL.SHEETS.RAW_PLAYERS,['season','week','position','passing_yards','rushing_yards','receiving_yards','passing_tds','rushing_tds','receiving_tds']);
  const schedule=expansionTable_(ss,NFL.SHEETS.SCHEDULE,['Season','Week','Away','Home','Status']);
  return expansionProductionDetails_(Array.from(indexed.values()),raw,schedule,season,week);
}
