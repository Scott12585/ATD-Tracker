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
