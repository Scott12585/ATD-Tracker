// Replace the existing fetchCSV function in your main Apps Script file with this
// function. Do not keep two functions named fetchCSV. No trigger changes needed.
function fetchCSV(url) {
  const scheduleSource = /\/releases\/download\/schedules\/games\.csv(?:\.gz)?$/.test(url) ||
    url === 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
  const sources = scheduleSource ? [
    'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv',
    'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv'
  ] : [url];
  const errors = [];
  for (const source of sources) {
    try {
      const response = UrlFetchApp.fetch(source, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {'User-Agent': 'Mozilla/5.0'}
      });
      if (response.getResponseCode() !== 200) {
        throw new Error('HTTP ' + response.getResponseCode());
      }
      const text = source.endsWith('.gz') ?
        Utilities.ungzip(response.getBlob()).getDataAsString() :
        response.getContentText();
      const rows = Utilities.parseCsv(text);
      if (scheduleSource) {
        if (!rows || rows.length < 2) throw new Error('Empty schedule CSV');
        const headers = rows[0].map(h => String(h).replace(/^\uFEFF/, '').trim());
        const required = ['season','week','game_type','gameday','gametime','away_team','home_team','game_id','away_score','home_score'];
        if (required.some(h => !headers.includes(h))) throw new Error('Invalid schedule CSV columns');
        rows[0] = headers;
        const seasonColumn = headers.indexOf('season'), typeColumn = headers.indexOf('game_type');
        if (!rows.slice(1).some(r => Number(r[seasonColumn]) === Number(NFL.SEASON) && r[typeColumn] === 'REG')) {
          throw new Error('Schedule has no regular-season games for ' + NFL.SEASON);
        }
        console.log('NFL schedule downloaded: ' + source + (errors.length ? ' (fallback)' : ''));
      }
      return rows;
    } catch (error) {
      errors.push(source + ': ' + String(error.message || error));
      if (sources.length > 1) console.log('Schedule source unavailable; trying next source. ' + errors[errors.length-1]);
    }
  }
  throw new Error('Could not download CSV:\n' + errors.join('\n'));
}
