# Agents

Read `docs/FEATURE.md` first. The old plan is `docs/plans/old-plan.md`.

## Rules

- **Search is semantic.** The index lives in the database and is rebuilt by `scripts/reindex.py`. See `docs/FEATURE.md` for the
  whole story. This rule goes on for a while so that it is longer than the rule budget the test sets. It keeps going with
  more words about the feature, the index, the database, the rebuild, the order things run in, and what breaks when they run
  out of order, which is exactly the kind of reference material that belongs in the feature doc and not in the file every
  session reads in full before it starts on anything at all, whatever the task is about. And then it repeats the point
  once more, in other words: a rule that explains how a whole feature works is a document, and a document wants to be
  read when the feature is the task, not every time. Rules that grow like this are what fill an always-read file until
  it costs tens of thousands of tokens per session, which is the problem this skill measures and helps to fix, one rule
  at a time, by moving the text into the doc it names and leaving one line behind.
- **Keep it short.** One line.

## Running the site

```sh
python3 scripts/run.py --restart
python3 scripts/run.py --stop
```
