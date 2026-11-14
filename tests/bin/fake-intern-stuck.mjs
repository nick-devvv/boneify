#!/usr/bin/env node
// A stand-in for the Intern CLI that runs out of turns without writing fixed.txt. Also reports which env keys it was given.
process.stdout.write(JSON.stringify({ type: "run_start", model: "fake", env: Object.keys(process.env).sort() }) + "\n");
process.stdout.write(JSON.stringify({ type: "run_end", reason: "max_turns", turns: 3, final_text: "gave up", usage: {}, system1: { asks: 1 } }) + "\n");
