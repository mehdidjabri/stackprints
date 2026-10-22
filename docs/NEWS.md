# Refreshing news

News lives in `content/news/<layer>/<id>.json`, one file per option (patterns have none). The format and the rules for good sources are in [RESEARCH.md](RESEARCH.md#news). A refresh run touches only news files, plus an option's `facts` and `researched` when the news shows they changed.

## Run

1. **See what's stale.** By default this lists options with no news, or news older than 7 days, oldest first.

   ```bash
   npm run news:stale -- --days 7 --limit 90
   ```

2. **Split the list into batches by layer**, up to 9 batches, and give each batch to a research agent with this brief:

   > Read docs/RESEARCH.md. For each option below, search for news published after its `updated` date (or the last 12 months if never checked). Merge new items into `content/news/<layer>/<id>.json`: keep the 5 newest plus every other item from the last 30 days, newest first, no duplicates. Set `updated` to today even if nothing is new. Only use URLs you actually saw. If the news changes a datasheet fact (pricing, license, ownership, a new major version), update that fact in the option file and set its `researched` date. Don't touch other files, and don't build or commit. Finish with `npm run check`.

3. **Validate and build.**

   ```bash
   npm run check && npm run build
   ```

4. **Review before committing.** Look at `git diff --stat content/` and skim the new headlines for spam, duplicates or anything off-topic.

5. **Commit** as `news: refresh YYYY-MM-DD (N options, M new items)`.

## Cadence

A scheduled task runs this weekly from the Claude desktop app. In a hosted repo the same steps can run from a GitHub Action, with a bot opening the pull request so a person reviews it before merge.
