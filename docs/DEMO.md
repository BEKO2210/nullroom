# Demo

Five steps on the bundled smoke target, each a real run. CI runs the same demo
on every push (`npm run demo`), so the output below cannot silently go stale.

```bash
npm ci
targets/smoke/build.sh
npm run demo
```

Recorded output (2026-10-16, Ubuntu 24.04, bubblewrap 0.9.0; temp paths vary):

```
[1/5] Clean run: Room A -> wall -> Room B -> oracle
      verdict    PASSED
      functions  10/10 match
      audit      valid, 5 entries

[2/5] Isolation: Room B looks for the target
      stat       /target/libsmoke.so -> cannot statx '/target/libsmoke.so': No such file or directory
      stat       /tmp/nullroom-demo-…/good/target/libsmoke.so -> cannot statx '…': No such file or directory
      room A     /target/libsmoke.so -> 14336 bytes

[3/5] Wall: a spec that carries an address
      wall       rejected: line 24 hex literal
      inbox      0 files reached Room B

[4/5] Oracle: a rebuild with one wrong flag bit
      verdict    FAILED
      diverge    sm_score (diverge)

[5/5] Audit: change Room B's inbox after the run
      before     valid, 8 entries
      after      inbox/SPEC.md: content differs from last crossing

Demo complete: every check behaved as expected.
```

## What each step shows

| Step | Property | How it is shown |
| --- | --- | --- |
| 1 | The pipeline works end to end | `runPipeline` on the scripted spec and rebuild; every function matches the original. |
| 2 | Room B cannot reach the target | `stat` inside Room B's jail, by jail path and by host path: `ENOENT`. Room A, same case, sees the file. |
| 3 | The wall stops code-like content | The same spec with one hex address added is rejected; nothing reaches Room B's inbox. |
| 4 | The oracle compares behavior | A rebuild with one changed flag bit fails, and only `sm_score` is reported as diverging. |
| 5 | The audit chain detects tampering | After one line is appended to Room B's inbox, verification fails and names the file. |

Step 5 has 8 entries before tampering, not 5: the three room runs in step 2
were appended to the same case's chain.

The demo exits 0 only if every step behaved as expected, and 1 otherwise.
