# ATD Tracker

Mobile-first NFL anytime touchdown betting tracker backed by Supabase.

## What is already wired up

- Supabase email/password authentication
- Per-user bet storage with Row Level Security
- Default stake and season settings
- NFL player autocomplete
- Automatic player team, opponent and game-date lookup
- Pending/Won/Lost tracking
- Live refresh button plus automatic refresh every 2 minutes while the app is open
- Weekly/season dashboard for bets, record, staked, P/L, ROI and pending bets

## Publish with GitHub Pages

1. Open this repository in GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select **main** and **/(root)**.
5. Save.

The project site will then be available at the GitHub Pages URL shown in that screen.

## First use

1. Open the published site.
2. Create an account with email/password.
3. Set your default wager in Settings.
4. In Bets, choose a week, search/select a player, and enter American odds.
5. Team, opponent, game date, stake and Pending status are filled automatically.

## Data notes

NFL player/team lookup uses the Sleeper public NFL player feed. Matchups and game scoring/status use ESPN public-facing NFL data. Sportsbook grading should remain the final authority for bet settlement.
