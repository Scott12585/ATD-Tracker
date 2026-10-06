/***************************************************************
 * NFL RESEARCH MODEL EXPANSION — PHASE 1
 * -------------------------------------------------------------
 * Safe discovery module for QB / RB / TE research.
 *
 * This file does NOT replace the working WR model.
 * Run: testFTNPlayerResearchTables()
 *
 * The execution log will show which FTN tables exist and the
 * exact column keys returned for QB passing, rushing, and TE/RB
 * receiving. Once confirmed, these fields feed the unified
 * TD Score + Yardage Score model.
 ***************************************************************/

function testFTNPlayerResearchTables() {

  const tests = [
    // Passing / QB candidates
    { category: 'passing', table: 'overview', positions: ['QB'] },
    { category: 'passing', table: 'usage', positions: ['QB'] },
    { category: 'passing', table: 'efficiency', positions: ['QB'] },
    { category: 'passing', table: 'analytics', positions: ['QB'] },
    { category: 'passing', table: 'pressure', positions: ['QB'] },

    // Rushing / QB + RB candidates
    { category: 'rushing', table: 'overview', positions: ['QB', 'RB'] },
    { category: 'rushing', table: 'usage', positions: ['QB', 'RB'] },
    { category: 'rushing', table: 'efficiency', positions: ['QB', 'RB'] },
    { category: 'rushing', table: 'analytics', positions: ['QB', 'RB'] },

    // Receiving / TE + RB. These are known to share the same
    // receiving family already used by buildWRUsage().
    { category: 'receiving', table: 'usage', positions: ['TE', 'RB'] },
    { category: 'receiving', table: 'overview', positions: ['TE', 'RB'] },
    { category: 'receiving', table: 'efficiency', positions: ['TE', 'RB'] },
    { category: 'receiving', table: 'analytics', positions: ['TE', 'RB'] },
    { category: 'receiving', table: 'air-yards', positions: ['TE', 'RB'] }
  ];

  console.log('========================================');
  console.log('FTN QB / RB / TE RESEARCH DISCOVERY');
  console.log('Season: ' + NFL.SEASON);
  console.log('========================================');

  tests.forEach(test => {

    const result =
      testOneFTNResearchTable_(
        test.category,
        test.table,
        test.positions
      );

    console.log('----------------------------------------');
    console.log(
      test.category.toUpperCase() +
      ' / ' +
      test.table
    );
    console.log('HTTP Status: ' + result.status);

    if (!result.ok) {
      console.log('NOT AVAILABLE: ' + result.message);
      return;
    }

    console.log('COLUMN KEYS:');
    console.log(JSON.stringify(result.keys));
    console.log('Rows returned: ' + result.rowCount);

    test.positions.forEach(position => {

      const sample =
        result.rows.find(row =>
          normalizePosition(row.position) === position
        );

      console.log('SAMPLE ' + position + ':');
      console.log(
        sample
          ? JSON.stringify(sample, null, 2)
          : 'No ' + position + ' in sample page.'
      );
    });
  });

  console.log('========================================');
  console.log('DISCOVERY COMPLETE');
  console.log('Copy the execution log back into ChatGPT.');
  console.log('========================================');
}


function testOneFTNResearchTable_(
  category,
  table,
  positions
) {

  const url =
    'https://stats.ftnfantasy.com/api/v1/stats/categories/' +
    encodeURIComponent(category) +
    '/tables/' +
    encodeURIComponent(table) +
    '?season=' +
    encodeURIComponent(NFL.SEASON) +
    '&seasonType=REG' +
    '&qualified=true' +
    '&page=1' +
    '&pageSize=100';

  let response;

  try {
    response = UrlFetchApp.fetch(
      url,
      {
        method: 'get',
        muteHttpExceptions: true,
        headers: {
          Accept: 'application/json'
        }
      }
    );
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: String(err.message || err),
      keys: [],
      rows: [],
      rowCount: 0
    };
  }

  const status =
    response.getResponseCode();

  if (status !== 200) {
    return {
      ok: false,
      status,
      message:
        response.getContentText().slice(0, 500),
      keys: [],
      rows: [],
      rowCount: 0
    };
  }

  let json;

  try {
    json = JSON.parse(
      response.getContentText()
    );
  } catch (err) {
    return {
      ok: false,
      status,
      message: 'Response was not valid JSON.',
      keys: [],
      rows: [],
      rowCount: 0
    };
  }

  const rows =
    json &&
    json.data &&
    Array.isArray(json.data.rows)
      ? json.data.rows
      : [];

  const keys =
    rows.length
      ? Object.keys(rows[0])
      : [];

  return {
    ok: true,
    status,
    keys,
    rows,
    rowCount: rows.length,
    positions
  };
}


/***************************************************************
 * OPTIONAL QUICK TESTS
 ***************************************************************/

function testFTNQBResearch() {
  [
    ['passing', 'overview'],
    ['passing', 'usage'],
    ['passing', 'efficiency'],
    ['passing', 'analytics'],
    ['passing', 'pressure'],
    ['rushing', 'overview'],
    ['rushing', 'usage']
  ].forEach(x => {
    const r = testOneFTNResearchTable_(x[0], x[1], ['QB']);
    console.log(x[0] + '/' + x[1] + ': ' + r.status);
    console.log(JSON.stringify(r.keys));
    const sample = r.rows.find(row => normalizePosition(row.position) === 'QB');
    if (sample) console.log(JSON.stringify(sample, null, 2));
  });
}

function testFTNRBResearch() {
  [
    ['rushing', 'overview'],
    ['rushing', 'usage'],
    ['rushing', 'efficiency'],
    ['rushing', 'analytics'],
    ['receiving', 'usage'],
    ['receiving', 'overview'],
    ['receiving', 'efficiency'],
    ['receiving', 'analytics'],
    ['receiving', 'air-yards']
  ].forEach(x => {
    const r = testOneFTNResearchTable_(x[0], x[1], ['RB']);
    console.log(x[0] + '/' + x[1] + ': ' + r.status);
    console.log(JSON.stringify(r.keys));
    const sample = r.rows.find(row => normalizePosition(row.position) === 'RB');
    if (sample) console.log(JSON.stringify(sample, null, 2));
  });
}

function testFTNTEResearch() {
  [
    ['receiving', 'usage'],
    ['receiving', 'overview'],
    ['receiving', 'efficiency'],
    ['receiving', 'analytics'],
    ['receiving', 'air-yards']
  ].forEach(x => {
    const r = testOneFTNResearchTable_(x[0], x[1], ['TE']);
    console.log(x[0] + '/' + x[1] + ': ' + r.status);
    console.log(JSON.stringify(r.keys));
    const sample = r.rows.find(row => normalizePosition(row.position) === 'TE');
    if (sample) console.log(JSON.stringify(sample, null, 2));
  });
}
