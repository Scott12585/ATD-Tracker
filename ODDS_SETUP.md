# DraftKings O/U setup

1. Add the entire `NFL Odds and Projections.gs` file as a **new** Apps Script file. Keep the existing main script.
2. Replace `Research Model Expansion.gs` with its latest version. This adds automatic odds refresh to the existing expanded sync when `ODDS_API_KEY` is present.
3. Apps Script → Project Settings → Script Properties → Add property:
   - Property: `ODDS_API_KEY`
   - Value: your **The Odds API** key (the-odds-api.com).
   - Keep the key private. Do not put it in code, Sheets cells, GitHub, or chat.
4. Run `refreshNFLPlayerOddsAndProjections` once. Current availability/recent usage must already be built; if stale, run `buildPlayerAvailabilityAndUsage` first.
5. Run `testNFLPlayerProjections` for rolling point-total accuracy diagnostics, then share the execution logs (not the key).

The existing morning and evening research refreshes will include DraftKings after configuration. No additional trigger is needed. Manual odds-only refresh uses `refreshNFLPlayerOddsAndProjections`.

Markets: passing yards, passing TDs, rushing yards, receiving yards, receptions. Only paired DraftKings Over and Under prices at the same main line are used. Ambiguous player matches or multiple lines are withheld. Games must match the selected week's teams and Eastern game date; started games are excluded from pulls. Provider failures preserve the previous O/U snapshot, which the page hides from candidates after it becomes stale.

Each event requests five markets from one bookmaker. Check provider quota and player-prop access before increasing refresh frequency. The execution log reports remaining credits. Empty successful event responses mean the provider has no posted props; the page will show projections without fabricated lines.

## Projection method v1

Projected workload = 65% last-three-team-game volume + 35% season volume. Projected efficiency = 65% recent production per attempt/carry/target + 35% season efficiency. The product is adjusted by opponent position-group production allowance relative to the league average, shrunk by defense games/(games+6), capped at ±15%. All statistics precede the selected week. Missed player games count as zero only when team-stat coverage is present; missing coverage or metrics prevents projections.

Promotion screens: three recent team games, workload minimum (QB pass 10 attempts/G, QB rush 3 carries/G, RB rush 5 carries/G, WR targets 3/G, RB/TE targets 2/G), active roster, listed starter for QBs, at least two complete defensive games, context within 24 hours, odds fetched and bookmaker-updated within six hours, future kickoff, projection gap at least 10% of the line and at least 2 yards / 0.5 receptions / 0.25 passing TD. Candidate order is relative projection gap, not expected value. Game-day availability remains unverified.

These are **experimental point projections**, not calibrated over-hit probabilities. A point estimate above a line does not establish a >50% over probability, and the price must be considered before making a value claim. The board shows the price's break-even win rate, but does not invent a model hit probability. Rolling diagnostics use only earlier-week stats and report MAE and bias; they do not report over win rate or ROI without historical sportsbook lines.

## Saved-line tracking and historical tests

Replace `NFL Odds and Projections.gs` with its latest version. No new Script Properties or triggers are required. Future existing research refreshes grade saved observations against final imported stats before pulling new odds.

- `gradeSavedNFLPlayerOvers`: grade/recheck saved lines with currently imported completed-game stats. Uses no Odds API credits.
- `testHistoricalNFLPlayerProjections`: manually test the verified available 2023 and 2024 CSV seasons and save MAE, recent-average baseline MAE, and bias to the Model Performance section. This does not run on daily triggers. Reports already populated from these datasets.

The first 109 real DraftKings lines were captured immediately when tracking was installed. Later syncs append immutable observations; prior weeks remain available after the selected week changes. The report chooses the latest recorded paired pregame line before filtering candidate status, so repeated refreshes and earlier favorable lines are not counted as separate plays. Grading updates the same logical player/market/game result and rechecks recent completed games for stat corrections. Missing or ambiguous player stat rows stay ungraded.

Statistical Over wins/losses/pushes compare final recorded totals to the saved line. This is not confirmation of sportsbook settlement, participation/void rules, or real placed bets. Hypothetical ROI risks one unit per graded over at its saved American price, with pushes returning the stake. Missing results are excluded. Historical point tests evaluate matching final stat rows and do not reconstruct historical injury or depth-chart exclusions. No historical sportsbook lines have been invented or paid historical-odds calls made.
